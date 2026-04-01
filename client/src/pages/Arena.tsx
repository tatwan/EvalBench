import { useArenaMatchup, useArenaVote } from "@/hooks/use-arena";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/input";
import { Swords, RefreshCw, Trophy, Skull, ThumbsUp, Scale, Pencil, Play } from "lucide-react";
import { clsx } from "clsx";
import { useState } from "react";
import { useLocation } from "wouter";

export default function Arena() {
  const [customPrompt, setCustomPrompt] = useState("");
  const [submittedPrompt, setSubmittedPrompt] = useState<string | undefined>(undefined);
  const [hasStarted, setHasStarted] = useState(false);
  const { data: matchup, isLoading, refetch, isRefetching } = useArenaMatchup(submittedPrompt, hasStarted);
  const voteMutation = useArenaVote();
  const [votedFor, setVotedFor] = useState<"model_a" | "model_b" | "tie" | null>(null);
  const [revealedWinner, setRevealedWinner] = useState<"model_a" | "model_b" | "tie" | null>(null);
  const [, navigate] = useLocation();

  const handleNewBattle = () => {
    setSubmittedPrompt(customPrompt.trim() || undefined);
    setVotedFor(null);
    setRevealedWinner(null);
    if (!hasStarted) {
      setHasStarted(true);
      return;
    }
    refetch();
  };

  const handleVote = (winner: "model_a" | "model_b" | "tie") => {
    if (!matchup) return;
    setVotedFor(winner);
    voteMutation.mutate(
      {
        modelAId: matchup.modelA.id,
        modelBId: matchup.modelB.id,
        prompt: matchup.prompt,
        winner,
      },
      {
        onSuccess: () => setRevealedWinner(winner),
        onSettled: () => setVotedFor(null),
      }
    );
  };

  if (isLoading || isRefetching) {
    return (
      <div className="flex flex-col items-center justify-center h-[70vh] space-y-4">
        <Swords className="w-12 h-12 text-violet-600 animate-bounce" />
        <h2 className="text-lg font-bold text-muted-foreground">Preparing next battle...</h2>
      </div>
    );
  }

  if (!hasStarted) {
    return (
      <div className="space-y-6 max-w-3xl mx-auto">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-extrabold flex items-center gap-2">
              <Swords className="w-5 h-5 text-violet-600" />
              Arena
            </h1>
            <p className="text-sm text-muted-foreground">
              Blind pairwise evaluation. Nothing runs until you start a battle.
            </p>
          </div>
          <Button variant="outline" onClick={() => navigate("/leaderboard")} className="gap-2">
            <Trophy className="w-4 h-4 text-amber-500" /> Leaderboard
          </Button>
        </div>

        <div className="rounded-2xl border border-violet-200 bg-violet-50 p-6 space-y-4">
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-violet-600">Opt-In Arena</div>
          <h2 className="text-xl font-bold text-violet-950">Start a blind head-to-head battle when you're ready</h2>
          <p className="text-sm text-violet-900/80">
            EvalBench will fetch two model responses for a random prompt, or for the custom prompt you provide below.
            No generations begin until you explicitly start.
          </p>
          <div className="flex gap-2 items-center">
            <Pencil className="w-4 h-4 text-muted-foreground shrink-0" />
            <Input
              value={customPrompt}
              onChange={e => setCustomPrompt(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleNewBattle()}
              placeholder="Type a custom prompt, or leave blank for a random one…"
              className="bg-white text-sm"
            />
            <Button onClick={handleNewBattle} className="shrink-0 gap-2">
              <Play className="w-4 h-4" />
              Start Battle
            </Button>
          </div>
        </div>
      </div>
    );
  }

  if (!matchup) {
    return (
      <div className="flex flex-col items-center justify-center h-[60vh] text-center max-w-md mx-auto space-y-6">
        <div className="w-20 h-20 bg-muted rounded-full flex items-center justify-center border border-border">
          <Skull className="w-10 h-10 text-muted-foreground" />
        </div>
        <h2 className="text-xl font-bold">Not Enough Contenders</h2>
        <p className="text-muted-foreground">
          The arena requires at least two discovered models to begin pairwise evaluation.
        </p>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => setHasStarted(false)}>Back</Button>
          <Button onClick={() => navigate("/models")}>Discover Models</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-extrabold flex items-center gap-2">
            <Swords className="w-5 h-5 text-violet-600" />
            Arena
          </h1>
          <p className="text-sm text-muted-foreground">Blind pairwise evaluation - Vote on responses - Builds ELO ratings</p>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => navigate("/leaderboard")} className="gap-2">
            <Trophy className="w-4 h-4 text-amber-500" /> Leaderboard
          </Button>
          <Button variant="outline" size="icon" onClick={handleNewBattle}>
            <RefreshCw className="w-4 h-4" />
          </Button>
        </div>
      </div>

      <div className="rounded-xl border border-violet-200 bg-violet-50 p-4">
        <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-violet-600 mb-2">Prompt</div>
        <p className="text-sm text-violet-900/80 italic leading-relaxed">"{matchup.prompt}"</p>
        <div className="flex gap-2 mt-3 flex-wrap">
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-white text-violet-700 border border-violet-200">
            Arena Round
          </span>
          <span className="text-[10px] font-semibold px-2 py-0.5 rounded bg-white text-violet-700 border border-violet-200">
            Vote to reveal models
          </span>
        </div>
      </div>

      {/* Custom prompt input */}
      <div className="flex gap-2 items-center">
        <Pencil className="w-4 h-4 text-muted-foreground shrink-0" />
        <Input
          value={customPrompt}
          onChange={e => setCustomPrompt(e.target.value)}
          onKeyDown={e => e.key === "Enter" && handleNewBattle()}
          placeholder="Type a custom prompt, or leave blank for a random one…"
          className="bg-muted text-sm"
        />
        <Button size="sm" variant="outline" onClick={handleNewBattle} className="shrink-0">
          New Battle
        </Button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[1fr_48px_1fr] gap-4">
        <Card className="p-0 overflow-hidden border-border">
          <div className="p-4 border-b border-border flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-blue-600 text-white flex items-center justify-center text-sm font-bold">A</div>
            <div>
              <div className="text-sm font-semibold">Model A</div>
              <div className="text-xs text-muted-foreground">{revealedWinner ? matchup.modelA.name : "Hidden until you vote"}</div>
            </div>
          </div>
          <div className="p-5 text-sm leading-relaxed text-foreground whitespace-pre-wrap max-h-[420px] overflow-y-auto">
            {matchup.outputA}
          </div>
        </Card>

        <div className="hidden lg:flex items-center justify-center">
          <div className="h-full w-10 bg-muted border border-border rounded-full flex items-center justify-center text-xs font-bold text-muted-foreground">
            VS
          </div>
        </div>

        <Card className="p-0 overflow-hidden border-border">
          <div className="p-4 border-b border-border flex items-center gap-2">
            <div className="h-8 w-8 rounded-lg bg-rose-600 text-white flex items-center justify-center text-sm font-bold">B</div>
            <div>
              <div className="text-sm font-semibold">Model B</div>
              <div className="text-xs text-muted-foreground">{revealedWinner ? matchup.modelB.name : "Hidden until you vote"}</div>
            </div>
          </div>
          <div className="p-5 text-sm leading-relaxed text-foreground whitespace-pre-wrap max-h-[420px] overflow-y-auto">
            {matchup.outputB}
          </div>
        </Card>
      </div>

      {revealedWinner && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-emerald-700 mb-1">Match Revealed</div>
            <div className="text-sm font-semibold text-emerald-900">
              {revealedWinner === "tie"
                ? "You recorded this round as a tie."
                : revealedWinner === "model_a"
                  ? `You picked ${matchup.modelA.name} over ${matchup.modelB.name}.`
                  : `You picked ${matchup.modelB.name} over ${matchup.modelA.name}.`}
            </div>
            <div className="text-xs text-emerald-800/80 mt-1">
              Start the next battle when you want another blind comparison.
            </div>
          </div>
          <Button onClick={handleNewBattle} className="gap-2 shrink-0">
            <RefreshCw className="w-4 h-4" />
            Next Battle
          </Button>
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <button
          className={clsx(
            "rounded-xl border-2 px-4 py-4 text-sm font-bold flex flex-col items-center gap-1 transition-all",
            votedFor || revealedWinner ? "opacity-50 cursor-not-allowed" : "hover:-translate-y-0.5 hover:shadow-md",
            "bg-blue-50 border-blue-200 text-blue-700"
          )}
          onClick={() => handleVote("model_a")}
          disabled={!!votedFor || !!revealedWinner}
        >
          <ThumbsUp className="w-5 h-5" />
          A is Better
          <span className="text-[11px] font-medium opacity-70">More precise & structured</span>
        </button>
        <button
          className={clsx(
            "rounded-xl border-2 px-4 py-4 text-sm font-bold flex flex-col items-center gap-1 transition-all",
            votedFor || revealedWinner ? "opacity-50 cursor-not-allowed" : "hover:-translate-y-0.5 hover:shadow-md",
            "bg-muted border-border text-muted-foreground"
          )}
          onClick={() => handleVote("tie")}
          disabled={!!votedFor || !!revealedWinner}
        >
          <Scale className="w-5 h-5" />
          Tie
          <span className="text-[11px] font-medium opacity-70">Both feel equal</span>
        </button>
        <button
          className={clsx(
            "rounded-xl border-2 px-4 py-4 text-sm font-bold flex flex-col items-center gap-1 transition-all",
            votedFor || revealedWinner ? "opacity-50 cursor-not-allowed" : "hover:-translate-y-0.5 hover:shadow-md",
            "bg-rose-50 border-rose-200 text-rose-700"
          )}
          onClick={() => handleVote("model_b")}
          disabled={!!votedFor || !!revealedWinner}
        >
          <ThumbsUp className="w-5 h-5" />
          B is Better
          <span className="text-[11px] font-medium opacity-70">More intuitive & memorable</span>
        </button>
      </div>
    </div>
  );
}
