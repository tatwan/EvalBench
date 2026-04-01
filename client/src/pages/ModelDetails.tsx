import { useMemo } from "react";
import { useParams, Link, useLocation } from "wouter";
import { format } from "date-fns";
import { clsx } from "clsx";
import { useModels } from "@/hooks/use-models";
import { useEvalRuns, useAllEvalResults } from "@/hooks/use-eval";
import { useArenaLeaderboard } from "@/hooks/use-arena";
import { useDatasets } from "@/hooks/use-datasets";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Cpu, ArrowLeft, Activity, Clock, CheckCircle2, BarChart3 } from "lucide-react";
import { Radar, RadarChart, PolarGrid, PolarAngleAxis, PolarRadiusAxis, ResponsiveContainer, Tooltip } from "recharts";

const SPEED_METRICS = new Set([
  "tokens_per_second",
  "total_latency_s",
  "load_latency_s",
  "prompt_tokens",
  "output_tokens",
]);

function formatScore(value?: number) {
  if (value === undefined || value === null || Number.isNaN(value)) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

function formatDuration(seconds?: number) {
  if (seconds === undefined || seconds === null || Number.isNaN(seconds)) return "—";
  const total = Math.max(0, Math.round(seconds));
  const hrs = Math.floor(total / 3600);
  const mins = Math.floor((total % 3600) / 60);
  const secs = total % 60;
  if (hrs > 0) return `${hrs}h ${mins}m`;
  if (mins > 0) return `${mins}m ${secs}s`;
  return `${secs}s`;
}

export default function ModelDetails() {
  const params = useParams<{ id: string }>();
  const modelId = Number(params.id ?? 0);
  const [, navigate] = useLocation();

  const { data: models = [] } = useModels();
  const { data: runs = [] } = useEvalRuns();
  const { data: results = [] } = useAllEvalResults();
  const { data: leaderboard = [] } = useArenaLeaderboard();
  const { data: datasets = [] } = useDatasets();

  const model = (models as any[]).find((m) => m.id === modelId);
  const datasetMap = useMemo(() => Object.fromEntries((datasets as any[]).map((d) => [d.id, d])), [datasets]);

  const modelRuns = useMemo(() => {
    return (runs as any[])
      .filter((r) => (r.configJson?.modelIds ?? []).includes(modelId))
      .sort((a, b) => new Date(b.timestamp ?? 0).getTime() - new Date(a.timestamp ?? 0).getTime());
  }, [runs, modelId]);

  const modelResults = useMemo(() => {
    return (results as any[]).filter((r) => r.modelId === modelId);
  }, [results, modelId]);

  const qualityResults = useMemo(() => {
    return modelResults.filter((r) => !r.error && !SPEED_METRICS.has(r.metricName));
  }, [modelResults]);

  const avgScore = useMemo(() => {
    if (!qualityResults.length) return null;
    return qualityResults.reduce((sum, r) => sum + Number(r.score), 0) / qualityResults.length;
  }, [qualityResults]);

  const bestScore = useMemo(() => {
    if (!qualityResults.length) return null;
    return Math.max(...qualityResults.map((r) => Number(r.score)));
  }, [qualityResults]);

  const avgTps = useMemo(() => {
    const tps = modelResults.filter((r) => !r.error && r.metricName === "tokens_per_second");
    if (!tps.length) return null;
    return tps.reduce((sum, r) => sum + Number(r.score), 0) / tps.length;
  }, [modelResults]);

  const avgLatency = useMemo(() => {
    const latency = modelResults.filter((r) => !r.error && r.metricName === "total_latency_s");
    if (!latency.length) return null;
    return latency.reduce((sum, r) => sum + Number(r.score), 0) / latency.length;
  }, [modelResults]);

  const recentOutput = useMemo(() => {
    return modelResults.find((r) => !r.error && r.rawOutput)?.rawOutput ?? null;
  }, [modelResults]);

  const taskSet = useMemo(() => {
    const tasks = new Set<string>();
    modelRuns.forEach((r) => {
      if (r.configJson?.taskType) tasks.add(r.configJson.taskType);
    });
    return Array.from(tasks);
  }, [modelRuns]);

  const elo = useMemo(() => {
    const entry = (leaderboard as any[]).find((l) => l.model?.id === modelId);
    return entry?.rating?.rating ?? null;
  }, [leaderboard, modelId]);

  const radarData = useMemo(() => {
    const scores = {
      Knowledge: [] as number[],
      Reasoning: [] as number[],
      Code: [] as number[],
      Summary: [] as number[],
      Translate: [] as number[],
    };

    modelResults.filter((r) => !r.error).forEach((r) => {
      const run = (runs as any[]).find((run) => run.id === r.runId);
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

    const getAvg = (arr: number[]) => (arr.length > 0 ? arr.reduce((a, b) => a + b, 0) / arr.length : 0);

    return [
      { subject: "Knowledge", score: getAvg(scores.Knowledge) * 100 },
      { subject: "Reasoning", score: getAvg(scores.Reasoning) * 100 },
      { subject: "Code", score: getAvg(scores.Code) * 100 },
      { subject: "Summary", score: getAvg(scores.Summary) * 100 },
      { subject: "Translate", score: getAvg(scores.Translate) * 100 },
    ];
  }, [modelResults, runs]);

  if (!model) {
    return (
      <div className="max-w-4xl mx-auto text-center py-20 text-muted-foreground">
        Model not found. <Link href="/models" className="text-primary underline">Back to Models</Link>
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-6xl mx-auto">
      <div className="flex items-start justify-between gap-4">
        <div>
          <Link href="/models">
            <Button variant="ghost" size="sm" className="mb-3 gap-2">
              <ArrowLeft className="w-4 h-4" /> Back to Models
            </Button>
          </Link>
          <div className="flex items-center gap-3">
            <div className="h-12 w-12 rounded-xl bg-gradient-to-br from-violet-500 to-violet-400 text-white flex items-center justify-center">
              <Cpu className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-2xl font-extrabold">{model.name}</h1>
              <div className="text-sm text-muted-foreground">{model.family ?? "Local model"}</div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2 mt-3">
            {model.params && <Badge variant="secondary">{model.params}</Badge>}
            {model.quantization && <Badge variant="secondary">{model.quantization}</Badge>}
            {model.sizeGb && <Badge variant="secondary">{model.sizeGb} GB</Badge>}
            {elo && <Badge variant="outline">ELO {elo}</Badge>}
          </div>
        </div>
        <div className="flex gap-2">
          <Link href="/evaluate">
            <Button className="gap-2">Run Eval</Button>
          </Link>
          <Link href="/arena">
            <Button variant="outline" className="gap-2">Open Arena</Button>
          </Link>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {[
          { label: "Total Runs", value: modelRuns.length, icon: Activity, tone: "bg-amber-100 text-amber-600" },
          { label: "Avg Score", value: avgScore !== null ? formatScore(avgScore) : "—", icon: BarChart3, tone: "bg-emerald-100 text-emerald-600" },
          { label: "Best Score", value: bestScore !== null ? formatScore(bestScore) : "—", icon: CheckCircle2, tone: "bg-violet-100 text-violet-600" },
          { label: "Avg Speed", value: avgTps !== null ? `${avgTps.toFixed(1)} t/s` : "—", icon: Clock, tone: "bg-sky-100 text-sky-600" },
        ].map((stat) => {
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

      <div className="grid grid-cols-1 lg:grid-cols-[1.2fr_0.8fr] gap-4">
        <Card className="p-0 overflow-hidden">
          <CardHeader className="border-b border-border">
            <CardTitle className="text-base">Evaluation History</CardTitle>
            <div className="text-xs text-muted-foreground">Latest runs for this model</div>
          </CardHeader>
          <CardContent className="p-0 overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-[11px] uppercase tracking-wider text-muted-foreground border-b border-border bg-muted">
                  <th className="text-left px-5 py-3">Run</th>
                  <th className="text-left px-5 py-3">Task</th>
                  <th className="text-left px-5 py-3">Dataset</th>
                  <th className="text-left px-5 py-3">Status</th>
                  <th className="text-left px-5 py-3">Duration</th>
                  <th className="text-left px-5 py-3">When</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {modelRuns.slice(0, 8).map((run) => {
                  const datasetName = run.configJson?.datasetId ? datasetMap[run.configJson.datasetId]?.name : "None";
                  return (
                    <tr
                      key={run.id}
                      className="hover:bg-muted/50 cursor-pointer"
                      onClick={() => navigate(`/evaluate/${run.id}`)}
                    >
                      <td className="px-5 py-3 font-mono text-primary">#{run.id}</td>
                      <td className="px-5 py-3 capitalize">{run.configJson?.taskType ?? "-"}</td>
                      <td className="px-5 py-3 text-muted-foreground">{datasetName}</td>
                      <td className="px-5 py-3">
                        <span className={clsx(
                          "text-[11px] font-semibold px-2 py-1 rounded-full",
                          run.status === "completed" ? "bg-emerald-100 text-emerald-700" :
                          run.status === "running" || run.status === "pending" || run.status === "cancel_requested" ? "bg-amber-100 text-amber-700" :
                          run.status === "cancelled" ? "bg-slate-200 text-slate-700" :
                          run.status === "failed" ? "bg-rose-100 text-rose-700" :
                          "bg-muted text-muted-foreground"
                        )}>
                          {run.status}
                        </span>
                      </td>
                      <td className="px-5 py-3 font-mono text-xs text-muted-foreground">
                        {formatDuration(run.configJson?.durationSeconds)}
                      </td>
                      <td className="px-5 py-3 text-muted-foreground">
                        {run.timestamp ? format(new Date(run.timestamp), "MMM d, yyyy") : "Unknown"}
                      </td>
                    </tr>
                  );
                })}
                {modelRuns.length === 0 && (
                  <tr>
                    <td colSpan={6} className="px-5 py-8 text-center text-muted-foreground">
                      No runs yet for this model.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <div className="space-y-4">
          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Capability Signature</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="h-48 w-full -ml-3">
                <ResponsiveContainer width="100%" height="100%">
                  <RadarChart cx="50%" cy="50%" outerRadius="70%" data={radarData}>
                    <PolarGrid stroke="#e2e8f0" />
                    <PolarAngleAxis dataKey="subject" tick={{ fill: "#64748b", fontSize: 10, fontWeight: 600 }} />
                    <PolarRadiusAxis angle={30} domain={[0, 100]} tick={false} stroke="#e2e8f0" />
                    <Radar
                      name={model.name}
                      dataKey="score"
                      stroke="#8b5cf6"
                      fill="#8b5cf6"
                      fillOpacity={0.4}
                    />
                    <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8, borderColor: "#e2e8f0" }} />
                  </RadarChart>
                </ResponsiveContainer>
              </div>
              <div className="flex items-center justify-between text-sm pt-2 border-t border-border">
                <span className="text-muted-foreground">Tasks Evaluated</span>
                <span className="font-semibold">{taskSet.length || 0}</span>
              </div>
              <div className="flex items-center justify-between text-sm">
                <span className="text-muted-foreground">Avg Latency</span>
                <span className="font-semibold">{avgLatency !== null ? `${avgLatency.toFixed(2)}s` : "—"}</span>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="pb-2">
              <CardTitle className="text-base">Recent Output Sample</CardTitle>
            </CardHeader>
            <CardContent>
              {recentOutput ? (
                <div className="bg-muted border border-border rounded-lg p-3 text-xs text-muted-foreground whitespace-pre-wrap max-h-[220px] overflow-y-auto">
                  {recentOutput}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">No output samples yet.</div>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
