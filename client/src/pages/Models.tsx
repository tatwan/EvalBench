import { useModels, useDiscoverModels, useOllamaStatus, useStartOllama } from "@/hooks/use-models";
import { useAllEvalResults, useEvalRuns, useCreateEvalRun } from "@/hooks/use-eval";
import { useDatasets } from "@/hooks/use-datasets";
import { useArenaLeaderboard } from "@/hooks/use-arena";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card } from "@/components/ui/Card";
import { ScoreBadge } from "@/components/ui/ScoreBadge";
import { useToast } from "@/hooks/use-toast";
import { Cpu, Search, RefreshCw } from "lucide-react";
import { useMemo, useState } from "react";
import { clsx } from "clsx";
import { Link, useLocation } from "wouter";
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer } from "recharts";

const SPEED_METRICS = new Set(["tokens_per_second", "total_latency_s", "load_latency_s", "prompt_tokens", "output_tokens", "perplexity"]);

const EMBEDDING_TOKENS = ["embed", "embedding", "nomic-embed", "bge", "e5", "mxbai", "text-embedding"];
const CODE_TOKENS = ["code", "coder", "codellama", "starcoder", "deepseek-coder"];
const VISION_TOKENS = ["vision", "llava", "vl", "clip"];
const INSTRUCT_TOKENS = ["instruct", "chat", "assistant"];

type ParamPresetKey = "all" | "small" | "medium" | "large";

function parseParamCount(params?: string | null): number | null {
  if (!params) return null;
  const match = params.match(/(\d+(\.\d+)?)(\s*)([bm])/i);
  if (!match) return null;
  const value = Number(match[1]);
  if (!Number.isFinite(value)) return null;
  return match[4].toLowerCase() === "m" ? value / 1000 : value;
}

