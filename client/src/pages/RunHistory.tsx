import { useEvalRuns } from "@/hooks/use-eval";
import { useModels } from "@/hooks/use-models";
import { useDatasets } from "@/hooks/use-datasets";
import { Link } from "wouter";
import { format } from "date-fns";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/Button";
import { Activity, Clock, CheckCircle2, ChevronRight, RefreshCw, Cpu, Database, Loader2 } from "lucide-react";
import { clsx } from "clsx";

export default function RunHistory() {
  const { data: runs = [], isLoading: runsLoading, refetch, isRefetching } = useEvalRuns();
  const { data: models = [] } = useModels();
  const { data: datasets = [] } = useDatasets();

  const modelMap = Object.fromEntries((models as any[]).map(m => [m.id, m]));
  const dsMap = Object.fromEntries((datasets as any[]).map(d => [d.id, d]));

  if (runsLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  // Sort runs newest first
  const sortedRuns = [...runs].sort((a: any, b: any) => {
    return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
  });

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gradient">Run History</h1>
          <p className="text-foreground/70 mt-2">View all your past evaluations.</p>
        </div>
        <Button variant="outline" size="sm" onClick={() => refetch()} disabled={isRefetching}>
          <RefreshCw className={clsx("w-4 h-4 mr-2", isRefetching && "animate-spin")} />
          Refresh
        </Button>
      </div>

      <Card>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted">
                <th className="text-left px-6 py-4 font-semibold text-foreground/70">Run ID</th>
                <th className="text-left px-6 py-4 font-semibold text-foreground/70">Time</th>
                <th className="text-left px-6 py-4 font-semibold text-foreground/70">Task Type</th>
                <th className="text-left px-6 py-4 font-semibold text-foreground/70">Dataset</th>
                <th className="text-left px-6 py-4 font-semibold text-foreground/70">Models Evaluated</th>
                <th className="text-left px-6 py-4 font-semibold text-foreground/70">Status</th>
                <th className="text-right px-6 py-4 font-semibold text-foreground/70"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {sortedRuns.map((run: any) => {
                const config = run.configJson || {};
                const modelIds = config.modelIds || [];
                const datasetName = config.datasetId ? dsMap[config.datasetId]?.name : "None (Ad-hoc)";
                
                return (
                  <tr key={run.id} className="hover:bg-muted/50 transition-colors group">
                    <td className="px-6 py-4 font-mono text-primary font-medium">#{run.id}</td>
                    <td className="px-6 py-4 whitespace-nowrap">
                      <div className="flex items-center gap-2 text-foreground/70">
                        <Clock className="w-3.5 h-3.5" />
                        {run.timestamp ? format(new Date(run.timestamp), "MMM d, yyyy h:mm a") : "Unknown"}
                      </div>
                    </td>
                    <td className="px-6 py-4 capitalize text-foreground/80">{config.taskType ?? "-"}</td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-2 text-foreground/70">
                        <Database className="w-3.5 h-3.5" />
                        <span className="truncate max-w-[150px]" title={datasetName}>{datasetName}</span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-1.5 text-xs text-foreground/70 mb-1">
                          <Cpu className="w-3.5 h-3.5" />
                          <span>{modelIds.length} Models</span>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {modelIds.slice(0, 3).map((mid: number) => (
                            <span key={mid} className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-foreground/80 truncate max-w-[100px]" title={modelMap[mid]?.name}>
                              {modelMap[mid]?.name ?? `Model ${mid}`}
                            </span>
                          ))}
                          {modelIds.length > 3 && (
                            <span className="text-[10px] px-1.5 py-0.5 rounded bg-muted text-foreground/70">
                              +{modelIds.length - 3} more
                            </span>
                          )}
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
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
                    <td className="px-6 py-4 text-right">
                      <Link href={`/evaluate/${run.id}`}>
                        <Button variant="ghost" size="sm" className="opacity-0 group-hover:opacity-100 transition-opacity">
                          View details <ChevronRight className="w-4 h-4 ml-1" />
                        </Button>
                      </Link>
                    </td>
                  </tr>
                );
              })}
              {sortedRuns.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-6 py-12 text-center text-muted-foreground">
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
