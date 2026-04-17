import { useParams, useLocation } from "wouter";
import { useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useCancelEvalRun, useEvalRun, useEvalResults, useEvalStats } from "@/hooks/use-eval";
import { useModels } from "@/hooks/use-models";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { MetricTooltip } from "@/components/ui/MetricTooltip";
import { Activity, Cpu, ArrowLeft, CheckCircle2, Loader2, ShieldAlert, RotateCcw, Database, Download } from "lucide-react";
import { Button } from "@/components/ui/Button";
import { format } from "date-fns";
import { clsx } from "clsx";
import { AlertTriangle } from "lucide-react";

// Metrics where higher is NOT better (lower latency = better)
const LOWER_IS_BETTER = new Set(["total_latency_s", "load_latency_s", "perplexity"]);
const QUALITY_EXCLUDED_METRICS = new Set([
  "tokens_per_second",
  "total_latency_s",
  "load_latency_s",
  "prompt_tokens",
  "output_tokens",
  "perplexity",
]);
const JUDGE_METRICS = new Set([
  "llm_coherence",
  "llm_relevance",
  "llm_fluency",
  "llm_faithfulness",
  "llm_correctness",
  "context_relevance",
  "faithfulness",
]);
const TASKS_WITH_JUDGE = new Set(["summarization", "qa", "chat", "knowledge", "safety", "rag"]);
const SCORE_PRECISION: Record<string, number> = {
  tokens_per_second: 1,
  total_latency_s: 2,
  load_latency_s: 2,
  prompt_tokens: 0,
  output_tokens: 0,
  bleu: 1,
  chrf: 1,
  perplexity: 2,
};

function formatScore(name: string, value: number): string {
  const prec = SCORE_PRECISION[name] ?? 3;
  if (!["bleu", "chrf", "tokens_per_second", "total_latency_s", "load_latency_s", "prompt_tokens", "output_tokens", "perplexity"].includes(name)) {
    return `${(value * 100).toFixed(1)}%`;
  }
  return value.toFixed(prec);
}

function metricLabel(name: string): string {
  const MAP: Record<string, string> = {
    rouge1: "ROUGE-1", rouge2: "ROUGE-2", rougeL: "ROUGE-L", rougeLsum: "ROUGE-Lsum",
    meteor: "METEOR", bleu: "BLEU", chrf: "chrF",
    exact_match: "Exact Match", f1: "Token F1",
    distinct1: "Distinct-1", distinct2: "Distinct-2",
    pass_at_1: "Pass@1", pass_at_3: "Pass@3", pass_at_10: "Pass@10",
    tokens_per_second: "Tokens/sec", total_latency_s: "Latency (s)",
    load_latency_s: "Load Time (s)", prompt_tokens: "Prompt Tokens",
    output_tokens: "Output Tokens", perplexity: "Perplexity",
    cosine_sim: "Cosine Sim", recall_at_1: "Recall@1", recall_at_3: "Recall@3", mrr: "MRR", ndcg: "NDCG",
    semantic_sim: "Semantic Sim",
    bertscore_f1: "BERTScore F1",
    llm_coherence: "Judge Coherence",
    llm_relevance: "Judge Relevance",
    llm_fluency: "Judge Fluency",
    llm_faithfulness: "Judge Faithfulness",
    llm_correctness: "Judge Correctness",
    context_relevance: "Judge Context Relevance",
    faithfulness: "Judge Faithfulness",
  };
  return MAP[name] ?? name;
}

function highlightedMetricsForTask(taskType: string, metricScores: Record<string, number>) {
  const preferredByTask: Record<string, string[]> = {
    summarization: ["rougeLsum", "bertscore_f1", "llm_coherence", "llm_relevance"],
    qa: ["llm_correctness", "llm_relevance", "semantic_sim", "f1"],
    reasoning: ["llm_correctness", "f1", "exact_match"],
    knowledge: ["llm_correctness", "llm_relevance", "exact_match"],
    safety: ["llm_relevance", "exact_match"],
    chat: ["llm_coherence", "llm_fluency", "distinct1"],
    translation: ["bleu", "chrf", "meteor"],
    code: ["pass_at_1", "pass_at_3", "rouge1", "distinct1"],
    embedding: ["cosine_sim", "recall_at_1", "recall_at_3", "mrr", "ndcg"],
    classification: ["exact_match"],
    rag: ["context_relevance", "faithfulness"],
  };
  const ordered = preferredByTask[taskType] ?? Object.keys(metricScores);
  return ordered
    .filter((metric) => metricScores[metric] !== undefined)
    .map((metric) => ({ metric, score: metricScores[metric] }));
}

function exampleMetricSectionLabel(taskType: string): string {
  return taskType === "code" ? "Per-Example Test Signals" : "Per-Example Metric Values";
}

// We no longer manually group results here, we use the backend's /stats endpoint