function matchesParamPreset(paramCount: number | null, preset: ParamPresetKey): boolean {
  if (preset === "all") return true;
  if (paramCount === null) return false;
  if (preset === "small") return paramCount < 3;
  if (preset === "medium") return paramCount >= 3 && paramCount <= 13;
  return paramCount > 13;
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
  const startOllama = useStartOllama();
  const createRun = useCreateEvalRun();
  const { toast } = useToast();
  const [sizeFilter, setSizeFilter] = useState("all");
  const [specialtyFilter, setSpecialtyFilter] = useState("all");
  const [paramFilter, setParamFilter] = useState<ParamPresetKey>("all");
  const [familyFilter, setFamilyFilter] = useState("all");
  const [quantizationFilter, setQuantizationFilter] = useState("all");
  const [, navigate] = useLocation();

  const eloMap = useMemo(() => {
    return Object.fromEntries((leaderboard as any[]).map((entry) => [entry.model.id, entry.rating.rating]));
  }, [leaderboard]);

  const runMap = useMemo(() => Object.fromEntries((runs as any[]).map((r) => [r.id, r])), [runs]);

  const modelMeta = useMemo(() => {
    const successfulResults = (results as any[]).filter((r) => !r.error);
    const qualityResults = successfulResults.filter((r) => !SPEED_METRICS.has(r.metricName));
    const tasksByModel = new Map<number, Set<string>>();
    successfulResults.forEach((r) => {
      const task = runMap[r.runId]?.configJson?.taskType;
      if (!task) return;
      if (!tasksByModel.has(r.modelId)) tasksByModel.set(r.modelId, new Set());
      tasksByModel.get(r.modelId)!.add(task);
    });

    return Object.fromEntries(
      (models as any[]).map((model) => {
        const modelResults = qualityResults.filter((r) => r.modelId === model.id);
        const avgScore = modelResults.length
          ? modelResults.reduce((sum, r) => sum + Number(r.score), 0) / modelResults.length
          : null;
        const bestScore = modelResults.length ? Math.max(...modelResults.map((r) => Number(r.score))) : null;
        const runCount = new Set(modelResults.map((r) => r.runId)).size;
        const bestTaskScore = new Map<string, number>();
        modelResults.forEach((result) => {
          const task = runMap[result.runId]?.configJson?.taskType;
          if (!task) return;
          const score = Number(result.score);
          bestTaskScore.set(task, Math.max(bestTaskScore.get(task) ?? Number.NEGATIVE_INFINITY, score));
        });
        const strongestTask = Array.from(bestTaskScore.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
        const avgTps = (() => {
          const tps = successfulResults.filter((r) => r.modelId === model.id && r.metricName === "tokens_per_second");
          if (!tps.length) return null;
          return tps.reduce((sum, r) => sum + Number(r.score), 0) / tps.length;
        })();

        const scores = { Knowledge: [] as number[], Reasoning: [] as number[], Code: [] as number[], Summary: [] as number[], Translate: [] as number[] };
        modelResults.forEach(r => {
          const run = runMap[r.runId];
          if (!run) return;
          const tt = run.configJson?.taskType;
          const val = Number(r.score);
          if (Number.isNaN(val)) return;
          if (tt === "knowledge" && r.metricName === "exact_match") scores.Knowledge.push(val);
          if (tt === "reasoning" && r.metricName === "exact_match") scores.Reasoning.push(val);
          if (tt === "code" && r.metricName === "pass_at_1") scores.Code.push(val);
          if (tt === "summarization" && r.metricName === "rougeL") scores.Summary.push(val);
          if (tt === "translation" && r.metricName === "chrf") scores.Translate.push(val);
        });
        const getAvg = (arr: number[]) => arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0;
        const radarData = [
          { subject: "KNO", score: getAvg(scores.Knowledge) * 100 },
          { subject: "RSN", score: getAvg(scores.Reasoning) * 100 },
          { subject: "COD", score: getAvg(scores.Code) * 100 },
          { subject: "SUM", score: getAvg(scores.Summary) * 100 },
          { subject: "TRN", score: getAvg(scores.Translate) * 100 },
        ];
        const hasRadarData = radarData.some(d => d.score > 0);

        return [
          model.id,
          {
            bestScore,
            avgScore,
            strongestTask,
            avgTps,
            runCount,
            tasks: Array.from(tasksByModel.get(model.id) ?? []),
            radarData,
            hasRadarData
          },
        ];
      })
    );
  }, [models, results, runMap]);

  const localModels = useMemo(() => {
    return (models as any[]).filter((model) => model.family !== "cloud");
  }, [models]);

  const comparisonModels = useMemo(() => {
    return (models as any[]).filter((model) => model.family === "cloud");
  }, [models]);

  const sizeOptions = useMemo(() => {
    const buckets = Array.from(new Set((models as any[]).map((m) => sizeBucket(m.sizeGb))));
    return buckets.filter((b) => b !== "Unknown").sort((a, b) => a.localeCompare(b));
  }, [models]);

  const specialtyOptions = useMemo(() => {
    const tags = new Set<string>();
    localModels.forEach((m) => {
      deriveSpecialties(m.name, m.family).forEach((t) => tags.add(t));
    });
    return Array.from(tags).sort();
  }, [localModels]);

  const familyOptions = useMemo(() => {
    return Array.from(
      new Set(localModels.map((model) => model.family).filter((value): value is string => Boolean(value)))
    ).sort((a, b) => a.localeCompare(b));
  }, [localModels]);

  const quantizationOptions = useMemo(() => {
    return Array.from(
      new Set(localModels.map((model) => model.quantization).filter((value): value is string => Boolean(value)))
    ).sort((a, b) => a.localeCompare(b));
  }, [localModels]);

  const filteredLocalModels = useMemo(() => {
    return localModels.filter((model) => {
      const paramCount = parseParamCount(model.params);
      const specialties = deriveSpecialties(model.name, model.family);
      const matchesParam = matchesParamPreset(paramCount, paramFilter);
      const matchesSize = sizeFilter === "all" || sizeBucket(model.sizeGb) === sizeFilter;
      const matchesSpecialty = specialtyFilter === "all" || specialties.includes(specialtyFilter);
      const matchesFamily = familyFilter === "all" || model.family === familyFilter;
      const matchesQuantization = quantizationFilter === "all" || model.quantization === quantizationFilter;
      return matchesParam && matchesSize && matchesSpecialty && matchesFamily && matchesQuantization;
    });
  }, [localModels, paramFilter, sizeFilter, specialtyFilter, familyFilter, quantizationFilter]);

  const embeddingModels = useMemo(() => {
    return (models as any[]).filter((model) => model.family !== "cloud" && deriveSpecialties(model.name, model.family).includes("embedding"));
  }, [models]);

  const embeddingDataset = useMemo(() => {
    return (datasets as any[]).find((d) => d.name === "EvalBench Embeddings v1");
  }, [datasets]);

  const embeddingModelIds = useMemo(() => embeddingModels.map((m: any) => m.id), [embeddingModels]);

  const embeddingBadgeModels = useMemo(() => {
    return [...embeddingModels]
      .sort((a, b) => {
        const aTps = modelMeta[a.id]?.avgTps ?? 0;
        const bTps = modelMeta[b.id]?.avgTps ?? 0;
        return bTps - aTps;
      });
  }, [embeddingModels, modelMeta]);

  const activeLocalFilterCount = useMemo(() => {
    let count = 0;
    if (paramFilter !== "all") count += 1;
    if (sizeFilter !== "all") count += 1;
    if (specialtyFilter !== "all") count += 1;
    if (familyFilter !== "all") count += 1;
    if (quantizationFilter !== "all") count += 1;
    return count;
  }, [paramFilter, sizeFilter, specialtyFilter, familyFilter, quantizationFilter]);

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
      },
      {
        onSuccess: () => {
          navigate("/history");
        },
      }
    );
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-extrabold">Models</h1>
          <p className="text-sm text-muted-foreground">
            {localModels.length} local model{localModels.length === 1 ? "" : "s"} ready for local-first evaluation
          </p>
          {activeLocalFilterCount > 0 ? (
            <p className="text-xs text-muted-foreground mt-1">
              Showing {filteredLocalModels.length} after {activeLocalFilterCount} active filter{activeLocalFilterCount === 1 ? "" : "s"}.
            </p>
          ) : null}
          {comparisonModels.length > 0 ? (
            <p className="text-xs text-muted-foreground mt-1">
              {comparisonModels.length} model{comparisonModels.length === 1 ? "" : "s"} captured from benchmark/comparison runs live below the local catalog.
            </p>
          ) : null}
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
          {!ollamaStatus?.running ? (
            <div className="mt-3">
              <Button variant="outline" size="sm" onClick={() => startOllama.mutate()} disabled={startOllama.isPending}>
                {startOllama.isPending ? "Starting Ollama..." : "Start Ollama"}
              </Button>
            </div>
          ) : null}
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
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <div className="text-xs font-semibold text-muted-foreground">Filter</div>
            <div className="w-[170px] space-y-1">
              <div className="text-[11px] font-medium text-muted-foreground">Model size</div>
              <Select value={sizeFilter} onValueChange={setSizeFilter}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Model size" />
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
            <div className="w-[200px] space-y-1">
              <div className="text-[11px] font-medium text-muted-foreground">Model parameters</div>
              <Select value={paramFilter} onValueChange={(value) => setParamFilter(value as ParamPresetKey)}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Model parameters" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="small">Small (&lt;3B)</SelectItem>
                  <SelectItem value="medium">Medium (3-13B)</SelectItem>
                  <SelectItem value="large">Large (&gt;13B)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="w-[180px] space-y-1">
              <div className="text-[11px] font-medium text-muted-foreground">Model specialty</div>
              <Select value={specialtyFilter} onValueChange={setSpecialtyFilter}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Model specialty" />
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
            <div className="w-[180px] space-y-1">
              <div className="text-[11px] font-medium text-muted-foreground">Model family</div>
              <Select value={familyFilter} onValueChange={setFamilyFilter}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Model family" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All families</SelectItem>
                  {familyOptions.map((family) => (
                    <SelectItem key={family} value={family}>{family}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="w-[180px] space-y-1">
              <div className="text-[11px] font-medium text-muted-foreground">Quantization</div>
              <Select value={quantizationFilter} onValueChange={setQuantizationFilter}>
                <SelectTrigger className="h-8 text-xs">
                  <SelectValue placeholder="Quantization" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All quantization</SelectItem>
                  {quantizationOptions.map((quantization) => (
                    <SelectItem key={quantization} value={quantization}>{quantization}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button variant="ghost" size="sm" className="text-xs" onClick={() => {
              setParamFilter("all");
              setSizeFilter("all");
              setSpecialtyFilter("all");
              setFamilyFilter("all");
              setQuantizationFilter("all");
            }}>
              Reset
            </Button>
          </div>
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
                {embeddingBadgeModels.map((model) => (
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
      ) : localModels.length === 0 ? (
        <div className="text-center py-20 border border-dashed border-border rounded-xl bg-muted">
          <Cpu className="w-12 h-12 text-muted-foreground mx-auto mb-4 opacity-50" />
          <h3 className="text-lg font-semibold mb-2">No local models found</h3>
          <p className="text-muted-foreground mb-6">
            Make sure Ollama is running and you have pulled at least one model.
          </p>
          <div className="flex items-center justify-center gap-3">
            <Button onClick={() => discoverMutation.mutate()} disabled={discoverMutation.isPending}>Refresh</Button>
            {!ollamaStatus?.running ? (
              <Button variant="outline" onClick={() => startOllama.mutate()} disabled={startOllama.isPending}>
                {startOllama.isPending ? "Starting Ollama..." : "Start Ollama"}
              </Button>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="space-y-8">
          <div>
            <div className="flex items-center justify-between gap-3 mb-4">
              <div>
                <h2 className="text-lg font-bold">Local Models</h2>
                <p className="text-sm text-muted-foreground">Your primary working set for EvalBench.</p>
              </div>
              <Badge variant="secondary">{filteredLocalModels.length}</Badge>
            </div>
            {filteredLocalModels.length === 0 ? (
              <div className="text-center py-12 border border-dashed border-border rounded-xl bg-muted">
                <p className="text-muted-foreground mb-2">No local models match the current filters.</p>
                <p className="text-xs text-muted-foreground">Try widening the parameter range or resetting the filters.</p>
              </div>
            ) : (
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {filteredLocalModels.map((model: any) => {
                  const meta = modelMeta[model.id] ?? {};
                  const hasResults = meta.avgScore !== null && meta.avgScore !== undefined;
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
                          <span>Avg Score</span>
                          {hasResults ? <ScoreBadge value={meta.avgScore} metric="rougeL" /> : <span>-</span>}
                        </div>
                        {meta.strongestTask ? (
                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>Strongest Task</span>
                            <span className="text-[10px] px-2 py-0.5 rounded bg-muted text-foreground/80 capitalize">{meta.strongestTask}</span>
                          </div>
                        ) : null}
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>Evaluations</span>
                          <span>{meta.runCount ?? 0}</span>
                        </div>
                        {meta.hasRadarData ? (
                          <div className="h-28 w-full -ml-3 mt-1">
                            <ResponsiveContainer width="100%" height="100%">
                              <RadarChart cx="50%" cy="50%" outerRadius="65%" data={meta.radarData}>
                                <PolarGrid stroke="#e2e8f0" />
                                <PolarAngleAxis dataKey="subject" tick={{ fill: "#64748b", fontSize: 9, fontWeight: 700 }} />
                                <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} stroke="none" />
                                <Radar name={model.name} dataKey="score" stroke="#8b5cf6" fill="#8b5cf6" fillOpacity={0.4} />
                              </RadarChart>
                            </ResponsiveContainer>
                          </div>
                        ) : (
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
                        )}
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

          {comparisonModels.length > 0 ? (
            <div>
              <div className="flex items-center justify-between gap-3 mb-4">
                <div>
                  <h2 className="text-lg font-bold">Benchmark / Comparison Models</h2>
                  <p className="text-sm text-muted-foreground">Persisted from frontier or side-by-side runs. Kept separate so the main catalog stays local-first.</p>
                </div>
                <Badge variant="outline">{comparisonModels.length}</Badge>
              </div>
              <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
                {comparisonModels.map((model: any) => {
                  const meta = modelMeta[model.id] ?? {};
                  const hasResults = meta.avgScore !== null && meta.avgScore !== undefined;
                  const specialties = deriveSpecialties(model.name, model.family);
                  return (
                    <div
                      key={model.id}
                      className={clsx(
                        "rounded-2xl border bg-card p-5 shadow-soft flex flex-col",
                        hasResults ? "border-border hover:border-sky-300" : "border-dashed border-border bg-muted/40"
                      )}
                    >
                      <div className="flex items-start justify-between mb-4">
                        <div className="flex items-center gap-3">
                          <div className="h-10 w-10 rounded-xl bg-gradient-to-br from-sky-500 to-sky-400 text-white flex items-center justify-center">
                            <Cpu className="w-5 h-5" />
                          </div>
                          <div>
                            <div className="font-mono text-sm font-semibold">{model.name}</div>
                            <div className="text-xs text-muted-foreground">Comparison model</div>
                          </div>
                        </div>
                      </div>
                      <div className="flex flex-wrap gap-1.5 mb-4">
                        <Badge variant="outline" className="text-[10px] uppercase tracking-wide">
                          frontier
                        </Badge>
                        {specialties.map((tag: string) => (
                          <Badge key={tag} variant="secondary" className="text-[10px] uppercase tracking-wide">
                            {tag}
                          </Badge>
                        ))}
                      </div>
                      <div className="grid grid-cols-3 gap-2 bg-muted rounded-xl p-3 text-center text-xs font-semibold text-muted-foreground mb-4">
                        <div>
                          <div className="font-mono text-sm text-foreground">{model.params ?? "-"}</div>
                          Params
                        </div>
                        <div>
                          <div className="font-mono text-sm text-foreground">{meta.avgTps ? `${meta.avgTps.toFixed(1)}/s` : "-"}</div>
                          Speed
                        </div>
                        <div>
                          <div className="font-mono text-sm text-foreground">{hasResults ? "Yes" : "No"}</div>
                          Results
                        </div>
                      </div>
                      <div className="space-y-2 mb-4">
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>Avg Score</span>
                          {hasResults ? <ScoreBadge value={meta.avgScore} metric="rougeL" /> : <span>-</span>}
                        </div>
                        {meta.strongestTask ? (
                          <div className="flex items-center justify-between text-xs text-muted-foreground">
                            <span>Strongest Task</span>
                            <span className="text-[10px] px-2 py-0.5 rounded bg-muted text-foreground/80 capitalize">{meta.strongestTask}</span>
                          </div>
                        ) : null}
                        <div className="flex items-center justify-between text-xs text-muted-foreground">
                          <span>Evaluations</span>
                          <span>{meta.runCount ?? 0}</span>
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
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}
