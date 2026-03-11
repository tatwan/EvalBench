import { useModels, useDiscoverModels, useOllamaStatus } from "@/hooks/use-models";
import { useAllEvalResults, useEvalRuns, useCreateEvalRun } from "@/hooks/use-eval";
import { useDatasets } from "@/hooks/use-datasets";
import { useArenaLeaderboard } from "@/hooks/use-arena";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/card";
import { ScoreBadge } from "@/components/ui/ScoreBadge";
import { useToast } from "@/hooks/use-toast";
import { Cpu, Search, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { clsx } from "clsx";
import { Link } from "wouter";

const SPEED_METRICS = new Set(["tokens_per_second", "total_latency_s", "load_latency_s", "prompt_tokens", "output_tokens"]);

const EMBEDDING_TOKENS = ["embed", "embedding", "nomic-embed", "bge", "e5", "mxbai", "text-embedding"];
const CODE_TOKENS = ["code", "coder", "codellama", "starcoder", "deepseek-coder"];
const VISION_TOKENS = ["vision", "llava", "vl", "clip"];
const INSTRUCT_TOKENS = ["instruct", "chat", "assistant"];

function parseParamCount(params?: string | null): number | null {
  if (!params) return null;
  const match = params.match(/(\d+(\.\d+)?)(\s*)b/i);
  if (!match) return null;
  return Number(match[1]);
}

function sizeBucket(sizeGb?: number | null): string {
  if (!sizeGb) return "Unknown";
  if (sizeGb < 4) return "<4 GB";
  if (sizeGb < 8) return "4–8 GB";
  if (sizeGb < 16) return "8–16 GB";
  if (sizeGb < 32) return "16–32 GB";
  return "32+ GB";
}

function deriveSpecialties(name?: string | null, family?: string | null): string[] {
  const source = `${name ?? ""} ${family ?? ""}`.toLowerCase();
  const tags: string[] = [];
  if (EMBEDDING_TOKENS.some((t) => source.includes(t))) tags.push("embedding");
  if (CODE_TOKENS.some((t) => source.includes(t))) tags.push("code");
  if (VISION_TOKENS.some((t) => source.includes(t))) tags.push("vision");
  if (INSTRUCT_TOKENS.some((t) => source.includes(t))) tags.push("instruction");
  return tags.length ? tags : ["general"];
}

export default function Models() {
  const { data: models = [], isLoading } = useModels();
  const { data: results = [] } = useAllEvalResults();
  const { data: runs = [] } = useEvalRuns();
  const { data: datasets = [] } = useDatasets();
  const { data: leaderboard = [] } = useArenaLeaderboard();
  const discoverMutation = useDiscoverModels();
  const { data: ollamaStatus } = useOllamaStatus();
  const createRun = useCreateEvalRun();
  const { toast } = useToast();
  const [paramFilter, setParamFilter] = useState("all");
  const [sizeFilter, setSizeFilter] = useState("all");
  const [specialtyFilter, setSpecialtyFilter] = useState("all");

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

  const paramOptions = useMemo(() => {
    const params = Array.from(new Set((models as any[]).map((m) => m.params).filter(Boolean)));
    return params.sort((a, b) => {
      const pa = parseParamCount(a) ?? 0;
      const pb = parseParamCount(b) ?? 0;
      return pa - pb;
    });
  }, [models]);

  const sizeOptions = useMemo(() => {
    const buckets = Array.from(new Set((models as any[]).map((m) => sizeBucket(m.sizeGb))));
    return buckets.filter((b) => b !== "Unknown").sort((a, b) => a.localeCompare(b));
  }, [models]);

  const specialtyOptions = useMemo(() => {
    const tags = new Set<string>();
    (models as any[]).forEach((m) => {
      deriveSpecialties(m.name, m.family).forEach((t) => tags.add(t));
    });
    return Array.from(tags).sort();
  }, [models]);

  const filteredModels = useMemo(() => {
    return (models as any[]).filter((model) => {
      const specialties = deriveSpecialties(model.name, model.family);
      const matchesParam = paramFilter === "all" || model.params === paramFilter;
      const matchesSize = sizeFilter === "all" || sizeBucket(model.sizeGb) === sizeFilter;
      const matchesSpecialty = specialtyFilter === "all" || specialties.includes(specialtyFilter);
      return matchesParam && matchesSize && matchesSpecialty;
    });
  }, [models, paramFilter, sizeFilter, specialtyFilter]);

  const embeddingModels = useMemo(() => {
    return (models as any[]).filter((model) => deriveSpecialties(model.name, model.family).includes("embedding"));
  }, [models]);

  const embeddingDataset = useMemo(() => {
    return (datasets as any[]).find((d) => d.name === "EvalBench Embeddings v1");
  }, [datasets]);

  const embeddingModelIds = useMemo(() => embeddingModels.map((m: any) => m.id), [embeddingModels]);

  const recommendedEmbedding = useMemo(() => {
    return [...embeddingModels]
      .sort((a, b) => {
        const aTps = modelMeta[a.id]?.avgTps ?? 0;
        const bTps = modelMeta[b.id]?.avgTps ?? 0;
        return bTps - aTps;
      })
      .slice(0, 3);
  }, [embeddingModels, modelMeta]);

  const handleEmbeddingEval = () => {
    if (embeddingModelIds.length === 0) {
      toast({
        title: "No embedding models detected",
        description: "Run model discovery or install an embedding model in Ollama.",
      });
      return;
    }
    if (!embeddingDataset) {
      toast({
        title: "Embedding dataset missing",
        description: "Restart the backend to seed EvalBench Embeddings v1.",
      });
      return;
    }
    createRun.mutate(
      {
        modelIds: embeddingModelIds,
        taskType: "embedding",
        datasetId: embeddingDataset.id,
      } as any,
      {
        onSuccess: () => {
          window.location.href = "/history";
        },
      }
    );
  };

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

      <Card className="p-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="text-xs font-semibold text-muted-foreground">Filter</div>
          <div className="w-[160px]">
            <Select value={sizeFilter} onValueChange={setSizeFilter}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Size" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All sizes</SelectItem>
                {sizeOptions.map((size) => (
                  <SelectItem key={size} value={size}>{size}</SelectItem>
                ))}
                <SelectItem value="Unknown">Unknown</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="w-[160px]">
            <Select value={paramFilter} onValueChange={setParamFilter}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Params" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All params</SelectItem>
                {paramOptions.map((param) => (
                  <SelectItem key={param} value={param}>{param}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="w-[180px]">
            <Select value={specialtyFilter} onValueChange={setSpecialtyFilter}>
              <SelectTrigger className="h-8 text-xs">
                <SelectValue placeholder="Specialty" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All specialties</SelectItem>
                {specialtyOptions.map((tag) => (
                  <SelectItem key={tag} value={tag}>
                    {tag.charAt(0).toUpperCase() + tag.slice(1)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <Button variant="ghost" size="sm" className="text-xs" onClick={() => {
            setParamFilter("all");
            setSizeFilter("all");
            setSpecialtyFilter("all");
          }}>
            Reset
          </Button>
        </div>
      </Card>

      {embeddingModels.length > 0 && (
        <Card className="p-4 border border-emerald-200 bg-gradient-to-r from-emerald-50 to-sky-50">
          <div className="flex flex-col md:flex-row md:items-center justify-between gap-3">
            <div>
              <div className="text-sm font-semibold text-emerald-800">Embedding Eval Ready</div>
              <div className="text-xs text-emerald-900/70">
                Detected {embeddingModels.length} embedding model{embeddingModels.length !== 1 ? "s" : ""} based on model metadata.
              </div>
              <div className="flex flex-wrap gap-2 mt-3">
                {recommendedEmbedding.map((model) => (
                  <span key={model.id} className="text-[10px] font-semibold px-2 py-1 rounded-full bg-white text-emerald-700 border border-emerald-200">
                    {model.name}
                  </span>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <Button className="text-xs" onClick={handleEmbeddingEval} disabled={createRun.isPending}>
                {createRun.isPending ? "Starting..." : "Start Embedding Eval"}
              </Button>
            </div>
          </div>
        </Card>
      )}

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
          {filteredModels.map((model: any) => {
            const meta = modelMeta[model.id] ?? {};
            const hasResults = meta.bestScore !== null && meta.bestScore !== undefined;
            const specialties = deriveSpecialties(model.name, model.family);
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
                  <div className="flex flex-wrap gap-1.5 mb-4">
                    {specialties.map((tag: string) => (
                      <Badge key={tag} variant="secondary" className="text-[10px] uppercase tracking-wide">
                        {tag}
                      </Badge>
                    ))}
                    {model.quantization && (
                      <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                        {model.quantization}
                      </Badge>
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

                <div className="mt-auto">
                  <Link href={`/models/${model.id}`}>
                    <Button variant="outline" className="text-xs w-full">Details</Button>
                  </Link>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
