import { useModels } from "@/hooks/use-models";
import { useEvalRuns, useAllEvalResults } from "@/hooks/use-eval";
import { Card } from "@/components/ui/card";
import { ScoreBadge } from "@/components/ui/ScoreBadge";
import { MetricTooltip } from "@/components/ui/MetricTooltip";
import { Button } from "@/components/ui/Button";
import { Activity, Cpu, Clock, CheckCircle2, RefreshCw, Lightbulb, Swords } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { Link } from "wouter";
import { useMemo, useState } from "react";
import { clsx } from "clsx";
import {
  Radar,
  RadarChart,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

const SPEED_METRICS = new Set([
  "tokens_per_second",
  "total_latency_s",
  "load_latency_s",
  "prompt_tokens",
  "output_tokens",
]);

const TOOLTIP_COPY: Record<string, string> = {
  score: "Weighted average across all evaluated metrics. Includes confidence intervals when available.",
  rouge: "ROUGE-L: Longest Common Subsequence F1 between generated and reference text. Higher is better.",
  bleu: "BLEU: N-gram precision score. Higher is better, best for translation tasks.",
  latency: "Total latency per request. Lower is better.",
};

function normalizeRadar(value: number) {
  if (!Number.isFinite(value)) return 0;
  if (value <= 1) return value * 100;
  return Math.min(value, 100);
}

export default function Dashboard() {
  const { data: models = [], isLoading: modelsLoading } = useModels();
  const { data: runs = [], isLoading: runsLoading, refetch: refetchRuns, isRefetching: isRefetchingRuns } = useEvalRuns();
  const { data: results = [], isLoading: resultsLoading, refetch: refetchResults, isRefetching: isRefetchingResults } = useAllEvalResults();
  const [selectedTask, setSelectedTask] = useState<string>("all");

  const handleRefresh = async () => {
    await Promise.all([refetchRuns(), refetchResults()]);
  };

  const runMap = useMemo(() => {
    return Object.fromEntries((runs as any[]).map((r) => [r.id, r]));
  }, [runs]);

  const availableTasks = useMemo(() => {
    const tasks = new Set<string>();
    (runs as any[]).forEach((r) => {
      if (r.configJson?.taskType) tasks.add(r.configJson.taskType);
    });
    return Array.from(tasks).sort();
  }, [runs]);

  const filteredResults = useMemo(() => {
    const anyResults = results as any[];
    if (selectedTask === "all") return anyResults;
    return anyResults.filter((r) => runMap[r.runId]?.configJson?.taskType === selectedTask);
  }, [results, selectedTask, runMap]);

  const getMetricAvg = (modelId: number, names: string[], source: any[]) => {
    const items = source.filter((r) => r.modelId === modelId && names.includes(r.metricName));
    if (items.length === 0) return null;
    return items.reduce((sum, r) => sum + Number(r.score), 0) / items.length;
  };

  const summaries = useMemo(() => {
    const qualityResults = (filteredResults as any[]).filter((r) => !SPEED_METRICS.has(r.metricName));
    const tasksByModel = new Map<number, Set<string>>();
    (results as any[]).forEach((r) => {
      const task = runMap[r.runId]?.configJson?.taskType;
      if (!task) return;
      if (!tasksByModel.has(r.modelId)) tasksByModel.set(r.modelId, new Set());
      tasksByModel.get(r.modelId)!.add(task);
    });

    return (models as any[]).map((model) => {
      const modelResults = qualityResults.filter((r) => r.modelId === model.id);
      const avgScore =
        modelResults.length > 0
          ? modelResults.reduce((sum, r) => sum + Number(r.score), 0) / modelResults.length
          : 0;
      const rouge = getMetricAvg(model.id, ["rougeL", "rouge_l", "rouge-l"], qualityResults);
      const bleu = getMetricAvg(model.id, ["bleu", "sacrebleu"], qualityResults);
      const latency = getMetricAvg(model.id, ["total_latency_s", "latency"], results as any[]);
      const tasks = Array.from(tasksByModel.get(model.id) ?? []);
      return {
        ...model,
        avgScore,
        rouge,
        bleu,
        latency,
        tasks,
        evalsCount: modelResults.length,
      };
    });
  }, [models, filteredResults, results, runMap]);

  const leaderboard = useMemo(() => {
    return summaries
      .filter((m) => m.evalsCount > 0)
      .sort((a, b) => b.avgScore - a.avgScore)
      .slice(0, 4);
  }, [summaries]);

  const radarData = useMemo(() => {
    const qualityResults = (results as any[]).filter((r) => !SPEED_METRICS.has(r.metricName));
    const topModels = [...summaries]
      .filter((m) => m.evalsCount > 0)
      .sort((a, b) => b.avgScore - a.avgScore)
      .slice(0, 2);

    const metricMap: Record<string, any> = {};
    qualityResults.forEach((r) => {
      if (!topModels.find((m) => m.id === r.modelId)) return;
      if (!metricMap[r.metricName]) {
        metricMap[r.metricName] = { metric: r.metricName };
      }
      metricMap[r.metricName][r.modelId] = metricMap[r.metricName][r.modelId] ?? [];
      metricMap[r.metricName][r.modelId].push(Number(r.score));
    });

    const rows = Object.values(metricMap).map((m: any) => {
      const row: any = { subject: m.metric.replace(/_/g, " ") };
      topModels.forEach((model) => {
        const values = m[model.id] ?? [];
        const avg = values.length ? values.reduce((a: number, b: number) => a + b, 0) / values.length : 0;
        row[model.name] = normalizeRadar(avg);
      });
      return row;
    });

    return { rows, topModels };
  }, [results, summaries]);

  const recentRuns = useMemo(() => {
    return [...(runs as any[])]
      .filter((r) => r.timestamp)
      .sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime())
      .slice(0, 3);
  }, [runs]);

  const stats = [
    { label: "Models Loaded", value: models.length, icon: Cpu, tone: "bg-violet-100 text-violet-600" },
    { label: "Eval Runs Total", value: runs.length, icon: Activity, tone: "bg-amber-100 text-amber-600" },
    { label: "Data Points", value: results.length, icon: CheckCircle2, tone: "bg-emerald-100 text-emerald-600" },
    { label: "Active Evals", value: runs.filter((r) => r.status === "running").length, icon: Clock, tone: "bg-rose-100 text-rose-600" },
  ];

  if (modelsLoading || runsLoading || resultsLoading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div></div>;
  }

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-extrabold text-foreground">Dashboard</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Your local LLM evaluation workspace - Updated{" "}
            {recentRuns[0]?.timestamp
              ? formatDistanceToNow(new Date(recentRuns[0].timestamp), { addSuffix: true })
              : "just now"}
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleRefresh} disabled={isRefetchingRuns || isRefetchingResults}>
          <RefreshCw className={clsx("w-4 h-4 mr-2", (isRefetchingRuns || isRefetchingResults) && "animate-spin")} />
          Refresh
        </Button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        {stats.map((stat) => {
          const Icon = stat.icon;
          return (
            <Card key={stat.label} className="p-4 shadow-soft">
              <div className="flex items-center gap-3">
                <div className={clsx("h-10 w-10 rounded-lg flex items-center justify-center", stat.tone)}>
                  <Icon className="w-5 h-5" />
                </div>
                <div>
                  <div className="text-2xl font-extrabold text-foreground">{stat.value}</div>
                  <div className="text-xs font-medium text-muted-foreground">{stat.label}</div>
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-4">
        <Card className="p-0 overflow-hidden">
          <div className="px-5 py-4 border-b border-border flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold text-foreground">Model Leaderboard</div>
              <div className="text-xs text-muted-foreground">Sorted by overall score across all tasks</div>
            </div>
            <div className="flex gap-2">
              <button
                onClick={() => setSelectedTask("all")}
                className={clsx(
                  "text-[11px] font-semibold px-2 py-1 rounded-md border",
                  selectedTask === "all" ? "bg-violet-100 text-violet-700 border-violet-200" : "text-muted-foreground border-border"
                )}
              >
                All Tasks
              </button>
              {availableTasks.slice(0, 2).map((task) => (
                <button
                  key={task}
                  onClick={() => setSelectedTask(task)}
                  className={clsx(
                    "text-[11px] font-semibold px-2 py-1 rounded-md border capitalize",
                    selectedTask === task ? "bg-violet-100 text-violet-700 border-violet-200" : "text-muted-foreground border-border"
                  )}
                >
                  {task}
                </button>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border">
                  <th className="text-left px-5 py-3 w-8">#</th>
                  <th className="text-left px-5 py-3">Model</th>
                  <th className="text-left px-5 py-3">Score <MetricTooltip description={TOOLTIP_COPY.score} /></th>
                  <th className="text-left px-5 py-3">ROUGE-L <MetricTooltip description={TOOLTIP_COPY.rouge} /></th>
                  <th className="text-left px-5 py-3">BLEU <MetricTooltip description={TOOLTIP_COPY.bleu} /></th>
                  <th className="text-left px-5 py-3">Latency <MetricTooltip description={TOOLTIP_COPY.latency} /></th>
                  <th className="text-left px-5 py-3">Tasks</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {leaderboard.map((model, index) => (
                  <tr key={model.id} className="hover:bg-muted/50">
                    <td className="px-5 py-3 text-muted-foreground font-semibold">{index + 1}</td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-3">
                        <div className="h-8 w-8 rounded-lg bg-gradient-to-br from-violet-500 to-violet-400 text-white flex items-center justify-center text-xs font-bold">
                          {model.name?.[0]?.toUpperCase() ?? "M"}
                        </div>
                        <div>
                          <div className="font-mono text-sm font-semibold">{model.name}</div>
                          <div className="text-[11px] text-muted-foreground">{model.params ?? "Local model"}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <ScoreBadge value={model.avgScore * 100} format="percent" precision={1} />
                        <div className="h-1.5 w-14 rounded-full bg-muted overflow-hidden">
                          <div className="h-full bg-emerald-500" style={{ width: `${Math.min(model.avgScore * 100, 100)}%` }} />
                        </div>
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      {model.rouge !== null ? <ScoreBadge value={model.rouge} metric="rougeL" /> : <span className="text-muted-foreground">-</span>}
                    </td>
                    <td className="px-5 py-3">
                      {model.bleu !== null ? <ScoreBadge value={model.bleu} metric="bleu" /> : <span className="text-muted-foreground">-</span>}
                    </td>
                    <td className="px-5 py-3">
                      {model.latency !== null ? (
                        <span className="font-mono text-xs text-muted-foreground">{model.latency.toFixed(2)}s</span>
                      ) : (
                        <span className="text-muted-foreground">-</span>
                      )}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex gap-1.5 flex-wrap">
                        {model.tasks.length ? (
                          model.tasks.slice(0, 2).map((task) => (
                            <span key={task} className="text-[10px] font-semibold px-2 py-0.5 rounded bg-muted text-muted-foreground">
                              {task}
                            </span>
                          ))
                        ) : (
                          <span className="text-muted-foreground text-xs">-</span>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
                {leaderboard.length === 0 && (
                  <tr>
                    <td colSpan={7} className="px-5 py-8 text-center text-muted-foreground">
                      No evaluation data yet. Start with the Eval Wizard.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <div className="px-5 py-3 border-t border-border text-xs text-muted-foreground flex items-center justify-between">
            <span>{leaderboard.length} of {models.length} models evaluated</span>
            <Link href="/models" className="text-violet-600 font-semibold">View All -&gt;</Link>
          </div>
        </Card>

        <div className="flex flex-col gap-4">
          <Card className="p-4">
            <div className="mb-2">
              <div className="text-sm font-semibold text-foreground">Capability Radar</div>
              <div className="text-xs text-muted-foreground">Top models compared</div>
            </div>
            <div className="h-56 w-full">
              {radarData.rows.length >= 3 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart cx="50%" cy="50%" outerRadius="70%" data={radarData.rows}>
                    <PolarGrid stroke="hsl(var(--border))" />
                    <PolarAngleAxis dataKey="subject" tick={{ fill: "hsl(var(--muted-foreground))", fontSize: 10 }} />
                    <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} axisLine={false} />
                    <Tooltip
                      contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))", borderRadius: "8px" }}
                      itemStyle={{ fontSize: 12 }}
                    />
                    {radarData.topModels.map((m, i) => (
                      <Radar
                        key={m.id}
                        name={m.name}
                        dataKey={m.name}
                        stroke={i === 0 ? "#7C3AED" : "#0284C7"}
                        fill={i === 0 ? "#7C3AED" : "#0284C7"}
                        fillOpacity={0.15}
                      />
                    ))}
                  </RadarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-muted-foreground text-xs border border-dashed border-border rounded-lg">
                  Not enough data yet.
                </div>
              )}
            </div>
          </Card>

          <Card className="p-4">
            <div className="text-sm font-semibold text-foreground mb-3">Recent Activity</div>
            <div className="space-y-3">
              {recentRuns.map((run) => (
                <div key={run.id} className="flex items-start gap-3">
                  <div className={clsx(
                    "h-7 w-7 rounded-md flex items-center justify-center",
                    run.status === "completed" ? "bg-emerald-100 text-emerald-600" : "bg-violet-100 text-violet-600"
                  )}>
                    {run.status === "completed" ? <CheckCircle2 className="w-4 h-4" /> : <Swords className="w-4 h-4" />}
                  </div>
                  <div>
                    <div className="text-sm font-semibold">{run.configJson?.taskType ?? "Eval run"}</div>
                    <div className="text-xs text-muted-foreground">
                      {formatDistanceToNow(new Date(run.timestamp), { addSuffix: true })}
                    </div>
                  </div>
                </div>
              ))}
              {recentRuns.length === 0 && (
                <div className="text-xs text-muted-foreground">No recent activity yet.</div>
              )}
            </div>
          </Card>
        </div>
      </div>

      <div className="rounded-xl border border-violet-100 bg-gradient-to-r from-violet-50 to-emerald-50 p-4 flex items-center gap-4">
        <Lightbulb className="h-6 w-6 text-violet-600" />
        <div className="flex-1">
          <div className="text-sm font-bold text-violet-700">New to LLM evaluation?</div>
          <div className="text-sm text-violet-900/70">
            Start with <span className="font-semibold">Eval Wizard</span> to auto-pick metrics, or visit the{" "}
            <span className="font-semibold">Metric Guide</span> to learn which score means what.
          </div>
        </div>
        <Link href="/evaluate" className="text-sm font-semibold text-violet-700">Start Evaluating -&gt;</Link>
      </div>
    </div>
  );
}
