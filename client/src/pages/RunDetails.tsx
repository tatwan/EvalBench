import { useParams } from "wouter";
import { useEffect, useRef, useState } from "react";
import { useEvalRun, useEvalResults, useEvalStats } from "@/hooks/use-eval";
import { useModels } from "@/hooks/use-models";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/Badge";
import { Activity, Cpu, ArrowLeft, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { format } from "date-fns";
import { clsx } from "clsx";
import { AlertTriangle } from "lucide-react";

// Metrics where higher is NOT better (lower latency = better)
const LOWER_IS_BETTER = new Set(["total_latency_s", "load_latency_s"]);
const SCORE_PRECISION: Record<string, number> = {
  tokens_per_second: 1,
  total_latency_s: 2,
  load_latency_s: 2,
  prompt_tokens: 0,
  output_tokens: 0,
  bleu: 1,
  chrf: 1,
};

function formatScore(name: string, value: number): string {
  const prec = SCORE_PRECISION[name] ?? 3;
// Percentage-like scores (0-1 range)
  if (!["bleu", "chrf", "tokens_per_second", "total_latency_s", "load_latency_s", "prompt_tokens", "output_tokens"].includes(name)) {
    return `${(value * 100).toFixed(1)}%`;
  }
  return value.toFixed(prec);
}

function metricLabel(name: string): string {
  const MAP: Record<string, string> = {
    rouge1: "ROUGE-1", rouge2: "ROUGE-2", rougeL: "ROUGE-L",
    meteor: "METEOR", bleu: "BLEU", chrf: "chrF",
    exact_match: "Exact Match", f1: "Token F1",
    distinct1: "Distinct-1", distinct2: "Distinct-2",
    tokens_per_second: "Tokens/sec", total_latency_s: "Latency (s)",
    load_latency_s: "Load Time (s)", prompt_tokens: "Prompt Tokens",
    output_tokens: "Output Tokens",
    llm_coherence: "LLM Coherence", llm_relevance: "LLM Relevance", 
    llm_fluency: "LLM Fluency",
  };
  return MAP[name] ?? name;
}

// We no longer manually group results here, we use the backend's /stats endpoint

function getExamplesPerModel(results: any[]) {
  // filter out speed metrics for scoring
  const qualityResults = results.filter(r => 
    !["tokens_per_second", "total_latency_s", "load_latency_s", "prompt_tokens", "output_tokens"].includes(r.metricName)
  );

  const modelItemScores: Record<number, Record<number, { scoreSum: number, count: number, input: string, expectedOutput: string, rawOutput: string }>> = {};

  for (const r of qualityResults) {
    if (!r.itemId) continue;
    if (!modelItemScores[r.modelId]) modelItemScores[r.modelId] = {};
    if (!modelItemScores[r.modelId][r.itemId]) {
      modelItemScores[r.modelId][r.itemId] = { scoreSum: 0, count: 0, input: r.input, expectedOutput: r.expectedOutput, rawOutput: r.rawOutput };
    }
    modelItemScores[r.modelId][r.itemId].scoreSum += r.score;
    modelItemScores[r.modelId][r.itemId].count += 1;
  }

  const examples: Record<number, { best?: any, worst?: any }> = {};

  for (const [mid, items] of Object.entries(modelItemScores)) {
    const scoredItems = Object.entries(items).map(([itemId, data]: [string, any]) => ({
      itemId: Number(itemId),
      avgScore: data.scoreSum / data.count,
      input: data.input,
      expected: data.expectedOutput,
      actual: data.rawOutput
    }));

    scoredItems.sort((a, b) => b.avgScore - a.avgScore);

    if (scoredItems.length > 0) {
      examples[Number(mid)] = {
        best: scoredItems[0],
        worst: scoredItems.length > 1 ? scoredItems[scoredItems.length - 1] : undefined
      };
    }
  }

  return examples;
}

export default function RunDetails() {
  const params = useParams<{ id: string }>();
  const runId = parseInt(params.id ?? "0", 10);

  const { data: run, isLoading: runLoading, refetch: refetchRun } = useEvalRun(runId);
  const { data: results = [], refetch: refetchResults } = useEvalResults(runId);
  const { data: stats = [], refetch: refetchStats } = useEvalStats(runId);
  const { data: models = [] } = useModels();

  // SSE progress
  const [progress, setProgress] = useState<{ completed: number; total: number; percent: number } | null>(null);
  const [sseError, setSseError] = useState<string | null>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!run || run.status !== "running") return;
    const es = new EventSource(`/api/eval-runs/${runId}/progress`);
    esRef.current = es;
    es.onmessage = (e) => {
      const event = JSON.parse(e.data);
      if (event.type === "progress") {
        setProgress({ completed: event.completed, total: event.total, percent: event.percent });
      }
      if (event.done) {
        es.close();
        refetchRun();
        refetchResults();
        refetchStats();
        setProgress(null);
      }
    };
    es.onerror = () => {
      setSseError("Lost connection to progress stream.");
      es.close();
    };
    return () => es.close();
  }, [run?.status, runId]);

  if (runLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }
  if (!run) {
    return (
      <div className="text-center py-24 text-muted-foreground">
        Run not found. <a href="/" className="text-primary underline">Go to Dashboard</a>
      </div>
    );
  }

  // Build grouped stats: Record<modelId, Record<metricName, {mean, moe}>>
  const grouped: Record<number, Record<string, { mean: number, moe: number }>> = {};
  for (const s of (stats as any[])) {
    if (!grouped[s.modelId]) grouped[s.modelId] = {};
    grouped[s.modelId][s.metricName] = { mean: s.mean, moe: s.moe };
  }

  const modelMap = Object.fromEntries((models as any[]).map((m: any) => [m.id, m]));
  const config = run.configJson as any ?? {};
  const taskType = config.taskType ?? "-";
  const allMetrics = Array.from(new Set((stats as any[]).map((s: any) => s.metricName)));
  const modelIds = Object.keys(grouped).map(Number);
  const examples = getExamplesPerModel(results as any[]);

  const bestByMetric: Record<string, number> = {};
  allMetrics.forEach((metric) => {
    const values = modelIds
      .map((mid) => grouped[mid]?.[metric]?.mean)
      .filter((v): v is number => typeof v === "number");
    if (values.length === 0) return;
    const lowerIsBetter = LOWER_IS_BETTER.has(metric);
    bestByMetric[metric] = lowerIsBetter ? Math.min(...values) : Math.max(...values);
  });

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex items-center gap-4">
        <Button variant="ghost" size="icon" onClick={() => window.location.href = "/"}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        <div>
          <h1 className="text-3xl font-bold">Run #{run.id}</h1>
          <p className="text-muted-foreground text-sm mt-1">
            {run.timestamp ? format(new Date(run.timestamp), "PPpp") : "Unknown time"} - Task: <span className="capitalize font-medium text-foreground">{taskType}</span>
          </p>
        </div>
        <span className={clsx(
          "text-sm px-3 py-1 rounded-full font-semibold",
          run.status === "completed" ? "bg-emerald-500/20 text-emerald-400" :
          run.status === "running" ? "bg-amber-100 text-amber-700" :
          "bg-muted text-muted-foreground"
        )}>
          {run.status === "running" ? <Loader2 className="w-3 h-3 mr-1 animate-spin inline" /> : null}
          {run.status}
        </span>
      </div>

      {/* Live progress bar */}
      {run.status === "running" && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-amber-700">Evaluation in progress...</span>
              {progress && (
                <span className="text-sm font-mono text-muted-foreground">
                  {progress.completed}/{progress.total} items - {progress.percent}%
                </span>
              )}
            </div>
            <div className="w-full bg-muted rounded-full h-2">
              <div
                className="bg-amber-500 h-2 rounded-full transition-all duration-500"
                style={{ width: `${progress?.percent ?? 0}%` }}
              />
            </div>
            {sseError && <p className="text-xs text-red-400 mt-2">{sseError}</p>}
          </CardContent>
        </Card>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4">
        <Card>
          <CardContent className="p-5 flex items-center gap-3">
            <Cpu className="w-5 h-5 text-primary" />
            <div>
              <p className="text-xs text-muted-foreground">Models</p>
              <p className="text-2xl font-bold">{modelIds.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center gap-3">
            <Activity className="w-5 h-5 text-emerald-400" />
            <div>
              <p className="text-xs text-foreground/70">Metrics</p>
              <p className="text-2xl font-bold text-foreground">{allMetrics.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-purple-400" />
            <div>
              <p className="text-xs text-foreground/70">Results</p>
              <p className="text-2xl font-bold text-foreground">{(results as any[]).length}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Results table */}
      {allMetrics.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-foreground/70">
            {run.status === "running"
              ? "Results will appear as the evaluation completes..."
              : "No results recorded yet. Run the evaluation to see scores here."}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>Results</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border bg-muted">
                  <th className="text-left px-6 py-3 font-semibold text-foreground/80">Model</th>
                  {allMetrics.map(m => (
                    <th key={m} className="text-right px-5 py-3 font-semibold text-foreground/80 whitespace-nowrap">
                      {metricLabel(m)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {modelIds.map((mid, i) => {
                  const model = modelMap[mid];
                  return (
                    <tr key={mid} className={clsx("hover:bg-muted/40 transition-colors", i % 2 === 0 ? "" : "bg-muted/20")}>
                      <td className="px-6 py-4 font-mono text-xs text-foreground/80">
                        <div className="flex items-center gap-2">
                          <Cpu className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                          <span>{model?.name ?? `Model ${mid}`}</span>
                        </div>
                      </td>
                      {allMetrics.map(metric => {
                        const stat = grouped[mid]?.[metric];
                        const lowerIsBetter = LOWER_IS_BETTER.has(metric);
                        if (!stat) {
                          return <td key={metric} className="px-5 py-4 text-right font-mono text-foreground/70">-</td>;
                        }

                        // Determine color threshold based on the mean
                        const colorClass = clsx(
                          "tabular-nums",
                          !lowerIsBetter && stat.mean >= 0.5 ? "text-emerald-800" :
                          !lowerIsBetter && stat.mean >= 0.3 ? "text-amber-800" : "text-foreground/80"
                        );
                        const isBest = Number.isFinite(bestByMetric[metric]) && Math.abs(stat.mean - bestByMetric[metric]) < 1e-8;

                        return (
                          <td key={metric} className="px-5 py-4 text-right font-mono">
                            <div className="flex flex-col items-end">
                              <span
                                className={clsx(
                                  colorClass,
                                  isBest && "bg-amber-100 text-amber-900 ring-1 ring-amber-200 px-2 py-0.5 rounded-md"
                                )}
                              >
                                {formatScore(metric, stat.mean)}
                              </span>
                              {stat.moe > 0 && (
                                <span className="text-[10px] text-foreground/70" title="95% Confidence Interval Margin of Error">
                                  +/-{formatScore(metric, stat.moe)}
                                </span>
                              )}
                            </div>
                          </td>
                        );
                      })}
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      {/* Generation Examples */}
      {Object.keys(examples).length > 0 && (
        <div className="space-y-6 pt-10">
          <div>
            <h2 className="text-2xl font-bold">Generation Examples</h2>
            <p className="text-muted-foreground text-sm">Best and worst outputs for each model based on aggregated metric scores.</p>
          </div>

          {/* Task Prompt Box */}
          <div className="bg-white border border-border border-l-4 border-l-violet-500 rounded-xl p-6 text-center max-w-3xl mx-auto">
            <h3 className="text-xs font-bold text-violet-700 uppercase tracking-widest mb-3">Task Prompt</h3>
            <p className="text-lg font-medium text-foreground">
              {taskType === "summarization" ? "Summarize the following text in one or two sentences." :
               taskType === "qa" ? "Answer the following question based on the provided context." :
               taskType === "chat" ? "Respond thoughtfully to the user's conversational message." :
               taskType === "translation" ? "Translate the following text accurately." :
               taskType === "code" ? "Write or explain the code for the given problem." :
               taskType === "reasoning" ? "Think step-by-step and solve the logic puzzle." :
               "Process the input according to the evaluation task instructions."}
            </p>
          </div>

          {modelIds.map(mid => {
             const ex = examples[mid];
             const modelName = modelMap[mid]?.name ?? `Model ${mid}`;
             if (!ex) return null;
             return (
               <Card key={mid} className="overflow-hidden">
                 <CardHeader className="bg-muted border-b border-border py-4">
                   <CardTitle className="text-lg flex items-center gap-2">
                     <Cpu className="w-5 h-5 text-primary" /> {modelName}
                   </CardTitle>
                 </CardHeader>
                 <CardContent className="p-0 divide-y divide-border">
                   {ex.best && (
                     <div className="p-6 bg-white">
                       <h3 className="text-emerald-700 font-bold mb-4 flex items-center gap-2">
                          <CheckCircle2 className="w-5 h-5"/> Highest Scoring Output (Average Quality Score: {formatScore("quality", ex.best.avgScore)})
                       </h3>
                       <div className="grid grid-cols-5 gap-6">
                         <div className="col-span-2 space-y-2">
                          <p className="text-xs text-muted-foreground uppercase w-full tracking-widest font-semibold text-center border-b border-border pb-2">Prompt Input</p>
                           <div className="p-2 text-sm text-muted-foreground whitespace-pre-wrap font-mono h-[250px] overflow-y-auto">{ex.best.input}</div>
                         </div>
                         <div className="col-span-3 space-y-2">
                          <p className="text-xs text-muted-foreground uppercase w-full tracking-widest font-semibold text-center border-b border-border pb-2">Comparison</p>
                           <div className="grid grid-rows-2 h-[250px] gap-4">
                             <div className="bg-emerald-500/10 border border-emerald-500/20 p-4 rounded-xl overflow-y-auto text-sm text-foreground whitespace-pre-wrap">
                               <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider mb-2 block">Golden Truth</span>
                               {ex.best.expected}
                             </div>
                             <div className="bg-primary/10 border border-primary/20 p-4 rounded-xl overflow-y-auto text-sm whitespace-pre-wrap">
                               <span className="text-[10px] font-bold text-primary uppercase tracking-wider mb-2 block">Model Generation</span>
                               {ex.best.actual}
                             </div>
                           </div>
                         </div>
                       </div>
                     </div>
                   )}
                   {ex.worst && ex.worst.itemId !== ex.best?.itemId && (
                     <div className="p-6 bg-white">
                       <h3 className="text-rose-700 font-bold mb-4 flex items-center gap-2">
                          <AlertTriangle className="w-5 h-5"/> Lowest Scoring Output (Average Quality Score: {formatScore("quality", ex.worst.avgScore)})
                       </h3>
                       <div className="grid grid-cols-5 gap-6">
                         <div className="col-span-2 space-y-2">
                          <p className="text-xs text-muted-foreground w-full uppercase tracking-widest font-semibold text-center border-b border-border pb-2">Prompt Input</p>
                           <div className="p-2 text-sm text-muted-foreground whitespace-pre-wrap font-mono h-[250px] overflow-y-auto">{ex.worst.input}</div>
                         </div>
                         <div className="col-span-3 space-y-2">
                          <p className="text-xs text-muted-foreground w-full uppercase tracking-widest font-semibold text-center border-b border-border pb-2">Comparison</p>
                           <div className="grid grid-rows-2 h-[250px] gap-4">
                             <div className="bg-rose-500/10 border border-rose-500/20 p-4 rounded-xl overflow-y-auto text-sm text-foreground whitespace-pre-wrap">
                               <span className="text-[10px] font-bold text-rose-400 uppercase tracking-wider mb-2 block">Golden Truth</span>
                               {ex.worst.expected}
                             </div>
                             <div className="bg-primary/10 border border-primary/20 p-4 rounded-xl overflow-y-auto text-sm whitespace-pre-wrap">
                               <span className="text-[10px] font-bold text-primary uppercase tracking-wider mb-2 block">Model Generation</span>
                               {ex.worst.actual}
                             </div>
                           </div>
                         </div>
                       </div>
                     </div>
                   )}
                 </CardContent>
               </Card>
             );
          })}
        </div>
      )}
    </div>
  );
}
