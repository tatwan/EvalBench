import { useState } from "react";
import { useModels } from "@/hooks/use-models";
import { useEvalRuns, useAllEvalResults } from "@/hooks/use-eval";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Badge } from "@/components/ui/Badge";
import { Swords, AlignLeft } from "lucide-react";
import { computeCI } from "@/lib/stats";

const SPEED_METRICS = new Set([
  "tokens_per_second",
  "total_latency_s",
  "load_latency_s",
  "prompt_tokens",
  "output_tokens",
]);

const isLowerBetter = (metric: string) => metric.includes("latency");

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

  const [modelA, setModelA] = useState<string>("");
  const [modelB, setModelB] = useState<string>("");
  const [taskFilter, setTaskFilter] = useState<string>("all");

  if (modelsLoading || resultsLoading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  // Derive common tasks between selected models
  const availableTasks = new Set<string>();
  (runs as any[]).forEach(r => {
    if (r.configJson?.taskType) availableTasks.add(r.configJson.taskType);
  });

  const getModelStats = (modelId: number) => {
    const anyResults = results as any[];
    const anyRuns = runs as any[];
    
    let filtered = anyResults.filter(r => r.modelId === modelId);
    if (taskFilter !== "all") {
      filtered = filtered.filter(r => {
        const run = anyRuns.find(run => run.id === r.runId);
        return run?.configJson?.taskType === taskFilter;
      });
    }

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
    const outputSample = filtered.find(r => r.rawOutput)?.rawOutput || "No sample output available.";

    return { metrics: metricStats, sample: outputSample, evalsCount: filtered.length };
  };

  const statsA = modelA ? getModelStats(Number(modelA)) : null;
  const statsB = modelB ? getModelStats(Number(modelB)) : null;

  // Align metrics for comparison
  const allMetrics = Array.from(new Set([
    ...Object.keys(statsA?.metrics || {}),
    ...Object.keys(statsB?.metrics || {})
  ])).sort();

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
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 items-end">
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
              <Select value={taskFilter} onValueChange={setTaskFilter}>
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
          </div>
        </CardContent>
      </Card>

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
                            <span className="text-sm text-muted-foreground">{metric.replace(/_/g, " ")}</span>
                            <div className="flex flex-col items-end gap-1">
                              <span className={`font-mono font-medium ${isWinner ? 'text-emerald-400' : 'text-foreground'}`}>
                                {meanA !== undefined ? formatMetricValue(metric, meanA) : '-'}
                              </span>
                              {valA?.moe && valA.moe > 0 ? (
                                <span className="text-[10px] text-muted-foreground">± {formatMetricMoe(metric, valA.moe)}</span>
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
                            <span className="text-sm text-muted-foreground">{metric.replace(/_/g, " ")}</span>
                            <div className="flex flex-col items-end gap-1">
                              <span className={`font-mono font-medium ${isWinner ? 'text-emerald-400' : 'text-foreground'}`}>
                                {meanB !== undefined ? formatMetricValue(metric, meanB) : '-'}
                              </span>
                              {valB?.moe && valB.moe > 0 ? (
                                <span className="text-[10px] text-muted-foreground">± {formatMetricMoe(metric, valB.moe)}</span>
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
