import { useArenaMatchup, useArenaVote } from "@/hooks/use-arena";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Swords, RefreshCw, Trophy, Skull } from "lucide-react";
import { clsx } from "clsx";
import { useState } from "react";

export default function Arena() {
  const { data: matchup, isLoading, refetch, isRefetching } = useArenaMatchup();
  const voteMutation = useArenaVote();
  const [votedFor, setVotedFor] = useState<'model_a' | 'model_b' | 'tie' | null>(null);

  const handleVote = (winner: 'model_a' | 'model_b' | 'tie') => {
    if (!matchup) return;
    setVotedFor(winner);
    voteMutation.mutate({
      modelAId: matchup.modelA.id,
      modelBId: matchup.modelB.id,
      prompt: matchup.prompt,
      winner
    }, {
      onSettled: () => setVotedFor(null)
    });
  };

  if (isLoading || isRefetching) {
    return (
      <div className="flex flex-col items-center justify-center h-[80vh] space-y-4">
        <Swords className="w-16 h-16 text-primary animate-bounce" />
        <h2 className="text-xl font-bold animate-pulse text-gradient">Preparing next battle...</h2>
      </div>
    );
  }

  if (!matchup) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] text-center max-w-md mx-auto space-y-6">
        <div className="w-20 h-20 bg-white/5 rounded-full flex items-center justify-center ring-1 ring-white/10">
          <Skull className="w-10 h-10 text-muted-foreground" />
        </div>
        <h2 className="text-2xl font-bold">Not Enough Contenders</h2>
        <p className="text-muted-foreground">
          The arena requires at least two discovered models to begin pairwise evaluation.
        </p>
        <Button onClick={() => window.location.href = '/models'}>Discover Models</Button>
      </div>
    );
  }

  return (
    <div className="space-y-6 h-[calc(100vh-6rem)] flex flex-col">
      <div className="flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-gradient-to-br from-orange-500 to-red-600 rounded-lg shadow-lg shadow-red-500/20">
            <Swords className="w-6 h-6 text-white" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Arena</h1>
            <p className="text-sm text-muted-foreground">Blind side-by-side evaluation</p>
          </div>
        </div>
        <div className="flex gap-3">
           <Button variant="outline" onClick={() => window.location.href = '/leaderboard'} className="gap-2">
            <Trophy className="w-4 h-4 text-yellow-500" /> Leaderboard
          </Button>
          <Button variant="ghost" onClick={() => refetch()} className="gap-2" size="icon">
            <RefreshCw className="w-5 h-5" />
          </Button>
        </div>
      </div>

      {/* The Prompt */}
      <Card className="flex-shrink-0 bg-gradient-to-br from-indigo-950/40 to-slate-900/80 border-indigo-500/20">
        <div className="p-6">
          <h3 className="text-xs font-bold uppercase tracking-widest text-indigo-400 mb-3">User Prompt</h3>
          <p className="text-lg font-medium leading-relaxed font-sans">{matchup.prompt}</p>
        </div>
      </Card>

      {/* The Responses */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 flex-1 min-h-0">
        {/* Model A */}
        <Card className="flex flex-col h-full bg-white/[0.02] border-white/10 overflow-hidden relative group">
          <div className="p-4 border-b border-white/5 bg-black/20 flex justify-between items-center">
            <span className="font-mono font-bold text-muted-foreground">Model A</span>
            {votedFor && <span className="text-xs text-primary font-bold">{matchup.modelA.name}</span>}
          </div>
          <div className="p-6 flex-1 overflow-y-auto font-mono text-sm leading-relaxed whitespace-pre-wrap text-slate-300">
            {matchup.outputA}
          </div>
          <div className="p-4 bg-black/40 border-t border-white/5 mt-auto">
            <Button 
              className="w-full text-lg h-14" 
              onClick={() => handleVote('model_a')}
              disabled={!!votedFor}
              variant={votedFor === 'model_a' ? 'primary' : 'glass'}
            >
              👈 Winner A
            </Button>
          </div>
        </Card>

        {/* Model B */}
        <Card className="flex flex-col h-full bg-white/[0.02] border-white/10 overflow-hidden relative group">
           <div className="p-4 border-b border-white/5 bg-black/20 flex justify-between items-center">
            <span className="font-mono font-bold text-muted-foreground">Model B</span>
            {votedFor && <span className="text-xs text-primary font-bold">{matchup.modelB.name}</span>}
          </div>
          <div className="p-6 flex-1 overflow-y-auto font-mono text-sm leading-relaxed whitespace-pre-wrap text-slate-300">
            {matchup.outputB}
          </div>
          <div className="p-4 bg-black/40 border-t border-white/5 mt-auto">
             <Button 
              className="w-full text-lg h-14" 
              onClick={() => handleVote('model_b')}
              disabled={!!votedFor}
              variant={votedFor === 'model_b' ? 'primary' : 'glass'}
            >
              Winner B 👉
            </Button>
          </div>
        </Card>
      </div>

      <div className="flex justify-center flex-shrink-0 pt-2">
        <Button 
          variant="outline" 
          size="lg" 
          className="w-48 border-dashed border-2 hover:bg-white/5"
          onClick={() => handleVote('tie')}
          disabled={!!votedFor}
        >
          🤝 It's a Tie
        </Button>
      </div>
    </div>
  );
}
