import { useMemo, useState } from "react";
import { useModels } from "@/hooks/use-models";
import { useEvalRuns, useAllEvalResults } from "@/hooks/use-eval";
import { useDatasets } from "@/hooks/use-datasets";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/Badge";
import { Swords, AlignLeft, Hexagon } from "lucide-react";
import { computeCI, pairedTTest } from "@/lib/stats";
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Legend, Tooltip } from 'recharts';

const SPEED_METRICS = new Set([
  "tokens_per_second",
  "total_latency_s",
  "load_latency_s",
  "prompt_tokens",
  "output_tokens",
  "perplexity",
  "Speed (T/s)",
]);

const isLowerBetter = (metric: string) => metric.includes("latency") || metric === "perplexity";

const formatMetricValue = (metric: string, value: number) => {
  if (metric.includes("tokens_per_second")) return `${value.toFixed(1)} t/s`;
  if (metric.includes("latency")) return `${value.toFixed(2)}s`;
  if (metric.includes("tokens")) return `${value.toFixed(0)}`;
  if (SPEED_METRICS.has(metric)) return value.toFixed(2);
  return `${(value * 100).toFixed(1)}%`;
};

const formatMetricMoe = (metric: string, moe: number) => {
  if (metric.includes("tokens_per_second")) return `${moe.toFixed(1)} t/s`;
  if (metric.includes("latency")) return `${moe.toFixed(2)}s`;
  if (metric.includes("tokens")) return `${moe.toFixed(0)}`;
  if (SPEED_METRICS.has(metric)) return moe.toFixed(2);
  return `${(moe * 100).toFixed(1)}%`;
};

