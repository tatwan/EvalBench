import { useArenaLeaderboard } from "@/hooks/use-arena";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/Badge";
import { Trophy, Medal, Swords, Target } from "lucide-react";

export default function ArenaLeaderboard() {
  const { data: leaderboard = [], isLoading } = useArenaLeaderboard();

  return (
    <div className="max-w-5xl mx-auto space-y-6">
      <div>
        <h1 className="text-2xl font-extrabold flex items-center gap-2">
          <Trophy className="w-6 h-6 text-amber-500" />
          Arena Leaderboard
        </h1>
        <p className="text-sm text-muted-foreground">ELO rankings from blind pairwise comparisons.</p>
      </div>

      <Card className="overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-muted border-b border-border text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="p-4 font-semibold text-center w-20">Rank</th>
                <th className="p-4 font-semibold">Model</th>
                <th className="p-4 font-semibold text-right">ELO Rating</th>
                <th className="p-4 font-semibold text-center">Matches</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                <tr>
                  <td colSpan={4} className="p-12 text-center">
                    <div className="inline-block animate-spin rounded-full h-8 w-8 border-b-2 border-amber-500"></div>
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
                  <tr key={entry.model.id} className="hover:bg-muted/40 transition-colors">
                    <td className="p-4 text-center font-bold font-mono text-lg">
                      {index === 0 ? <Medal className="w-6 h-6 text-amber-500 mx-auto" /> :
                       index === 1 ? <Medal className="w-6 h-6 text-slate-400 mx-auto" /> :
                       index === 2 ? <Medal className="w-6 h-6 text-amber-700 mx-auto" /> :
                       <span className="text-muted-foreground">#{index + 1}</span>}
                    </td>
                    <td className="p-4">
                      <div className="flex flex-col">
                        <span className="font-bold text-base tracking-tight text-foreground">
                          {entry.model.name}
                        </span>
                        <div className="flex gap-2 mt-1">
                          {entry.model.params && <Badge variant="outline" className="text-[10px] py-0">{entry.model.params}</Badge>}
                          {entry.model.quantization && <Badge variant="secondary" className="text-[10px] py-0">{entry.model.quantization}</Badge>}
                        </div>
                      </div>
                    </td>
                    <td className="p-4 text-right">
                      <div className="inline-flex items-center justify-end gap-2 text-lg font-bold font-mono text-amber-600">
                        <Target className="w-4 h-4 text-amber-500" />
                        {entry.rating.rating}
                      </div>
                    </td>
                    <td className="p-4 text-center">
                      <div className="inline-flex items-center gap-1.5 text-muted-foreground font-mono bg-muted px-3 py-1 rounded-full border border-border">
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
