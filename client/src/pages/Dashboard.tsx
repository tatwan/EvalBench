import { useModels } from "@/hooks/use-models";
import { useEvalRuns, useAllEvalResults } from "@/hooks/use-eval";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { Activity, Cpu, Clock, CheckCircle2 } from "lucide-react";
import { format } from "date-fns";
import { Badge } from "@/components/ui/Badge";
import { Link } from "wouter";
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';

export default function Dashboard() {
  const { data: models = [], isLoading: modelsLoading } = useModels();
  const { data: runs = [], isLoading: runsLoading } = useEvalRuns();
  const { data: results = [], isLoading: resultsLoading } = useAllEvalResults();

  // Calculate Leaderboard Data
  const leaderboard = models.map(model => {
    const modelResults = results.filter(r => r.modelId === model.id);
    const avgScore = modelResults.length > 0 
      ? modelResults.reduce((sum, r) => sum + Number(r.score), 0) / modelResults.length 
      : 0;
    
    return {
      ...model,
      avgScore: avgScore,
      evalsCount: modelResults.length
    };
  }).sort((a, b) => b.avgScore - a.avgScore).slice(0, 5);

  const stats = [
    { label: "Local Models", value: models.length, icon: Cpu, color: "text-sky-400" },
    { label: "Total Eval Runs", value: runs.length, icon: Activity, color: "text-emerald-400" },
    { label: "Metrics Collected", value: results.length, icon: CheckCircle2, color: "text-purple-400" },
    { label: "Pending Runs", value: runs.filter(r => r.status === 'pending').length, icon: Clock, color: "text-amber-400" },
  ];

  if (modelsLoading || runsLoading || resultsLoading) {
    return <div className="flex items-center justify-center h-64"><div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary"></div></div>;
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-gradient">Dashboard</h1>
        <p className="text-muted-foreground mt-2">Overview of your local evaluation environment.</p>
      </div>

      {/* Stats Grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
        {stats.map((stat, i) => {
          const Icon = stat.icon;
          return (
            <Card key={i} className="bg-gradient-to-br from-card to-card/50">
              <CardContent className="p-6 flex items-center gap-4">
                <div className={`p-3 rounded-xl bg-white/5 ring-1 ring-white/10 ${stat.color}`}>
                  <Icon className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-sm font-medium text-muted-foreground">{stat.label}</p>
                  <p className="text-3xl font-bold font-mono tracking-tight mt-1">{stat.value}</p>
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* Top Models Chart */}
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>Top Models Performance</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-[300px] w-full">
              {leaderboard.length > 0 ? (
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={leaderboard} margin={{ top: 20, right: 30, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                    <XAxis dataKey="name" stroke="rgba(255,255,255,0.5)" fontSize={12} tickLine={false} axisLine={false} />
                    <YAxis stroke="rgba(255,255,255,0.5)" fontSize={12} tickLine={false} axisLine={false} domain={[0, 100]} />
                    <Tooltip 
                      cursor={{fill: 'rgba(255,255,255,0.05)'}}
                      contentStyle={{ backgroundColor: 'rgba(15, 23, 42, 0.9)', borderColor: 'rgba(255,255,255,0.1)', borderRadius: '8px' }}
                      itemStyle={{ color: '#38bdf8' }}
                    />
                    <Bar dataKey="avgScore" fill="#0ea5e9" radius={[4, 4, 0, 0]} maxBarSize={60} />
                  </BarChart>
                </ResponsiveContainer>
              ) : (
                <div className="h-full flex items-center justify-center text-muted-foreground border border-dashed border-white/10 rounded-xl">
                  No evaluation data available yet
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* Recent Runs */}
        <Card>
          <CardHeader>
            <CardTitle>Recent Runs</CardTitle>
          </CardHeader>
          <div className="divide-y divide-white/5">
            {runs.slice(0, 5).map(run => (
              <div key={run.id} className="p-4 hover:bg-white/5 transition-colors group flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Activity className="w-4 h-4 text-primary" />
                    <span className="font-mono text-sm">Run #{run.id}</span>
                  </div>
                  <Badge variant={run.status === 'completed' ? 'success' : run.status === 'pending' ? 'warning' : 'default'}>
                    {run.status}
                  </Badge>
                </div>
                <div className="text-xs text-muted-foreground flex justify-between items-center">
                  <span>{run.timestamp ? format(new Date(run.timestamp), 'MMM d, h:mm a') : 'Unknown'}</span>
                  <Link href={`/evaluate`} className="text-primary opacity-0 group-hover:opacity-100 transition-opacity hover:underline">
                    View Details
                  </Link>
                </div>
              </div>
            ))}
            {runs.length === 0 && (
              <div className="p-8 text-center text-muted-foreground text-sm">
                No runs yet. Start one from the Eval Wizard.
              </div>
            )}
          </div>
        </Card>
      </div>
    </div>
  );
}
