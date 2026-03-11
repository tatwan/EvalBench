import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@shared/routes";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";

export function useArenaMatchup() {
  return useQuery({
    queryKey: [api.arena.getMatchup.path],
    queryFn: async () => {
      const res = await fetch(api.arena.getMatchup.path, { credentials: "include" });
      if (!res.ok) {
        if (res.status === 404) return null; // Not enough models
        throw new Error("Failed to fetch matchup");
      }
      return api.arena.getMatchup.responses[200].parse(await res.json());
    },
    refetchOnWindowFocus: false,
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
      return api.arena.vote.responses[201].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.arena.getMatchup.path] });
      queryClient.invalidateQueries({ queryKey: [api.arena.leaderboard.path] });
      toast({
        title: "Vote recorded",
        description: "Fetching next matchup...",
        duration: 2000,
      });
    },
  });
}