function splitJudgeOutput(rawOutput?: string | null) {
  const content = rawOutput ?? "";
  const marker = "\n\n--- Judge Rationale ---\n";
  if (!content.includes(marker)) {
    return { generation: content, rationale: null };
  }
  const [generation, rationale] = content.split(marker, 2);
  return { generation, rationale };
}

function getExamplesPerModel(results: any[]) {
  // filter out speed metrics for scoring
  const qualityResults = results.filter(r => 
    !r.error &&
    !QUALITY_EXCLUDED_METRICS.has(r.metricName)
  );

  const modelItemScores: Record<number, Record<number, {
    scoreSum: number,
    count: number,
    input: string,
    expectedOutput: string,
    context: string | null,
    actualOutput: string,
    metricScores: Record<string, number>,
    judgeRationales: Array<{ metricName: string; rationale: string }>,
  }>> = {};

  for (const r of qualityResults) {
    if (!r.itemId) continue;
    if (!modelItemScores[r.modelId]) modelItemScores[r.modelId] = {};
    if (!modelItemScores[r.modelId][r.itemId]) {
      const split = splitJudgeOutput(r.rawOutput);
      modelItemScores[r.modelId][r.itemId] = {
        scoreSum: 0,
        count: 0,
        input: r.input,
        expectedOutput: r.expectedOutput,
        context: r.context ?? null,
        actualOutput: JUDGE_METRICS.has(r.metricName) ? split.generation : (r.rawOutput ?? ""),
        metricScores: {},
        judgeRationales: [],
      };
    }
    modelItemScores[r.modelId][r.itemId].scoreSum += r.score;
    modelItemScores[r.modelId][r.itemId].count += 1;
    modelItemScores[r.modelId][r.itemId].metricScores[r.metricName] = r.score;
    const split = splitJudgeOutput(r.rawOutput);
    if (!JUDGE_METRICS.has(r.metricName) && split.generation) {
      modelItemScores[r.modelId][r.itemId].actualOutput = split.generation;
    }
    if (JUDGE_METRICS.has(r.metricName) && split.rationale) {
      modelItemScores[r.modelId][r.itemId].judgeRationales.push({
        metricName: r.metricName,
        rationale: split.rationale,
      });
      if (!modelItemScores[r.modelId][r.itemId].actualOutput) {
        modelItemScores[r.modelId][r.itemId].actualOutput = split.generation;
      }
    }
  }

  const examples: Record<number, { best?: any, worst?: any }> = {};

  for (const [mid, items] of Object.entries(modelItemScores)) {
    const scoredItems = Object.entries(items).map(([itemId, data]: [string, any]) => ({
      itemId: Number(itemId),
      avgScore: data.scoreSum / data.count,
      metricCount: data.count,
      input: data.input,
      expected: data.expectedOutput,
      context: data.context,
      actual: data.actualOutput,
      metricScores: data.metricScores,
      judgeRationales: data.judgeRationales,
    }));

    scoredItems.sort((a, b) => b.avgScore - a.avgScore);

    if (scoredItems.length > 0) {
      const best = scoredItems[0];
      const worstCandidate = scoredItems.length > 1 ? scoredItems[scoredItems.length - 1] : undefined;
      examples[Number(mid)] = {
        best,
        worst:
          worstCandidate && Math.abs((worstCandidate.avgScore ?? 0) - (best.avgScore ?? 0)) > 1e-8
            ? worstCandidate
            : undefined,
      };
    }
  }

  return examples;
}

function parseCodeTests(context?: string | null): string | null {
  if (!context) return null;
  try {
    const parsed = JSON.parse(context);
    return typeof parsed?.tests === "string" ? parsed.tests : null;
  } catch {
    return null;
  }
}

function exampleReferenceLabel(taskType: string): string {
  return taskType === "code" ? "Unit Tests" : "Reference Answer";
}

function exampleReferenceContent(taskType: string, example: any): string {
  if (taskType === "code") {
    return parseCodeTests(example.context) ?? example.expected ?? "No tests captured.";
  }
  return example.expected ?? "";
}

function examplePrimaryInputLabel(taskType: string): string {
  return taskType === "code" ? "Problem" : "Prompt Input";
}

function getExampleMetricDisplay(taskType: string, metricScores: Record<string, number>, maxVisible = 6) {
  const ordered = highlightedMetricsForTask(taskType, metricScores);
  return {
    total: ordered.length,
    visible: ordered.slice(0, maxVisible),
    hiddenCount: Math.max(0, ordered.length - maxVisible),
  };
}

function exampleScoreCopy(metricCount: number, visibleCount: number, hiddenCount: number): string {
  if (hiddenCount > 0) {
    return `Average of ${metricCount} successful metrics for this specific query. Showing ${visibleCount} here. This does not represent the model's overall run average.`;
  }
  return `Average of the ${metricCount} metrics below for this specific query. This does not represent the model's overall run average.`;
}

