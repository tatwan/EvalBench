import { useParams } from "wouter";
import { useEffect, useRef, useState } from "react";
import { useEvalRun, useEvalResults } from "@/hooks/use-eval";
import { useModels } from "@/hooks/use-models";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
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
  // Percentage-like scores (0–1 range)
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
  };
  return MAP[name] ?? name;
}

// Group results: { modelId → { metricName → avgScore } }
function groupResults(results: any[]) {
  const grouped: Record<number, Record<string, number[]>> = {};
  for (const r of results) {
    if (!grouped[r.modelId]) grouped[r.modelId] = {};
    if (!grouped[r.modelId][r.metricName]) grouped[r.modelId][r.metricName] = [];
    grouped[r.modelId][r.metricName].push(r.score);
  }
  // Average across items
  const avg: Record<number, Record<string, number>> = {};
  for (const [mid, metrics] of Object.entries(grouped)) {
    avg[+mid] = {};
    for (const [metric, scores] of Object.entries(metrics)) {
      avg[+mid][metric] = scores.reduce((a, b) => a + b, 0) / scores.length;
    }
  }
  return avg;
}

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

  const grouped = groupResults(results as any[]);
  const modelMap = Object.fromEntries((models as any[]).map((m: any) => [m.id, m]));
  const config = run.configJson as any ?? {};
  const taskType = config.taskType ?? "—";
  const allMetrics = Array.from(new Set((results as any[]).map((r: any) => r.metricName)));
  const modelIds = Object.keys(grouped).map(Number);
  const examples = getExamplesPerModel(results as any[]);

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
            {run.timestamp ? format(new Date(run.timestamp), "PPpp") : "Unknown time"} · Task: <span className="capitalize font-medium text-foreground">{taskType}</span>
          </p>
        </div>
        <span className={clsx(
          "text-sm px-3 py-1 rounded-full font-semibold",
          run.status === "completed" ? "bg-emerald-500/20 text-emerald-400" :
          run.status === "running" ? "bg-amber-500/20 text-amber-400" :
          "bg-white/10 text-muted-foreground"
        )}>
          {run.status === "running" ? <Loader2 className="w-3 h-3 mr-1 animate-spin inline" /> : null}
          {run.status}
        </span>
      </div>

      {/* Live progress bar */}
      {run.status === "running" && (
        <Card className="border-amber-500/20 bg-amber-500/5">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-amber-300">Evaluation in progress…</span>
              {progress && (
                <span className="text-sm font-mono text-muted-foreground">
                  {progress.completed}/{progress.total} items — {progress.percent}%
                </span>
              )}
            </div>
            <div className="w-full bg-white/10 rounded-full h-2">
              <div
                className="bg-amber-400 h-2 rounded-full transition-all duration-500"
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
              <p className="text-xs text-muted-foreground">Metrics</p>
              <p className="text-2xl font-bold">{allMetrics.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-purple-400" />
            <div>
              <p className="text-xs text-muted-foreground">Results</p>
              <p className="text-2xl font-bold">{(results as any[]).length}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Results table */}
      {allMetrics.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-muted-foreground">
            {run.status === "running"
              ? "Results will appear as the evaluation completes…"
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
                <tr className="border-b border-white/10 bg-white/5">
                  <th className="text-left px-6 py-3 font-semibold text-muted-foreground">Model</th>
                  {allMetrics.map(m => (
                    <th key={m} className="text-right px-5 py-3 font-semibold text-muted-foreground whitespace-nowrap">
                      {metricLabel(m)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-white/5">
                {modelIds.map((mid, i) => {
                  const model = modelMap[mid];
                  return (
                    <tr key={mid} className={clsx("hover:bg-white/3 transition-colors", i % 2 === 0 ? "" : "bg-white/[0.01]")}>
                      <td className="px-6 py-4 font-mono text-xs">
                        <div className="flex items-center gap-2">
                          <Cpu className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                          <span>{model?.name ?? `Model ${mid}`}</span>
                        </div>
                      </td>
                      {allMetrics.map(metric => {
                        const val = grouped[mid]?.[metric];
                        const lowerIsBetter = LOWER_IS_BETTER.has(metric);
                        return (
                          <td key={metric} className="px-5 py-4 text-right font-mono">
                            {val !== undefined ? (
                              <span className={clsx(
                                "tabular-nums",
                                !lowerIsBetter && val >= 0.5 ? "text-emerald-400" :
                                !lowerIsBetter && val >= 0.3 ? "text-amber-400" : "text-muted-foreground"
                              )}>
                                {formatScore(metric, val)}
                              </span>
                            ) : (
                              <span className="text-white/20">—</span>
                            )}
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
          <div className="bg-primary/5 border border-primary/20 rounded-xl p-6 text-center max-w-3xl mx-auto">
            <h3 className="text-xs font-bold text-primary uppercase tracking-widest mb-3">Task Prompt</h3>
            <p className="text-lg font-medium text-white/90">
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
                 <CardHeader className="bg-white/5 border-b border-white/10 py-4">
                   <CardTitle className="text-lg flex items-center gap-2">
                     <Cpu className="w-5 h-5 text-primary" /> {modelName}
                   </CardTitle>
                 </CardHeader>
                 <CardContent className="p-0 divide-y divide-white/10">
                   {ex.best && (
                     <div className="p-6 bg-emerald-500/5">
                       <h3 className="text-emerald-400 font-bold mb-4 flex items-center gap-2">
                          <CheckCircle2 className="w-5 h-5"/> Highest Scoring Output (Score: {formatScore("quality", ex.best.avgScore)})
                       </h3>
                       <div className="grid grid-cols-5 gap-6">
                         <div className="col-span-2 space-y-2">
                           <p className="text-xs text-muted-foreground uppercase w-full tracking-widest font-semibold text-center border-b border-white/5 pb-2">Prompt Input</p>
                           <div className="p-2 text-sm text-muted-foreground whitespace-pre-wrap font-mono h-[250px] overflow-y-auto">{ex.best.input}</div>
                         </div>
                         <div className="col-span-3 space-y-2">
                           <p className="text-xs text-muted-foreground uppercase w-full tracking-widest font-semibold text-center border-b border-white/5 pb-2">Comparison</p>
                           <div className="grid grid-rows-2 h-[250px] gap-4">
                             <div className="bg-emerald-500/10 border border-emerald-500/20 p-4 rounded-xl overflow-y-auto text-sm text-emerald-100/90 whitespace-pre-wrap">
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
                     <div className="p-6 bg-rose-500/5">
                       <h3 className="text-rose-400 font-bold mb-4 flex items-center gap-2">
                          <AlertTriangle className="w-5 h-5"/> Lowest Scoring Output (Score: {formatScore("quality", ex.worst.avgScore)})
                       </h3>
                       <div className="grid grid-cols-5 gap-6">
                         <div className="col-span-2 space-y-2">
                           <p className="text-xs text-muted-foreground w-full uppercase tracking-widest font-semibold text-center border-b border-white/5 pb-2">Prompt Input</p>
                           <div className="p-2 text-sm text-muted-foreground whitespace-pre-wrap font-mono h-[250px] overflow-y-auto">{ex.worst.input}</div>
                         </div>
                         <div className="col-span-3 space-y-2">
                           <p className="text-xs text-muted-foreground w-full uppercase tracking-widest font-semibold text-center border-b border-white/5 pb-2">Comparison</p>
                           <div className="grid grid-rows-2 h-[250px] gap-4">
                             <div className="bg-rose-500/10 border border-rose-500/20 p-4 rounded-xl overflow-y-auto text-sm text-rose-100/90 whitespace-pre-wrap">
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
