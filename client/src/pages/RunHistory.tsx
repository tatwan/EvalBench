import { useAllEvalResults, useCancelEvalRun, useEvalRuns } from "@/hooks/use-eval";
import { useModels } from "@/hooks/use-models";
import { useDatasets } from "@/hooks/use-datasets";
import { MetricTooltip } from "@/components/ui/MetricTooltip";
import { Link } from "wouter";
import { format } from "date-fns";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Activity, Clock, CheckCircle2, ChevronRight, RefreshCw, Cpu, Database, Loader2, ShieldAlert, RotateCcw } from "lucide-react";
import { clsx } from "clsx";
import { useEffect, useMemo, useState } from "react";

const SPEED_METRICS = new Set([
  "tokens_per_second",
  "total_latency_s",
  "load_latency_s",
  "prompt_tokens",
  "output_tokens",
  "perplexity",
  "Speed (T/s)",
]);

function formatDuration(seconds?: number): string {
  if (seconds === undefined || seconds === null || Number.isNaN(seconds)) return "—";
  const total = Math.max(0, Math.round(seconds));
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hrs > 0) return `${hrs}h ${mins}m`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

function formatScore(value?: number | null): string {
  if (value === undefined || value === null || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

function humanizeStatus(status?: string | null): string {
  const normalized = String(status ?? "").replace(/_/g, " ").trim();
  if (!normalized) return "Unknown";
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

export default function RunHistory() {
  const { data: runs = [], isLoading: runsLoading, refetch } = useEvalRuns();
  const { data: results = [], isLoading: resultsLoading, refetch: refetchResults } = useAllEvalResults();
  const cancelRun = useCancelEvalRun();
  const { data: models = [] } = useModels();
  const { data: datasets = [] } = useDatasets();
  const [taskFilter, setTaskFilter] = useState("all");
  const [modelFilter, setModelFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [savedViews, setSavedViews] = useState<Array<{ name: string; task: string; model: string; status: string }>>([]);
  const [selectedView, setSelectedView] = useState<string>("");
  const [manualRefreshing, setManualRefreshing] = useState(false);

  const modelMap = Object.fromEntries((models as any[]).map(m => [m.id, m]));
  const modelIdByName = Object.fromEntries((models as any[]).map(m => [m.name, m.id]));
  const dsMap = Object.fromEntries((datasets as any[]).map(d => [d.id, d]));

  useEffect(() => {
    const raw = window.localStorage.getItem("evalbench.runHistoryViews");
    if (!raw) return;
    try {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setSavedViews(parsed);
      }
    } catch {
      // ignore corrupted values
    }
  }, []);

  const persistViews = (views: Array<{ name: string; task: string; model: string; status: string }>) => {
    setSavedViews(views);
    window.localStorage.setItem("evalbench.runHistoryViews", JSON.stringify(views));
  };

  const handleSaveView = () => {
    const name = window.prompt("Name this view?");
    if (!name) return;
    const trimmed = name.trim();
    if (!trimmed) return;
    const payload = { name: trimmed, task: taskFilter, model: modelFilter, status: statusFilter };
    const next = [...savedViews.filter((v) => v.name !== trimmed), payload];
    persistViews(next);
    setSelectedView(trimmed);
  };

  const taskOptions = useMemo(() => {
    const tasks = new Set<string>();
    (runs as any[]).forEach((r) => {
      if (r.configJson?.taskType) tasks.add(r.configJson.taskType);
    });
    return Array.from(tasks).sort();
  }, [runs]);

  const statusOptions = ["pending", "running", "cancel_requested", "cancelled", "completed", "failed"];

  const describeConfiguredModels = (config: any) => {
    const localModelIds = Array.isArray(config?.modelIds) ? config.modelIds : [];
    const cloudModels = Array.isArray(config?.cloudModels) ? config.cloudModels : [];
    return {
      localModelIds,
      cloudModels,
      total: localModelIds.length + cloudModels.length,
      summary: cloudModels.length > 0
        ? `${localModelIds.length} local + ${cloudModels.length} comparison`
        : `${localModelIds.length} Models`,
    };
  };

  const filteredRuns = useMemo(() => {
    return (runs as any[]).filter((run) => {
      const config = run.configJson || {};
      const selectedModel = modelMap[Number(modelFilter)];
      const matchesTask = taskFilter === "all" || config.taskType === taskFilter;
      const matchesStatus = statusFilter === "all" || run.status === statusFilter;
      const matchesModel =
        modelFilter === "all" ||
        (config.modelIds ?? []).includes(Number(modelFilter)) ||
        (!!selectedModel && (config.cloudModels ?? []).includes(selectedModel.name));
      return matchesTask && matchesStatus && matchesModel;
    });
  }, [runs, taskFilter, statusFilter, modelFilter, modelMap]);

  // Sort runs newest first by ID
  const sortedRuns = [...filteredRuns].sort((a: any, b: any) => b.id - a.id);

  const scorePreviewByRun = useMemo(() => {
    const grouped = new Map<number, { scores: number[]; metrics: Set<string> }>();
    (results as any[]).forEach((result) => {
      if (result.error || SPEED_METRICS.has(result.metricName)) return;
      const entry = grouped.get(result.runId) ?? { scores: [], metrics: new Set<string>() };
      entry.scores.push(Number(result.score));
      entry.metrics.add(result.metricName);
      grouped.set(result.runId, entry);
    });

    return grouped;
  }, [results]);

  const progressByRunAndModel = useMemo(() => {
    const progress = new Map<number, Map<number, Set<number>>>();
    (results as any[]).forEach((result) => {
      if (!result.itemId) return;
      const byModel = progress.get(result.runId) ?? new Map<number, Set<number>>();
      const itemIds = byModel.get(result.modelId) ?? new Set<number>();
      itemIds.add(result.itemId);
      byModel.set(result.modelId, itemIds);
      progress.set(result.runId, byModel);
    });
    return progress;
  }, [results]);

  const handleManualRefresh = async () => {
    setManualRefreshing(true);
    try {
      await Promise.all([refetch(), refetchResults()]);
    } finally {
      setManualRefreshing(false);
    }
  };

  useEffect(() => {
    const hasActiveRuns = (runs as any[]).some((run) =>
      ["pending", "running", "cancel_requested"].includes(run.status)
    );
    if (!hasActiveRuns) return;

    const intervalId = window.setInterval(() => {
      refetch();
      refetchResults();
    }, 5000);

    return () => window.clearInterval(intervalId);
  }, [runs, refetch, refetchResults]);

  if (runsLoading || resultsLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gradient">Run History</h1>
          <p className="text-foreground/80 mt-2">Review finished and in-flight evaluations with quality snapshots and run health.</p>
          <p className="text-xs text-muted-foreground mt-2">
            A pair means one model on one dataset item. Stored scores are metric rows written for each pair.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={handleManualRefresh}>
          <RefreshCw className={clsx("w-4 h-4 mr-2", manualRefreshing && "animate-spin")} />
          Refresh
        </Button>
      </div>

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="text-xs font-semibold text-muted-foreground">Filter</div>
          <div className="w-[170px]">
            <Select value={taskFilter} onValueChange={(value) => {
              setTaskFilter(value);
              setSelectedView("");
            }}>
              <SelectTrigger className="h-8 text-xs capitalize">
                <SelectValue placeholder="Task" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All tasks</SelectItem>
                {taskOptions.map((task) => (
                  <SelectItem key={task} value={task} className="capitalize">{task}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-[190px]">
            <Select value={modelFilter} onValueChange={(value) => {
              setModelFilter(value);
              setSelectedView("");
            }}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Model" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All models</SelectItem>
                {(models as any[]).map((m) => (
                  <SelectItem key={m.id} value={String(m.id)}>{m.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-[150px]">
            <Select value={statusFilter} onValueChange={(value) => {
              setStatusFilter(value);
              setSelectedView("");
            }}>
              <SelectTrigger className="h-8 text-xs capitalize">
                <SelectValue placeholder="Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All status</SelectItem>
                {statusOptions.map((status) => (
                  <SelectItem key={status} value={status} className="capitalize">{status}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-[190px]">
            <Select
              value={selectedView}
              onValueChange={(value) => {
                setSelectedView(value);
                const view = savedViews.find((v) => v.name === value);
                if (view) {
                  setTaskFilter(view.task);
                  setModelFilter(view.model);
                  setStatusFilter(view.status);
                }
              }}
            >
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Saved views" />
              </SelectTrigger>
              <SelectContent>
                {savedViews.length === 0 && (
                  <SelectItem value="none" disabled>No saved views</SelectItem>
                )}
                {savedViews.map((view) => (
                  <SelectItem key={view.name} value={view.name}>{view.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button variant="outline" size="sm" className="text-xs" onClick={handleSaveView}>
            Save View
          </Button>
          <Button variant="ghost" size="sm" className="text-xs" onClick={() => {
            setTaskFilter("all");
            setModelFilter("all");
            setStatusFilter("all");
            setSelectedView("");
          }}>
            Reset
          </Button>
        </div>
      </Card>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted">
                <th className="text-left px-6 py-4 font-semibold text-foreground/85">Run ID</th>
                <th className="text-left px-6 py-4 font-semibold text-foreground/85">Time</th>
                <th className="text-left px-6 py-4 font-semibold text-foreground/85">Duration</th>
                <th className="text-left px-6 py-4 font-semibold text-foreground/85">Task Type</th>
                <th className="text-left px-6 py-4 font-semibold text-foreground/85">Dataset</th>
                <th className="text-left px-6 py-4 font-semibold text-foreground/85">Models Evaluated</th>
                <th className="text-left px-4 py-4 font-semibold text-foreground/85">
                  <span className="inline-flex items-center gap-1">
                    Quality Snapshot
                    <MetricTooltip description="Snapshot cards average successful non-speed quality rows only. Use Run Details for pair-level counts, confidence context, and failed-item inspection." />
                  </span>
                </th>
                <th className="text-left px-4 py-4 font-semibold text-foreground/85">Status</th>
                <th className="text-left px-4 py-4 font-semibold text-foreground/85">Run Health</th>
                <th className="text-right px-4 py-4 font-semibold text-foreground/85"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sortedRuns.map((run: any) => {
                const config = run.configJson || {};
                const { localModelIds, cloudModels, total, summary } = describeConfiguredModels(config);
                const datasetName = config.datasetId ? dsMap[config.datasetId]?.name : "None (Ad-hoc)";
                const durationText = typeof config.durationSeconds === "number"
                  ? formatDuration(config.durationSeconds)
                  : run.status === "running" || run.status === "cancel_requested"
                    ? "Running..."
                    : "—";
                const scorePreview = scorePreviewByRun.get(run.id);
                const avgScore = scorePreview && scorePreview.scores.length > 0
                  ? scorePreview.scores.reduce((sum, score) => sum + score, 0) / scorePreview.scores.length
                  : null;
                const totalPairs = typeof config.totalPairs === "number" ? config.totalPairs : null;
                const completedPairs = typeof config.completedPairs === "number" ? config.completedPairs : null;
                const errorCount = typeof config.errorCount === "number" ? config.errorCount : 0;
                const retryCount = typeof config.retryCount === "number" ? config.retryCount : 0;
                const startedPairs = typeof config.startedPairs === "number" ? config.startedPairs : 0;
                const activePairs = typeof config.activePairs === "number" ? config.activePairs : 0;
                const progressPhase = typeof config.progressPhase === "string" ? config.progressPhase : null;
                const progressMessage = typeof config.progressMessage === "string" ? config.progressMessage : null;
                const successRate = totalPairs && totalPairs > 0
                  ? Math.max(0, (totalPairs - errorCount) / totalPairs)
                  : null;
                const expectedItemsPerModel =
                  config.datasetItemCount ??
                  (total > 0 && totalPairs !== null ? Math.round(totalPairs / total) : null);
                
                return (
                  <tr key={run.id} className="hover:bg-muted/50 transition-colors group">
                    <td className="px-6 py-4 font-mono text-primary font-medium">#{run.id}</td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2 text-foreground/80">
                        <Clock className="w-3.5 h-3.5" />
                        {run.timestamp ? format(new Date(run.timestamp), "MMM d, yyyy h:mm a") : "Unknown"}
                      </div>
                    </td>
                    <td className="px-6 py-4 text-foreground/80 font-mono text-xs whitespace-nowrap">
                      {durationText}
                    </td>
                    <td className="px-6 py-4 capitalize text-foreground/90">{config.taskType ?? "-"}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2 text-foreground/80">
                        <Database className="w-3.5 h-3.5" />
                        <span className="truncate max-w-[150px]" title={datasetName}>{datasetName}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-1.5 text-xs text-foreground/80 mb-1">
                          <Cpu className="w-3.5 h-3.5" />
                          <span>{summary}</span>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {localModelIds.slice(0, 3).map((mid: number) => (
                            (() => {
                              const completedItems = progressByRunAndModel.get(run.id)?.get(mid)?.size ?? 0;
                              const done = expectedItemsPerModel !== null && completedItems >= expectedItemsPerModel;
                              const active = completedItems > 0 && !done;
                              return (
                                <span
                                  key={mid}
                                  className={clsx(
                                    "text-[10px] px-1.5 py-0.5 rounded truncate max-w-[110px]",
                                    done ? "bg-emerald-100 text-emerald-800" :
                                    active ? "bg-amber-100 text-amber-800" :
                                    "bg-muted text-foreground/90"
                                  )}
                                  title={modelMap[mid]?.name}
                                >
                                  {modelMap[mid]?.name ?? `Model ${mid}`}
                                  {expectedItemsPerModel ? ` ${Math.min(completedItems, expectedItemsPerModel)}/${expectedItemsPerModel}` : ""}
                                </span>
                              );
                            })()
                          ))}
                          {cloudModels.slice(0, 2).map((name: string) => (
                            (() => {
                              const modelId = modelIdByName[name];
                              const completedItems = modelId ? (progressByRunAndModel.get(run.id)?.get(modelId)?.size ?? 0) : 0;
                              const done = expectedItemsPerModel !== null && completedItems >= expectedItemsPerModel;
                              const active = completedItems > 0 && !done;
                              return (
                                <span
                                  key={name}
                                  className={clsx(
                                    "text-[10px] px-1.5 py-0.5 rounded truncate max-w-[130px]",
                                    done ? "bg-emerald-100 text-emerald-800" :
                                    active ? "bg-amber-100 text-amber-800" :
                                    "bg-sky-100 text-sky-800"
                                  )}
                                  title={name}
                                >
                                  {name}
                                  {expectedItemsPerModel ? ` ${Math.min(completedItems, expectedItemsPerModel)}/${expectedItemsPerModel}` : ""}
                                </span>
                              );
                            })()
                          ))}
                          {total > 5 && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-foreground/80">
                              +{total - 5} more
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      {avgScore !== null ? (
                        <div className="rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 min-w-[150px]">
                          <div className="text-sm font-semibold text-emerald-800">{formatScore(avgScore)}</div>
                          <div className="text-[11px] text-emerald-700/80">
                            {scorePreview?.metrics.size ?? 0} metric types across {scorePreview?.scores.length ?? 0} successful quality rows
                          </div>
                          <div className="text-[10px] text-emerald-700/70 mt-1">
                            Pair totals and confidence context live in Run Details.
                          </div>
                        </div>
                      ) : (
                        <div className="text-xs text-muted-foreground min-w-[150px]">
                          {run.status === "running" || run.status === "cancel_requested" || run.status === "pending"
                            ? "Waiting for successful quality rows..."
                            : errorCount > 0
                              ? "No successful quality scores"
                              : "No scored results"}
                        </div>
                      )}
                    </td>
                    <td className="px-4 py-4">
                      <span className={clsx(
                        "text-xs font-semibold px-2 py-1 rounded-full whitespace-nowrap",
                        run.status === "completed" ? "bg-emerald-100 text-emerald-700" :
                        run.status === "running" || run.status === "pending" || run.status === "cancel_requested" ? "bg-amber-100 text-amber-700" :
                        run.status === "cancelled" ? "bg-slate-200 text-slate-700" :
                        "bg-muted text-muted-foreground"
                      )}>
                        {(run.status === "running" || run.status === "cancel_requested") && <Loader2 className="w-3 h-3 inline mr-1 animate-spin" />}
                        {run.status === "completed" && <CheckCircle2 className="w-3 h-3 inline mr-1" />}
                        {humanizeStatus(run.status)}
                      </span>
                      {run.configJson?.completedWithErrors ? (
                        <div className="text-[10px] text-amber-700 mt-1">Scores are usable. Failed pairs were excluded.</div>
                      ) : run.status === "running" || run.status === "cancel_requested" || run.status === "pending" ? (
                        <div className="text-[10px] text-muted-foreground mt-1">Rows may appear before pair totals finish.</div>
                      ) : null}
                    </td>
                    <td className="px-4 py-4">
                        <div className="space-y-2 min-w-[170px]">
                          <div className="text-[10px] text-muted-foreground">
                            {completedPairs !== null && totalPairs !== null
                              ? `${completedPairs}/${totalPairs} pairs completed`
                              : "Pair totals appear in Run Details"}
                          </div>
                          {(run.status === "running" || run.status === "cancel_requested" || run.status === "pending") && (
                            <div className="text-[10px] text-muted-foreground space-y-1">
                              <div>{startedPairs} started • {activePairs} active</div>
                              {progressPhase ? <div className="capitalize">{progressPhase.replace(/_/g, " ")}</div> : null}
                              {progressMessage ? <div className="line-clamp-2">{progressMessage}</div> : null}
                            </div>
                          )}
                          {successRate !== null ? (
                            <div className="text-[11px] font-medium text-foreground/85">
                              {(successRate * 100).toFixed(1)}% pair success
                          </div>
                        ) : null}
                        <div className="flex flex-wrap gap-2 text-[10px]">
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-muted text-muted-foreground">
                            <ShieldAlert className="w-3 h-3" />
                            {errorCount} fail
                          </span>
                          <span className="inline-flex items-center gap-1 px-2 py-1 rounded bg-muted text-muted-foreground">
                            <RotateCcw className="w-3 h-3" />
                            {retryCount} retry
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4 text-right">
                      <div className="flex items-center justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        {(run.status === "running" || run.status === "pending") && (
                          <Button
                            variant="outline"
                            size="sm"
                            className="text-xs px-2"
                            onClick={() => cancelRun.mutate(run.id)}
                            disabled={cancelRun.isPending}
                          >
                            Stop
                          </Button>
                        )}
                        {run.status === "cancel_requested" && (
                          <Button variant="outline" size="sm" className="text-xs px-2" disabled>
                            Stopping...
                          </Button>
                        )}
                        <Link href={`/evaluate/${run.id}`}>
                          <Button variant="ghost" size="sm" className="text-xs px-2">
                            View <ChevronRight className="w-4 h-4 ml-1" />
                          </Button>
                        </Link>
                      </div>
                    </td>
                  </tr>
                );
              })}
              {sortedRuns.length === 0 && (
                <tr>
                  <td colSpan={10} className="px-6 py-12 text-center text-muted-foreground">
                    No runs found.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