function exampleMetricCopy(total: number, hiddenCount: number): string {
  if (hiddenCount > 0) {
    return `These badges belong to this example only. Showing ${total - hiddenCount} of ${total} metrics used in its score.`;
  }
  return "These badges belong to this example only. They are the metrics used in this example score.";
}

function parseEmbeddingOutput(rawOutput?: string | null): {
  topMatch: string | null;
  topSimilarity: number | null;
  rankedIndices: number[];
} | null {
  if (!rawOutput) return null;
  try {
    const parsed = JSON.parse(rawOutput);
    if (!parsed || typeof parsed !== "object") return null;
    return {
      topMatch: typeof parsed.top_match === "string" ? parsed.top_match : null,
      topSimilarity: typeof parsed.top_similarity === "number" ? parsed.top_similarity : null,
      rankedIndices: Array.isArray(parsed.ranked_indices)
        ? parsed.ranked_indices.filter((value: unknown) => typeof value === "number")
        : [],
    };
  } catch {
    return null;
  }
}

function renderModelGeneration(taskType: string, actualOutput: string) {
  if (taskType === "embedding") {
    const parsed = parseEmbeddingOutput(actualOutput);
    if (parsed) {
      return (
        <div className="space-y-3">
          <div className="whitespace-pre-wrap text-foreground">
            {parsed.topMatch ?? "No top match captured."}
          </div>
          <div className="flex flex-wrap gap-2 text-[11px]">
            {typeof parsed.topSimilarity === "number" ? (
              <Badge variant="secondary" className="font-mono text-[11px]">
                Retrieved Similarity {(parsed.topSimilarity * 100).toFixed(1)}%
              </Badge>
            ) : null}
            {parsed.rankedIndices.length > 0 ? (
              <Badge variant="secondary" className="font-mono text-[11px]">
                Ranked Indices {parsed.rankedIndices.join(", ")}
              </Badge>
            ) : null}
          </div>
          <p className="text-xs text-muted-foreground">
            Retrieved similarity is the model&apos;s top-match score inside its candidate list. Cosine Sim is EvalBench&apos;s scored metric for this query.
          </p>
        </div>
      );
    }
  }
  return <>{actualOutput || "No generation captured."}</>;
}

