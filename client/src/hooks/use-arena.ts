import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@shared/routes";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";

export function useArenaMatchup(
  prompt?: string,
  enabled = true,
  modelAId?: number | null,
  modelBId?: number | null,
) {
  const params = new URLSearchParams();
  if (prompt) params.set("prompt", prompt);
  if (modelAId) params.set("model_a_id", String(modelAId));
  if (modelBId) params.set("model_b_id", String(modelBId));
  const query = params.toString();
  const url = query
    ? `${api.arena.getMatchup.path}?${query}`
    : api.arena.getMatchup.path;

  return useQuery({
    queryKey: [api.arena.getMatchup.path, prompt ?? "", modelAId ?? null, modelBId ?? null],
    queryFn: async () => {
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) {
        if (res.status === 400 || res.status === 404) return null; // Not enough models
        throw new Error("Failed to fetch matchup");
      }
      return api.arena.getMatchup.responses[200].parse(await res.json());
    },
    refetchOnWindowFocus: false,
    enabled,
  });
}

export function useArenaLeaderboard() {
  return useQuery({
    queryKey: [api.arena.leaderboard.path],
    queryFn: async () => {
      const res = await fetch(api.arena.leaderboard.path, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch leaderboard");
      return api.arena.leaderboard.responses[200].parse(await res.json());
    },
  });
}

export function useArenaVote() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: z.infer<typeof api.arena.vote.input>) => {
      const res = await fetch(api.arena.vote.path, {
        method: api.arena.vote.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to submit vote");
      return api.arena.vote.responses[200].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.arena.leaderboard.path] });
      toast({
        title: "Vote recorded",
        description: "Arena ratings updated. Reveal the matchup and start the next battle when you're ready.",
        duration: 2000,
      });
    },
  });
}
