import { useModels, useDiscoverModels, useOllamaStatus } from "@/hooks/use-models";
import { useAllEvalResults, useEvalRuns } from "@/hooks/use-eval";
import { useArenaLeaderboard } from "@/hooks/use-arena";
import { Button } from "@/components/ui/Button";
import { ScoreBadge } from "@/components/ui/ScoreBadge";
import { Cpu, Search, RefreshCw } from "lucide-react";
import { useMemo } from "react";
import { clsx } from "clsx";
import { Link } from "wouter";

const SPEED_METRICS = new Set(["tokens_per_second", "total_latency_s", "load_latency_s", "prompt_tokens", "output_tokens"]);

export default function Models() {
  const { data: models = [], isLoading } = useModels();
  const { data: results = [] } = useAllEvalResults();
  const { data: runs = [] } = useEvalRuns();
  const { data: leaderboard = [] } = useArenaLeaderboard();
  const discoverMutation = useDiscoverModels();
  const { data: ollamaStatus } = useOllamaStatus();

  const eloMap = useMemo(() => {
    return Object.fromEntries((leaderboard as any[]).map((entry) => [entry.model.id, entry.rating.rating]));
  }, [leaderboard]);

  const runMap = useMemo(() => Object.fromEntries((runs as any[]).map((r) => [r.id, r])), [runs]);

  const modelMeta = useMemo(() => {
    const qualityResults = (results as any[]).filter((r) => !SPEED_METRICS.has(r.metricName));
    const tasksByModel = new Map<number, Set<string>>();
    (results as any[]).forEach((r) => {
      const task = runMap[r.runId]?.configJson?.taskType;
      if (!task) return;
      if (!tasksByModel.has(r.modelId)) tasksByModel.set(r.modelId, new Set());
      tasksByModel.get(r.modelId)!.add(task);
    });

    return Object.fromEntries(
      (models as any[]).map((model) => {
        const modelResults = qualityResults.filter((r) => r.modelId === model.id);
        const bestScore = modelResults.length ? Math.max(...modelResults.map((r) => Number(r.score))) : null;
        const avgTps = (() => {
          const tps = (results as any[]).filter((r) => r.modelId === model.id && r.metricName === "tokens_per_second");
          if (!tps.length) return null;
          return tps.reduce((sum, r) => sum + Number(r.score), 0) / tps.length;
        })();
        return [
          model.id,
          {
            bestScore,
            avgTps,
            tasks: Array.from(tasksByModel.get(model.id) ?? []),
          },
        ];
      })
    );
  }, [models, results, runMap]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold">Models</h1>
          <p className="text-sm text-muted-foreground">Local Ollama models - {models.length} available</p>
          {ollamaStatus && (
            <div className={`flex items-center gap-2 mt-3 text-xs px-3 py-1.5 rounded-full w-fit ${
              ollamaStatus.running
                ? "bg-emerald-100 text-emerald-700 border border-emerald-200"
                : "bg-rose-100 text-rose-700 border border-rose-200"
            }`}>
              <span className={`w-2 h-2 rounded-full ${ollamaStatus.running ? "bg-emerald-500" : "bg-rose-500"}`} />
              {ollamaStatus.running
                ? `Ollama connected - ${ollamaStatus.modelCount} model${ollamaStatus.modelCount !== 1 ? "s" : ""}`
                : "Ollama offline - run `ollama serve`"}
            </div>
          )}
        </div>
        <div className="flex gap-3">
          <Button
            onClick={() => discoverMutation.mutate()}
            disabled={discoverMutation.isPending}
            className="gap-2"
          >
            {discoverMutation.isPending ? (
              <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white" />
            ) : (
              <RefreshCw className="w-4 h-4" />
            )}
            Discover
          </Button>
          <Button variant="outline" className="gap-2" onClick={() => window.open("https://ollama.com/library", "_blank")}>
            <Search className="w-4 h-4" /> Browse Models
          </Button>
          <Link href="/evaluate">
            <Button className="gap-2">+ Evaluate a Model</Button>
          </Link>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-20">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div>
        </div>
      ) : models.length === 0 ? (
        <div className="text-center py-20 border border-dashed border-border rounded-xl bg-muted">
          <Cpu className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-50" />
          <h3 className="text-lg font-semibold mb-2">No models found</h3>
          <p className="text-muted-foreground mb-6">Make sure Ollama is running and you have pulled at least one model.</p>
          <Button onClick={() => discoverMutation.mutate()} disabled={discoverMutation.isPending}>Refresh</Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {(models as any[]).map((model) => {
            const meta = modelMeta[model.id] ?? {};
            const hasResults = meta.bestScore !== null && meta.bestScore !== undefined;
            return (
              <div
                key={model.id}
                className={clsx(
                  "rounded-2xl border bg-card p-5 shadow-soft flex flex-col",
                  hasResults ? "border-border hover:border-violet-300" : "border-dashed border-border bg-muted/40"
                )}
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="flex items-center gap-3">
                    <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-violet-500 to-violet-400 text-white flex items-center justify-center">
                      <Cpu className="w-5 h-5" />
                    </div>
                    <div>
                      <div className="font-mono text-sm font-semibold">{model.name}</div>
                      <div className="text-xs text-muted-foreground">{model.family ?? "Local model"}</div>
                    </div>
                  </div>
                  {eloMap[model.id] && (
                    <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-amber-100 text-amber-700">ELO {eloMap[model.id]}</span>
                  )}
                </div>

                <div className="grid grid-cols-3 gap-2 bg-muted rounded-xl p-3 text-center text-xs font-semibold text-muted-foreground mb-4">
                  <div>
                    <div className="font-mono text-sm text-foreground">{model.params ?? "-"}</div>
                    Params
                  </div>
                  <div>
                    <div className="font-mono text-sm text-foreground">{model.sizeGb ? `${model.sizeGb}G` : "-"}</div>
                    Size
                  </div>
                  <div>
                    <div className="font-mono text-sm text-foreground">{meta.avgTps ? `${meta.avgTps.toFixed(1)}/s` : "-"}</div>
                    Speed
                  </div>
                </div>

                <div className="space-y-2 mb-4">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Best Score</span>
                    {hasResults ? <ScoreBadge value={meta.bestScore} metric="rougeL" /> : <span>-</span>}
                  </div>
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Tasks</span>
                    <div className="flex gap-1.5 flex-wrap justify-end">
                      {(meta.tasks ?? []).length ? (
                        (meta.tasks ?? []).slice(0, 2).map((task: string) => (
                          <span key={task} className="text-[10px] px-2 py-0.5 rounded bg-muted text-muted-foreground">
                            {task}
                          </span>
                        ))
                      ) : (
                        <span>-</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="mt-auto flex gap-2">
                  <Link href="/evaluate" className="flex-1">
                    <Button className="w-full text-xs">Run Eval</Button>
                  </Link>
                  <Button variant="outline" className="text-xs">Details</Button>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
