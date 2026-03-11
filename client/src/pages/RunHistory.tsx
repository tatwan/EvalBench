import { useEvalRuns } from "@/hooks/use-eval";
import { useModels } from "@/hooks/use-models";
import { useDatasets } from "@/hooks/use-datasets";
import { Link } from "wouter";
import { format } from "date-fns";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/Button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Activity, Clock, CheckCircle2, ChevronRight, RefreshCw, Cpu, Database, Loader2 } from "lucide-react";
import { clsx } from "clsx";
import { useEffect, useMemo, useState } from "react";

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

export default function RunHistory() {
  const { data: runs = [], isLoading: runsLoading, refetch, isRefetching } = useEvalRuns();
  const { data: models = [] } = useModels();
  const { data: datasets = [] } = useDatasets();
  const [taskFilter, setTaskFilter] = useState("all");
  const [modelFilter, setModelFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [savedViews, setSavedViews] = useState<Array<{ name: string; task: string; model: string; status: string }>>([]);
  const [selectedView, setSelectedView] = useState<string>("");

  const modelMap = Object.fromEntries((models as any[]).map(m => [m.id, m]));
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

  if (runsLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  const taskOptions = useMemo(() => {
    const tasks = new Set<string>();
    (runs as any[]).forEach((r) => {
      if (r.configJson?.taskType) tasks.add(r.configJson.taskType);
    });
    return Array.from(tasks).sort();
  }, [runs]);

  const statusOptions = ["pending", "running", "completed", "failed"];

  const filteredRuns = useMemo(() => {
    return (runs as any[]).filter((run) => {
      const config = run.configJson || {};
      const matchesTask = taskFilter === "all" || config.taskType === taskFilter;
      const matchesStatus = statusFilter === "all" || run.status === statusFilter;
      const matchesModel =
        modelFilter === "all" ||
        (config.modelIds ?? []).includes(Number(modelFilter));
      return matchesTask && matchesStatus && matchesModel;
    });
  }, [runs, taskFilter, statusFilter, modelFilter]);

  // Sort runs newest first
  const sortedRuns = [...filteredRuns].sort((a: any, b: any) => {
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  });

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gradient">Run History</h1>
          <p className="text-foreground/80 mt-2">View all your past evaluations.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isRefetching}>
          <RefreshCw className={clsx("w-4 h-4 mr-2", isRefetching && "animate-spin")} />
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
                <th className="text-left px-4 py-4 font-semibold text-foreground/85">Status</th>
                <th className="text-right px-4 py-4 font-semibold text-foreground/85"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sortedRuns.map((run: any) => {
                const config = run.configJson || {};
                const modelIds = config.modelIds || [];
                const datasetName = config.datasetId ? dsMap[config.datasetId]?.name : "None (Ad-hoc)";
                const durationText = typeof config.durationSeconds === "number"
                  ? formatDuration(config.durationSeconds)
                  : run.status === "running"
                    ? "Running..."
                    : "—";
                
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
                          <span>{modelIds.length} Models</span>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {modelIds.slice(0, 3).map((mid: number) => (
                            <span key={mid} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-foreground/90 truncate max-w-[100px]" title={modelMap[mid]?.name}>
                              {modelMap[mid]?.name ?? `Model ${mid}`}
                            </span>
                          ))}
                          {modelIds.length > 3 && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-foreground/80">
                              +{modelIds.length - 3} more
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-4">
                      <span className={clsx(
                        "text-xs font-semibold px-2 py-1 rounded-full whitespace-nowrap",
                        run.status === "completed" ? "bg-emerald-100 text-emerald-700" :
                        run.status === "running" || run.status === "pending" ? "bg-amber-100 text-amber-700" :
                        "bg-muted text-muted-foreground"
                      )}>
                        {run.status === "running" && <Loader2 className="w-3 h-3 inline mr-1 animate-spin" />}
                        {run.status === "completed" && <CheckCircle2 className="w-3 h-3 inline mr-1" />}
                        {run.status}
                      </span>
                    </td>
                    <td className="px-4 py-4 text-right">
                      <Link href={`/evaluate/${run.id}`}>
                        <Button variant="ghost" size="sm" className="opacity-0 group-hover:opacity-100 transition-opacity text-xs px-2">
                          View <ChevronRight className="w-4 h-4 ml-1" />
                        </Button>
                      </Link>
                    </td>
                  </tr>
                );
              })}
              {sortedRuns.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-6 py-12 text-center text-muted-foreground">
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
