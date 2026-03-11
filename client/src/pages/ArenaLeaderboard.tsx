import { useArenaLeaderboard } from "@/hooks/use-arena";
import { Card, CardContent } from "@/components/ui/Card";
import { Badge } from "@/components/ui/Badge";
import { Trophy, Medal, Swords, Target } from "lucide-react";
import { clsx } from "clsx";

export default function ArenaLeaderboard() {
  const { data: leaderboard = [], isLoading } = useArenaLeaderboard();

  return (
    <div className="max-w-5xl mx-auto space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold text-gradient flex items-center gap-3">
            <Trophy className="w-8 h-8 text-yellow-500" />
            Arena Elo Leaderboard
          </h1>
          <p className="text-muted-foreground mt-2">Rankings based on pairwise blind battles.</p>
        </div>
      </div>

      <Card className="overflow-hidden border-yellow-500/20 shadow-[0_0_30px_rgba(234,179,8,0.05)]">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-black/40 border-b border-white/10 text-xs uppercase tracking-wider text-muted-foreground font-mono">
                <th className="p-4 font-semibold text-center w-24">Rank</th>
                <th className="p-4 font-semibold">Model</th>
                <th className="p-4 font-semibold text-right">Elo Rating</th>
                <th className="p-4 font-semibold text-center">Matches</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {isLoading ? (
                <tr>
                  <td colSpan={4} className="p-12 text-center">
                    <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-yellow-500"></div>
                  </td>
                </tr>
              ) : leaderboard.length === 0 ? (
                <tr>
                  <td colSpan={4} className="p-12 text-center text-muted-foreground">
                    No battles fought yet. Go to the Arena to start ranking models!
                  </td>
                </tr>
              ) : (
                leaderboard.map((entry, index) => (
                  <tr key={entry.model.id} className="hover:bg-white/[0.02] transition-colors">
                    <td className="p-4 text-center font-bold font-mono text-lg">
                      {index === 0 ? <Medal className="w-6 h-6 text-yellow-500 mx-auto" /> :
                       index === 1 ? <Medal className="w-6 h-6 text-slate-300 mx-auto" /> :
                       index === 2 ? <Medal className="w-6 h-6 text-amber-700 mx-auto" /> :
                       <span className="text-muted-foreground">#{index + 1}</span>}
                    </td>
                    <td className="p-4">
                      <div className="flex flex-col">
                        <span className={clsx("font-bold text-lg tracking-tight", index < 3 ? "text-white" : "text-slate-300")}>
                          {entry.model.name}
                        </span>
                        <div className="flex gap-2 mt-1">
                          {entry.model.params && <Badge variant="outline" className="text-[10px] py-0 border-white/10">{entry.model.params}</Badge>}
                          {entry.model.quantization && <Badge variant="secondary" className="text-[10px] py-0 bg-white/5">{entry.model.quantization}</Badge>}
                        </div>
                      </div>
                    </td>
                    <td className="p-4 text-right">
                      <div className="inline-flex items-center justify-end gap-2 text-xl font-bold font-mono text-transparent bg-clip-text bg-gradient-to-r from-yellow-400 to-yellow-600">
                        <Target className="w-4 h-4 text-yellow-500" />
                        {entry.rating.rating}
                      </div>
                    </td>
                    <td className="p-4 text-center">
                      <div className="inline-flex items-center gap-1.5 text-muted-foreground font-mono bg-black/20 px-3 py-1 rounded-full border border-white/5">
                        <Swords className="w-3.5 h-3.5" />
                        {entry.rating.gamesPlayed}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