export default function CompareModels() {
  const { data: models = [], isLoading: modelsLoading } = useModels();
  const { data: runs = [] } = useEvalRuns();
  const { data: results = [], isLoading: resultsLoading } = useAllEvalResults();
  const { data: datasets = [] } = useDatasets();

  const [modelA, setModelA] = useState<string>("");
  const [modelB, setModelB] = useState<string>("");
  const [taskFilter, setTaskFilter] = useState<string>("all");
  const [contextFilter, setContextFilter] = useState<string>("all");

  if (modelsLoading || resultsLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  const datasetMap = useMemo(
    () => Object.fromEntries((datasets as any[]).map((d) => [d.id, d.name])),
    [datasets]
  );

  const sharedRuns = useMemo(() => {
    const modelAId = Number(modelA);
    const modelBId = Number(modelB);
    if (!modelAId || !modelBId) return [];
    return (runs as any[]).filter((run) => {
      const ids = run.configJson?.modelIds ?? [];
      const matchesTask = taskFilter === "all" || run.configJson?.taskType === taskFilter;
      return run.status === "completed" && matchesTask && ids.includes(modelAId) && ids.includes(modelBId);
    });
  }, [runs, modelA, modelB, taskFilter]);

  const availableTasks = useMemo(() => {
    const sourceRuns = modelA && modelB ? sharedRuns : (runs as any[]);
    const tasks = new Set<string>();
    sourceRuns.forEach((r: any) => {
      if (r.configJson?.taskType) tasks.add(r.configJson.taskType);
    });
    return Array.from(tasks).sort();
  }, [runs, sharedRuns, modelA, modelB]);

  const availableContexts = useMemo(() => {
    const contexts = new Map<string, { label: string; count: number }>();
    sharedRuns.forEach((run: any) => {
      const task = run.configJson?.taskType ?? "unknown";
      const datasetId = run.configJson?.datasetId ?? "adhoc";
      const datasetName = run.configJson?.datasetId ? (datasetMap[run.configJson.datasetId] ?? `Dataset ${run.configJson.datasetId}`) : "Ad-hoc";
      const key = `${task}|${datasetId}`;
      const label = `${task} • ${datasetName}`;
      const existing = contexts.get(key);
      contexts.set(key, { label, count: (existing?.count ?? 0) + 1 });
    });
    return Array.from(contexts.entries()).map(([value, meta]) => ({ value, ...meta }));
  }, [sharedRuns, datasetMap]);

  const eligibleRunIds = useMemo(() => {
    const scopedRuns = contextFilter === "all"
      ? sharedRuns
      : sharedRuns.filter((run: any) => {
          const task = run.configJson?.taskType ?? "unknown";
          const datasetId = run.configJson?.datasetId ?? "adhoc";
          return `${task}|${datasetId}` === contextFilter;
        });
    return new Set(scopedRuns.map((run: any) => run.id));
  }, [sharedRuns, contextFilter]);

  const getModelStats = (modelId: number) => {
    const anyResults = results as any[];
    const filtered = anyResults.filter((r) => r.modelId === modelId && !r.error && eligibleRunIds.has(r.runId));

    if (filtered.length === 0) return null;

    // Group by metric
    const metricScores: Record<string, number[]> = {};
    
    filtered.forEach(r => {
      if (!metricScores[r.metricName]) {
        metricScores[r.metricName] = [];
      }
      metricScores[r.metricName].push(Number(r.score));
    });

    const metricStats: Record<string, { mean: number; moe: number }> = {};
    Object.keys(metricScores).forEach(m => {
      const stats = computeCI(metricScores[m]);
      if (stats) metricStats[m] = stats;
    });

    // Get a sample output if available
    const outputSample = filtered.find(r => r.rawOutput)?.rawOutput || "No successful sample output available.";

    return { metrics: metricStats, sample: outputSample, evalsCount: filtered.length };
  };

  const statsA = modelA ? getModelStats(Number(modelA)) : null;
  const statsB = modelB ? getModelStats(Number(modelB)) : null;

  // Align metrics for comparison
  const allMetrics = Array.from(new Set([
    ...Object.keys(statsA?.metrics || {}),
    ...Object.keys(statsB?.metrics || {})
  ])).sort();

  const significanceMap = useMemo(() => {
    if (!modelA || !modelB || !statsA || !statsB) return {};
    const anyResults = results as any[];
    const mapA = new Map<string, number>();
    const mapB = new Map<string, number>();

    anyResults.forEach(r => {
      if (r.modelId === Number(modelA) && !r.error && eligibleRunIds.has(r.runId)) {
        mapA.set(`${r.runId}|${r.itemId}|${r.metricName}`, Number(r.score));
      }
      if (r.modelId === Number(modelB) && !r.error && eligibleRunIds.has(r.runId)) {
        mapB.set(`${r.runId}|${r.itemId}|${r.metricName}`, Number(r.score));
      }
    });

    const pairs: Record<string, { a: number[]; b: number[] }> = {};
    mapA.forEach((scoreA, key) => {
      const parts = key.split('|');
      const metric = parts[2];
      if (mapB.has(key)) {
         if (!pairs[metric]) pairs[metric] = { a: [], b: [] };
         pairs[metric].a.push(scoreA);
         pairs[metric].b.push(mapB.get(key)!);
      }
    });

    const significance: Record<string, any> = {};
    Object.keys(pairs).forEach(metric => {
       significance[metric] = pairedTTest(pairs[metric].a, pairs[metric].b);
    });
    return significance;
  }, [results, modelA, modelB, eligibleRunIds]);

  const radarData = useMemo(() => {
    if (!statsA || !statsB) return [];
    return allMetrics
      .filter(m => !SPEED_METRICS.has(m) && !m.includes("latency") && !m.includes("tokens"))
      .map(m => {
        return {
          subject: m.replace(/_/g, " "),
          [(models as any[]).find(model => model.id.toString() === modelA)?.name || "Model A"]: statsA.metrics[m]?.mean || 0,
          [(models as any[]).find(model => model.id.toString() === modelB)?.name || "Model B"]: statsB.metrics[m]?.mean || 0,
        };
      });
  }, [allMetrics, statsA, statsB, models, modelA, modelB]);

  return (
    <div className="space-y-8 max-w-6xl mx-auto">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-3">
          <Swords className="w-8 h-8 text-primary" />
          Head-to-Head Compare
        </h1>
        <p className="text-muted-foreground mt-2">Put two models side-by-side to compare metric performance and raw outputs.</p>
      </div>

      <Card className="bg-card border-border">
        <CardContent className="p-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-6 items-end">
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Model A</label>
              <Select value={modelA} onValueChange={setModelA}>
                <SelectTrigger className="bg-card w-full">
                  <SelectValue placeholder="Select Challenger 1" />
                </SelectTrigger>
                <SelectContent>
                  {(models as any[]).map(m => (
                    <SelectItem key={m.id} value={m.id.toString()}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Model B</label>
              <Select value={modelB} onValueChange={setModelB}>
                <SelectTrigger className="bg-card w-full">
                  <SelectValue placeholder="Select Challenger 2" />
                </SelectTrigger>
                <SelectContent>
                  {(models as any[]).map(m => (
                    <SelectItem key={m.id} value={m.id.toString()} disabled={m.id.toString() === modelA}>{m.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Task Filter</label>
              <Select value={taskFilter} onValueChange={(value) => {
                setTaskFilter(value);
                setContextFilter("all");
              }}>
                <SelectTrigger className="bg-card w-full capitalize">
                  <SelectValue placeholder="All Tasks" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Tasks</SelectItem>
                  {Array.from(availableTasks).sort().map(t => (
                    <SelectItem key={t} value={t} className="capitalize">{t}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <label className="text-sm font-medium text-muted-foreground">Shared Context</label>
              <Select value={contextFilter} onValueChange={setContextFilter}>
                <SelectTrigger className="bg-card w-full">
                  <SelectValue placeholder="All shared contexts" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All shared contexts</SelectItem>
                  {availableContexts.map((context) => (
                    <SelectItem key={context.value} value={context.value}>
                      {context.label} ({context.count})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {modelA && modelB && (
            <div className="mt-4 flex flex-wrap gap-2 items-center">
              <Badge variant="secondary">{sharedRuns.length} shared completed runs</Badge>
              <span className="text-xs text-muted-foreground">
                This comparison only includes runs where both models were evaluated together under the same completed run configuration.
              </span>
              {sharedRuns.length === 0 ? (
                <span className="text-xs text-amber-700">
                  Run a shared benchmark first to unlock a fair head-to-head comparison.
                </span>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      {modelA && modelB && radarData.length > 0 && (
        <Card className="bg-card border-border mb-8 overflow-hidden">
          <CardHeader className="bg-muted/30 border-b border-border">
            <CardTitle className="flex items-center gap-2 text-lg">
              <Hexagon className="w-5 h-5 text-indigo-400" />
              Model Capability Signatures
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-6">
            <div className="h-[400px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart cx="50%" cy="50%" outerRadius="75%" data={radarData}>
                  <PolarGrid stroke="var(--border)" />
                  <PolarAngleAxis dataKey="subject" tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }} />
                  <PolarRadiusAxis angle={30} domain={[0, 1]} tick={{ fill: 'hsl(var(--muted-foreground))' }} />
                  <Radar name={(models as any[]).find(m => m.id.toString() === modelA)?.name || "Model A"} dataKey={(models as any[]).find(m => m.id.toString() === modelA)?.name || "Model A"} stroke="#38bdf8" fill="#38bdf8" fillOpacity={0.4} />
                  <Radar name={(models as any[]).find(m => m.id.toString() === modelB)?.name || "Model B"} dataKey={(models as any[]).find(m => m.id.toString() === modelB)?.name || "Model B"} stroke="#f472b6" fill="#f472b6" fillOpacity={0.4} />
                  <Legend />
                  <Tooltip contentStyle={{ backgroundColor: 'hsl(var(--card))', border: '1px solid hsl(var(--border))', borderRadius: '8px' }} />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>
      )}

      {modelA && modelB && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
          {/* Column A */}
          <div className="space-y-6">
            <div className="flex items-center justify-between pb-4 border-b border-border">
              <h2 className="text-xl font-bold text-sky-400">
                {(models as any[]).find(m => m.id.toString() === modelA)?.name}
              </h2>
              {statsA && <Badge variant="secondary">{statsA.evalsCount} Evals</Badge>}
            </div>
            
            {!statsA ? (
              <div className="p-8 text-center border border-dashed border-border rounded-xl text-muted-foreground bg-muted/40">
                No evaluation data for this selection.
              </div>
            ) : (
              <>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Metric Averages</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {allMetrics.map(metric => {
                        const valA = statsA.metrics[metric];
                        const valB = statsB?.metrics[metric];
                        const meanA = valA?.mean;
                        const meanB = valB?.mean;
                        const isWinner = meanA !== undefined && meanB !== undefined
                          ? isLowerBetter(metric)
                            ? meanA < meanB
                            : meanA > meanB
                          : false;
                        
                        return (
                          <div key={metric} className="flex items-center justify-between">
                            <span className="text-sm text-muted-foreground flex items-center gap-2">
                              {metric.replace(/_/g, " ")}
                              {significanceMap[metric]?.significant === false && (
                                <Badge variant="secondary" className="h-[18px] text-[10px] px-1.5 font-normal bg-muted text-muted-foreground border-border/50">Tie</Badge>
                              )}
                              {significanceMap[metric]?.significant === true && isWinner && (
                                <Badge variant="default" className="h-[18px] text-[10px] px-1.5 font-medium bg-emerald-500/20 text-emerald-400 border-emerald-500/30">Winner</Badge>
                              )}
                            </span>
                            <div className="flex items-center gap-1">
                              <span className={`font-mono font-medium ${isWinner && significanceMap[metric]?.significant !== false ? 'text-emerald-400' : 'text-foreground'}`}>
                                {meanA !== undefined ? formatMetricValue(metric, meanA) : '-'}
                              </span>
                              {valA?.moe && valA.moe > 0 ? (
                                <span className="text-xs font-mono text-muted-foreground">± {formatMetricMoe(metric, valA.moe)}</span>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <AlignLeft className="w-4 h-4" /> Example Output
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="bg-muted p-4 rounded-lg text-sm text-muted-foreground overflow-y-auto max-h-[300px] whitespace-pre-wrap">
                      {statsA.sample}
                    </div>
                  </CardContent>
                </Card>
              </>
            )}
          </div>

          {/* Column B */}
          <div className="space-y-6">
            <div className="flex items-center justify-between pb-4 border-b border-border">
              <h2 className="text-xl font-bold text-pink-400">
                {(models as any[]).find(m => m.id.toString() === modelB)?.name}
              </h2>
              {statsB && <Badge variant="secondary">{statsB.evalsCount} Evals</Badge>}
            </div>

            {!statsB ? (
              <div className="p-8 text-center border border-dashed border-border rounded-xl text-muted-foreground bg-muted/40">
                No evaluation data for this selection.
              </div>
            ) : (
              <>
                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Metric Averages</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-3">
                      {allMetrics.map(metric => {
                        const valB = statsB.metrics[metric];
                        const valA = statsA?.metrics[metric];
                        const meanB = valB?.mean;
                        const meanA = valA?.mean;
                        const isWinner = meanB !== undefined && meanA !== undefined
                          ? isLowerBetter(metric)
                            ? meanB < meanA
                            : meanB > meanA
                          : false;
                        
                        return (
                          <div key={metric} className="flex items-center justify-between">
                            <span className="text-sm text-muted-foreground flex items-center gap-2">
                              {metric.replace(/_/g, " ")}
                              {significanceMap[metric]?.significant === false && (
                                <Badge variant="secondary" className="h-[18px] text-[10px] px-1.5 font-normal bg-muted text-muted-foreground border-border/50">Tie</Badge>
                              )}
                              {significanceMap[metric]?.significant === true && isWinner && (
                                <Badge variant="default" className="h-[18px] text-[10px] px-1.5 font-medium bg-pink-500/20 text-pink-400 border-pink-500/30">Winner</Badge>
                              )}
                            </span>
                            <div className="flex items-center gap-1">
                              <span className={`font-mono font-medium ${isWinner && significanceMap[metric]?.significant !== false ? 'text-pink-400' : 'text-foreground'}`}>
                                {meanB !== undefined ? formatMetricValue(metric, meanB) : '-'}
                              </span>
                              {valB?.moe && valB.moe > 0 ? (
                                <span className="text-xs font-mono text-muted-foreground">± {formatMetricMoe(metric, valB.moe)}</span>
                              ) : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm flex items-center gap-2">
                      <AlignLeft className="w-4 h-4" /> Example Output
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="bg-muted p-4 rounded-lg text-sm text-muted-foreground overflow-y-auto max-h-[300px] whitespace-pre-wrap">
                      {statsB.sample}
                    </div>
                  </CardContent>
                </Card>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