export default function RunDetails() {
  const queryClient = useQueryClient();
  const params = useParams<{ id: string }>();
  const runId = parseInt(params.id ?? "0", 10);
  const [, navigate] = useLocation();

  const { data: run, isLoading: runLoading, refetch: refetchRun } = useEvalRun(runId);
  const { data: results = [], refetch: refetchResults } = useEvalResults(runId);
  const { data: stats = [], refetch: refetchStats } = useEvalStats(runId);
  const { data: models = [] } = useModels();
  const cancelRun = useCancelEvalRun();

  // SSE progress
  const [progress, setProgress] = useState<{
    completed: number;
    total: number;
    percent: number;
    started?: number;
    active?: number;
    phase?: string | null;
    message?: string | null;
  } | null>(null);
  const [streamNotice, setStreamNotice] = useState<{ message: string; tone: "info" | "warning" | "error" } | null>(null);
  const esRef = useRef<EventSource | null>(null);

  useEffect(() => {
    if (!run || !["running", "cancel_requested"].includes(run.status)) return;
    const es = new EventSource(`/api/eval-runs/${runId}/progress`);
    esRef.current = es;
    es.onmessage = (e) => {
      const event = JSON.parse(e.data);
      if (event.type === "progress") {
        setProgress({
          completed: event.completed,
          total: event.total,
          percent: event.percent,
          started: event.started,
          active: event.active,
          phase: event.phase ?? null,
          message: event.message ?? null,
        });
      }
      if (event.type === "warning" || event.type === "info" || event.type === "error") {
        setStreamNotice({
          message: event.message || event.error,
          tone: event.type === "error" ? "error" : event.type === "warning" ? "warning" : "info",
        });
      }
      if (event.done) {
        es.close();
        queryClient.invalidateQueries({ queryKey: ["/api/eval-runs"] });
        queryClient.invalidateQueries({ queryKey: ["/api/eval-runs/:id", runId] });
        queryClient.invalidateQueries({ queryKey: ["/api/eval-runs/:id/results", runId] });
        queryClient.invalidateQueries({ queryKey: ["/api/eval-runs/:id/stats", runId] });
        queryClient.invalidateQueries({ queryKey: ["/api/eval-results"] });
        queryClient.invalidateQueries({ queryKey: ["/api/models"] });
        refetchRun();
        refetchResults();
        refetchStats();
        setProgress(null);
      }
    };
    es.onerror = () => {
      setStreamNotice({ message: "Lost connection to progress stream.", tone: "error" });
      es.close();
    };
    return () => es.close();
  }, [run?.status, runId, queryClient, refetchRun, refetchResults, refetchStats]);

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
  const resultModelNames = Object.fromEntries(
    (results as any[])
      .filter((r: any) => r.modelName)
      .map((r: any) => [r.modelId, r.modelName])
  );
  const config = run.configJson as any ?? {};
  const taskType = config.taskType ?? "-";
  const taskUsesJudge = TASKS_WITH_JUDGE.has(taskType);
  const configuredLocalModelIds = Array.isArray(config.modelIds) ? config.modelIds : [];
  const configuredCloudModels = Array.isArray(config.cloudModels) ? config.cloudModels : [];
  const configuredModelCount = configuredLocalModelIds.length + configuredCloudModels.length;
  const judgeModel = config.judgeModel ?? null;
  const judgeProvider = config.judgeProvider ?? null;
  const totalPairs = typeof config.totalPairs === "number" ? config.totalPairs : null;
  const completedPairs = typeof config.completedPairs === "number" ? config.completedPairs : null;
  const startedPairs = typeof config.startedPairs === "number" ? config.startedPairs : 0;
  const activePairs = typeof config.activePairs === "number" ? config.activePairs : 0;
  const progressPhase = typeof config.progressPhase === "string" ? config.progressPhase : null;
  const progressMessage = typeof config.progressMessage === "string" ? config.progressMessage : null;
  const errorCount = typeof config.errorCount === "number" ? config.errorCount : 0;
  const retryCount = typeof config.retryCount === "number" ? config.retryCount : 0;
  const cacheHits = typeof config.cacheHits === "number" ? config.cacheHits : 0;
  const completedWithErrors = Boolean(config.completedWithErrors);
  const successRate = totalPairs && totalPairs > 0 ? Math.max(0, (totalPairs - errorCount) / totalPairs) : null;
  const runLooksFinished = totalPairs !== null && completedPairs !== null && totalPairs > 0 && completedPairs >= totalPairs;
  const displayStatus =
    run.status === "running" && runLooksFinished
      ? "completed"
      : run.status;
  const allMetrics = Array.from(new Set([
    ...(stats as any[]).map((s: any) => s.metricName),
    ...(results as any[]).filter((r) => r.error).map((r) => r.metricName),
  ]));
  const orderedMetrics = [
    ...allMetrics.filter((metric) => !JUDGE_METRICS.has(metric) && !QUALITY_EXCLUDED_METRICS.has(metric)),
    ...allMetrics.filter((metric) => JUDGE_METRICS.has(metric)),
    ...allMetrics.filter((metric) => QUALITY_EXCLUDED_METRICS.has(metric)),
  ];
  const modelIds = Array.from(new Set([
    ...Object.keys(grouped).map(Number),
    ...(results as any[]).map((r: any) => Number(r.modelId)).filter((value: number) => Number.isFinite(value)),
  ]));
  const examples = getExamplesPerModel(results as any[]);
  const metricRowsPerPair = totalPairs && totalPairs > 0 ? (results as any[]).length / totalPairs : null;
  const liveCompleted = progress?.completed ?? completedPairs ?? 0;
  const liveTotal = progress?.total ?? totalPairs ?? 0;
  const livePercent = progress?.percent ?? (liveTotal > 0 ? Math.round((liveCompleted / liveTotal) * 100) : 0);
  const liveStarted = progress?.started ?? startedPairs;
  const liveActive = progress?.active ?? activePairs;
  const livePhase = progress?.phase ?? progressPhase;
  const liveMessage = progress?.message ?? progressMessage;

  const bestByMetric: Record<string, number> = {};
  orderedMetrics.forEach((metric) => {
    const values = modelIds
      .map((mid) => grouped[mid]?.[metric]?.mean)
      .filter((v): v is number => typeof v === "number");
    if (values.length === 0) return;
    const lowerIsBetter = LOWER_IS_BETTER.has(metric);
    bestByMetric[metric] = lowerIsBetter ? Math.min(...values) : Math.max(...values);
  });

  const downloadFile = (name: string, content: string, type: string) => {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = name;
    a.click();
    URL.revokeObjectURL(url);
  };

  const formatStat = (metric: string, stat?: { mean: number; moe: number }) => {
    if (!stat) return "";
    const mean = formatScore(metric, stat.mean);
    if (stat.moe > 0) {
      const moe = formatScore(metric, stat.moe);
      return `${mean} ± ${moe}`;
    }
    return mean;
  };

  const exportCsv = () => {
    const headers = ["Model", ...orderedMetrics.map(metricLabel)];
    const rows = modelIds.map((mid) => {
      const modelName = modelMap[mid]?.name ?? resultModelNames[mid] ?? `Model ${mid}`;
      const values = orderedMetrics.map((metric) => {
        const stat = grouped[mid]?.[metric];
        return stat ? formatStat(metric, stat) : "";
      });
      return [modelName, ...values].map((value) => `"${String(value).replace(/"/g, '""')}"`).join(",");
    });
    downloadFile(`evalbench-run-${run.id}.csv`, [headers.join(","), ...rows].join("\n"), "text/csv");
  };

  const exportMarkdown = () => {
    const headers = ["Model", ...orderedMetrics.map(metricLabel)];
    const separator = headers.map(() => "---");
    const rows = modelIds.map((mid) => {
      const modelName = modelMap[mid]?.name ?? resultModelNames[mid] ?? `Model ${mid}`;
      const values = orderedMetrics.map((metric) => {
        const stat = grouped[mid]?.[metric];
        return stat ? formatStat(metric, stat) : "-";
      });
      return [modelName, ...values].join(" | ");
    });
    const md = [
      `| ${headers.join(" | ")} |`,
      `| ${separator.join(" | ")} |`,
      ...rows.map((r) => `| ${r} |`),
    ].join("\n");
    downloadFile(`evalbench-run-${run.id}.md`, md, "text/markdown");
  };

  const exportJson = async () => {
    const response = await fetch(`/api/eval-runs/${run.id}/export?format=json`, { credentials: "include" });
    if (!response.ok) throw new Error("Failed to export JSON");
    const data = await response.json();
    downloadFile(`evalbench-run-${run.id}.json`, JSON.stringify(data, null, 2), "application/json");
  };

  return (
    <div className="space-y-8 max-w-5xl mx-auto">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate("/")}>
            <ArrowLeft className="w-5 h-5" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Run #{run.id}</h1>
            <p className="text-muted-foreground text-sm mt-1">
              {run.timestamp ? format(new Date(run.timestamp), "PPpp") : "Unknown time"} - Task: <span className="capitalize font-medium text-foreground">{taskType}</span>
            </p>
            <div className="flex flex-wrap gap-2 mt-2">
              {taskUsesJudge && judgeModel ? (
                <>
                  <Badge variant="secondary">Judge: {judgeModel}</Badge>
                  {judgeProvider ? <Badge variant="outline" className="capitalize">{judgeProvider}</Badge> : null}
                </>
              ) : null}
            </div>
          </div>
          <span className={clsx(
            "text-sm px-3 py-1 rounded-full font-semibold",
            displayStatus === "completed" ? "bg-emerald-500/20 text-emerald-400" :
            displayStatus === "running" || displayStatus === "cancel_requested" ? "bg-amber-100 text-amber-700" :
            displayStatus === "cancelled" ? "bg-slate-200 text-slate-700" :
            "bg-muted text-muted-foreground"
          )}>
            {displayStatus === "running" || displayStatus === "cancel_requested" ? <Loader2 className="w-3 h-3 mr-1 animate-spin inline" /> : null}
            {displayStatus}
          </span>
        </div>
        <div className="flex gap-2">
          {run.status === "running" && (
            <Button variant="outline" size="sm" onClick={() => cancelRun.mutate(run.id)} disabled={cancelRun.isPending}>
              Cancel Run
            </Button>
          )}
          <Button variant="outline" size="sm" onClick={exportCsv}>Export Scores CSV</Button>
          <Button variant="outline" size="sm" onClick={exportMarkdown}>Export Scores Markdown</Button>
          <Button variant="outline" size="sm" onClick={() => void exportJson()} className="gap-2">
            <Download className="w-4 h-4" />
            Export Run JSON
          </Button>
        </div>
      </div>

      {/* Live progress bar */}
      {((run.status === "running" || run.status === "cancel_requested") && !runLooksFinished) && (
        <Card className="border-amber-200 bg-amber-50">
          <CardContent className="p-5">
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm font-medium text-amber-700">
                {run.status === "cancel_requested" ? "Cancellation requested..." : "Evaluation in progress..."}
              </span>
              {(liveTotal > 0 || liveCompleted > 0) && (
                <span className="text-sm font-mono text-muted-foreground">
                  {liveCompleted}/{liveTotal} items - {livePercent}%
                </span>
              )}
            </div>
            <div className="w-full bg-muted rounded-full h-2">
              <div
                className="bg-amber-500 h-2 rounded-full transition-all duration-500"
                style={{ width: `${livePercent}%` }}
              />
            </div>
            <div className="mt-3 flex flex-wrap gap-3 text-xs text-amber-800">
              <span>{liveStarted} started</span>
              <span>{liveActive} active</span>
              {livePhase ? <span className="capitalize">{livePhase.replace(/_/g, " ")}</span> : null}
            </div>
            {liveMessage ? (
              <p className="text-xs mt-2 text-amber-800/90">{liveMessage}</p>
            ) : null}
            {streamNotice && (
              <p className={clsx(
                "text-xs mt-2",
                streamNotice.tone === "error" && "text-rose-700",
                streamNotice.tone === "warning" && "text-amber-700",
                streamNotice.tone === "info" && "text-sky-700"
              )}>
                {streamNotice.message}
              </p>
            )}
          </CardContent>
        </Card>
      )}

      {/* Stats row */}
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Card>
          <CardContent className="p-5 flex items-center gap-3">
            <Cpu className="w-5 h-5 text-primary" />
            <div>
              <p className="text-xs text-muted-foreground">Models</p>
              <p className="text-2xl font-bold">{configuredModelCount || modelIds.length}</p>
              {configuredCloudModels.length > 0 ? (
                <p className="text-[11px] text-muted-foreground mt-1">
                  {configuredLocalModelIds.length} local + {configuredCloudModels.length} comparison
                </p>
              ) : null}
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center gap-3">
            <Activity className="w-5 h-5 text-emerald-400" />
            <div>
              <p className="text-xs text-foreground/80">Metric Types</p>
              <p className="text-2xl font-bold text-foreground">{allMetrics.length}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center gap-3">
            <CheckCircle2 className="w-5 h-5 text-purple-400" />
            <div>
              <p className="text-xs text-foreground/80">Stored Rows</p>
              <p className="text-2xl font-bold text-foreground">{(results as any[]).length}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center gap-3">
            <ShieldAlert className="w-5 h-5 text-rose-500" />
            <div>
              <p className="text-xs text-foreground/80">Failed Pairs</p>
              <p className="text-2xl font-bold text-foreground">{errorCount}</p>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-5 flex items-center gap-3">
            <RotateCcw className="w-5 h-5 text-amber-500" />
            <div>
              <p className="text-xs text-foreground/80">Retries</p>
              <p className="text-2xl font-bold text-foreground">{retryCount}</p>
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            Reliability
            <MetricTooltip description="Pairs are model × item units of work. Each pair can write multiple metric rows, so stored rows will usually exceed pair counts." />
          </CardTitle>
        </CardHeader>
        <CardContent className="grid grid-cols-1 md:grid-cols-5 gap-4">
          <div>
            <p className="text-xs text-muted-foreground">Completed Pairs</p>
            <p className="text-lg font-semibold">
              {completedPairs ?? 0}{totalPairs ? ` / ${totalPairs}` : ""}
            </p>
            <p className="text-xs text-muted-foreground mt-1">One pair = one model on one dataset item.</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Success Rate</p>
            <p className="text-lg font-semibold">{successRate === null ? "—" : `${(successRate * 100).toFixed(1)}%`}</p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Cache Hits</p>
            <p className="text-lg font-semibold flex items-center gap-2">
              <Database className="w-4 h-4 text-emerald-500" />
              {cacheHits}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Row Density</p>
            <p className="text-sm text-muted-foreground">
              {metricRowsPerPair ? `${metricRowsPerPair.toFixed(1)} stored rows per pair on average.` : "Row density appears after results are written."}
            </p>
          </div>
          <div>
            <p className="text-xs text-muted-foreground">Status Notes</p>
            <p className="text-sm text-muted-foreground">
              {completedWithErrors
                ? "This run completed, but failed pairs are excluded from aggregated score stats."
                : errorCount > 0
                ? "Failed pairs are excluded from aggregated score stats."
                : "No failed pairs were recorded for this run."}
            </p>
          </div>
        </CardContent>
      </Card>

      {/* Results table */}
      {orderedMetrics.length === 0 ? (
        <Card>
          <CardContent className="py-16 text-center text-foreground/70">
            {run.status === "running" || run.status === "cancel_requested"
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
                  <th className="text-left px-6 py-3 font-semibold text-foreground/90">Model</th>
                  {orderedMetrics.map(m => (
                    <th key={m} className="text-right px-5 py-3 font-semibold text-foreground/90 whitespace-nowrap">
                      <div className="flex flex-col items-end">
                        <span>{metricLabel(m)}</span>
                        {JUDGE_METRICS.has(m) ? (
                          <span className="text-[10px] font-normal text-amber-700">Judge</span>
                        ) : null}
                      </div>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {modelIds.map((mid, i) => {
                  const model = modelMap[mid];
                  return (
                    <tr key={mid} className={clsx("hover:bg-muted/40 transition-colors", i % 2 === 0 ? "" : "bg-muted/20")}>
                      <td className="px-6 py-4 font-mono text-xs text-foreground/90">
                        <div className="flex items-center gap-2">
                          <Cpu className="w-3.5 h-3.5 text-primary flex-shrink-0" />
                          <span>{model?.name ?? `Model ${mid}`}</span>
                        </div>
                      </td>
                      {orderedMetrics.map(metric => {
                        const stat = grouped[mid]?.[metric];
                        const lowerIsBetter = LOWER_IS_BETTER.has(metric);
                        const hasError = (results as any[]).some(
                          (r) => r.modelId === mid && r.metricName === metric && r.error
                        );

                        if (!stat && hasError) {
                          return (
                            <td key={metric} className="px-5 py-4 text-right font-mono text-xs">
                              <span className="bg-rose-100 text-rose-700 px-2 py-0.5 rounded-md font-semibold font-sans">
                                [Failed]
                              </span>
                            </td>
                          );
                        }

                        if (!stat) {
                          return <td key={metric} className="px-5 py-4 text-right font-mono text-foreground/80">-</td>;
                        }

                        // Determine color threshold based on the mean
                        const colorClass = clsx(
                          "tabular-nums",
                          !lowerIsBetter && stat.mean >= 0.5 ? "text-emerald-800" :
                          !lowerIsBetter && stat.mean >= 0.3 ? "text-amber-900" : "text-foreground/90"
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
                                <span className="text-[10px] text-foreground/80" title="95% Confidence Interval Margin of Error">
                                  +/-{formatScore(metric, stat.moe)}
                                </span>
                              )}
                              {hasError && (
                                <span className="text-[10px] text-amber-700" title="Some pairs for this metric failed, but successful rows were still aggregated.">
                                  partial failures
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
               taskType === "embedding" ? "Embed the query and rank candidates by semantic similarity." :
               taskType === "code" ? "Write or explain the code for the given problem." :
               taskType === "reasoning" ? "Think step-by-step and solve the logic puzzle." :
               taskType === "rag" ? "Answer the question using the retrieved context, then judge context relevance and faithfulness." :
               "Process the input according to the evaluation task instructions."}
            </p>
          </div>

          {modelIds.map(mid => {
             const ex = examples[mid];
             const modelName = modelMap[mid]?.name ?? resultModelNames[mid] ?? `Model ${mid}`;
             const bestMetricDisplay = ex?.best ? getExampleMetricDisplay(taskType, ex.best.metricScores) : null;
             const worstMetricDisplay = ex?.worst ? getExampleMetricDisplay(taskType, ex.worst.metricScores) : null;
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
                          <CheckCircle2 className="w-5 h-5"/> Highest Scoring Example
                       </h3>
                       <div className="mb-4 rounded-xl border border-emerald-200 bg-emerald-50/70 p-4">
                         <div className="flex flex-wrap items-center gap-3">
                           <span className="text-xs font-semibold uppercase tracking-widest text-emerald-700">Example Quality Score</span>
                           <span className="text-lg font-bold text-emerald-900">{formatScore("quality", ex.best.avgScore)}</span>
                         </div>
                         <p className="text-xs text-emerald-900/80 mt-2">
                           {exampleScoreCopy(ex.best.metricCount, bestMetricDisplay?.visible.length ?? 0, bestMetricDisplay?.hiddenCount ?? 0)}
                         </p>
                       </div>
                       <div className="mb-4">
                         <p className="text-xs text-muted-foreground uppercase tracking-widest font-semibold mb-2">
                           {exampleMetricSectionLabel(taskType)}
                         </p>
                         <p className="text-xs text-muted-foreground mb-3">
                           {exampleMetricCopy(bestMetricDisplay?.total ?? 0, bestMetricDisplay?.hiddenCount ?? 0)}
                         </p>
                         <div className="flex flex-wrap gap-2">
                         {(bestMetricDisplay?.visible ?? []).map(({ metric, score }) => (
                           <Badge key={metric} variant="secondary" className="font-mono text-xs">
                             {metricLabel(metric)} {formatScore(metric, score)}
                           </Badge>
                         ))}
                       </div>
                       </div>
                       <div className="grid grid-cols-5 gap-6">
                         <div className="col-span-2 space-y-2">
                          <p className="text-xs text-muted-foreground uppercase w-full tracking-widest font-semibold text-center border-b border-border pb-2">{examplePrimaryInputLabel(taskType)}</p>
                           <div className="p-2 text-sm text-muted-foreground whitespace-pre-wrap font-mono h-[250px] overflow-y-auto">{ex.best.input}</div>
                         </div>
                         <div className="col-span-3 space-y-2">
                          <p className="text-xs text-muted-foreground uppercase w-full tracking-widest font-semibold text-center border-b border-border pb-2">Comparison</p>
                          {taskType === "code" ? (
                            <p className="text-xs text-muted-foreground">
                              `Pass@1` scores the first sample, while `Pass@3` checks whether any of the first three samples passed the dataset tests below. The short reference note is only a human hint, not the main grading target.
                            </p>
                          ) : null}
                           <div className="grid grid-rows-2 h-[250px] gap-4">
                             <div className="bg-emerald-500/10 border border-emerald-500/20 p-4 rounded-xl overflow-y-auto text-sm text-foreground whitespace-pre-wrap">
                               <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider mb-2 block">{exampleReferenceLabel(taskType)}</span>
                               {exampleReferenceContent(taskType, ex.best)}
                             </div>
                             <div className="bg-primary/10 border border-primary/20 p-4 rounded-xl overflow-y-auto text-sm whitespace-pre-wrap">
                               <span className="text-[10px] font-bold text-primary uppercase tracking-wider mb-2 block">Model Generation</span>
                               {renderModelGeneration(taskType, ex.best.actual)}
                             </div>
                           </div>
                         </div>
                       </div>
                       {ex.best.judgeRationales?.length ? (
                         <div className="mt-6 space-y-3">
                           <p className="text-xs text-muted-foreground uppercase tracking-widest font-semibold">Judge Rationale</p>
                           {ex.best.judgeRationales.map((entry: any) => (
                             <div key={entry.metricName} className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950/80">
                               <div className="text-[10px] font-bold uppercase tracking-wider text-amber-700 mb-2">
                                 {metricLabel(entry.metricName)}
                               </div>
                               <div className="whitespace-pre-wrap">{entry.rationale}</div>
                             </div>
                           ))}
                         </div>
                       ) : null}
                     </div>
                   )}
                  {ex.worst && ex.worst.itemId !== ex.best?.itemId && (
                     <div className="p-6 bg-white">
                       <h3 className="text-rose-700 font-bold mb-4 flex items-center gap-2">
                          <AlertTriangle className="w-5 h-5"/> Lowest Scoring Example
                       </h3>
                       <div className="mb-4 rounded-xl border border-rose-200 bg-rose-50/70 p-4">
                         <div className="flex flex-wrap items-center gap-3">
                           <span className="text-xs font-semibold uppercase tracking-widest text-rose-700">Example Quality Score</span>
                           <span className="text-lg font-bold text-rose-900">{formatScore("quality", ex.worst.avgScore)}</span>
                         </div>
                         <p className="text-xs text-rose-900/80 mt-2">
                           {exampleScoreCopy(ex.worst.metricCount, worstMetricDisplay?.visible.length ?? 0, worstMetricDisplay?.hiddenCount ?? 0)}
                         </p>
                       </div>
                       <div className="mb-4">
                         <p className="text-xs text-muted-foreground uppercase tracking-widest font-semibold mb-2">
                           {exampleMetricSectionLabel(taskType)}
                         </p>
                         <p className="text-xs text-muted-foreground mb-3">
                           {exampleMetricCopy(worstMetricDisplay?.total ?? 0, worstMetricDisplay?.hiddenCount ?? 0)}
                         </p>
                         <div className="flex flex-wrap gap-2">
                         {(worstMetricDisplay?.visible ?? []).map(({ metric, score }) => (
                           <Badge key={metric} variant="secondary" className="font-mono text-xs">
                             {metricLabel(metric)} {formatScore(metric, score)}
                           </Badge>
                         ))}
                       </div>
                       </div>
                       <div className="grid grid-cols-5 gap-6">
                         <div className="col-span-2 space-y-2">
                          <p className="text-xs text-muted-foreground w-full uppercase tracking-widest font-semibold text-center border-b border-border pb-2">{examplePrimaryInputLabel(taskType)}</p>
                           <div className="p-2 text-sm text-muted-foreground whitespace-pre-wrap font-mono h-[250px] overflow-y-auto">{ex.worst.input}</div>
                         </div>
                         <div className="col-span-3 space-y-2">
                          <p className="text-xs text-muted-foreground w-full uppercase tracking-widest font-semibold text-center border-b border-border pb-2">Comparison</p>
                          {taskType === "code" ? (
                            <p className="text-xs text-muted-foreground">
                              `Pass@1` scores the first sample, while `Pass@3` checks whether any of the first three samples passed the dataset tests below. The short reference note is only a human hint, not the main grading target.
                            </p>
                          ) : null}
                           <div className="grid grid-rows-2 h-[250px] gap-4">
                             <div className="bg-rose-500/10 border border-rose-500/20 p-4 rounded-xl overflow-y-auto text-sm text-foreground whitespace-pre-wrap">
                               <span className="text-[10px] font-bold text-rose-400 uppercase tracking-wider mb-2 block">{exampleReferenceLabel(taskType)}</span>
                               {exampleReferenceContent(taskType, ex.worst)}
                             </div>
                             <div className="bg-primary/10 border border-primary/20 p-4 rounded-xl overflow-y-auto text-sm whitespace-pre-wrap">
                               <span className="text-[10px] font-bold text-primary uppercase tracking-wider mb-2 block">Model Generation</span>
                               {renderModelGeneration(taskType, ex.worst.actual)}
                             </div>
                           </div>
                         </div>
                       </div>
                       {ex.worst.judgeRationales?.length ? (
                         <div className="mt-6 space-y-3">
                           <p className="text-xs text-muted-foreground uppercase tracking-widest font-semibold">Judge Rationale</p>
                           {ex.worst.judgeRationales.map((entry: any) => (
                             <div key={entry.metricName} className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950/80">
                               <div className="text-[10px] font-bold uppercase tracking-wider text-amber-700 mb-2">
                                 {metricLabel(entry.metricName)}
                               </div>
                               <div className="whitespace-pre-wrap">{entry.rationale}</div>
                             </div>
                           ))}
                         </div>
                       ) : null}
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
