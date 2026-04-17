import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import { z } from "zod";
import { useToast } from "@/hooks/use-toast";

export function useEvalRuns() {
  return useQuery({
    queryKey: [api.evalRuns.list.path],
    queryFn: async () => {
      const res = await fetch(api.evalRuns.list.path, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch eval runs");
      return api.evalRuns.list.responses[200].parse(await res.json());
    },
  });
}

export function useEvalRun(id: number) {
  return useQuery({
    queryKey: [api.evalRuns.get.path, id],
    queryFn: async () => {
      const url = buildUrl(api.evalRuns.get.path, { id });
      const res = await fetch(url, { credentials: "include" });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error("Failed to fetch run");
      return api.evalRuns.get.responses[200].parse(await res.json());
    },
    enabled: !!id,
    staleTime: 0,
    refetchOnMount: "always",
  });
}

export function useEvalResults(runId: number) {
  return useQuery({
    queryKey: [api.evalRuns.results.path, runId],
    queryFn: async () => {
      const url = buildUrl(api.evalRuns.results.path, { id: runId });
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch results");
      return api.evalRuns.results.responses[200].parse(await res.json());
    },
    enabled: !!runId,
    staleTime: 0,
    refetchOnMount: "always",
  });
}

export function useEvalStats(runId: number) {
  return useQuery({
    queryKey: [api.evalRuns.stats.path, runId],
    queryFn: async () => {
      const url = buildUrl(api.evalRuns.stats.path, { id: runId });
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch stats");
      return api.evalRuns.stats.responses[200].parse(await res.json());
    },
    enabled: !!runId,
    staleTime: 0,
    refetchOnMount: "always",
  });
}

export function useAllEvalResults() {
  return useQuery({
    queryKey: [api.evalResults.list.path],
    queryFn: async () => {
      const res = await fetch(api.evalResults.list.path, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch eval results");
      return api.evalResults.list.responses[200].parse(await res.json());
    },
  });
}


export function useCreateEvalRun() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (data: z.infer<typeof api.evalRuns.create.input>) => {
      const res = await fetch(api.evalRuns.create.path, {
        method: api.evalRuns.create.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to start evaluation");
      return api.evalRuns.create.responses[201].parse(await res.json());
    },
    onSuccess: (run) => {
      queryClient.setQueryData([api.evalRuns.list.path], (existing: unknown) => {
        const current = Array.isArray(existing) ? existing as Array<Record<string, unknown>> : [];
        const withoutNewRun = current.filter((item) => item.id !== run.id);
        return [run, ...withoutNewRun];
      });
      queryClient.invalidateQueries({ queryKey: [api.evalRuns.list.path] });
      queryClient.refetchQueries({ queryKey: [api.evalRuns.list.path], type: "active" });
      queryClient.invalidateQueries({ queryKey: [api.evalRuns.get.path, run.id] });
      queryClient.invalidateQueries({ queryKey: [api.evalRuns.results.path, run.id] });
      queryClient.invalidateQueries({ queryKey: [api.evalRuns.stats.path, run.id] });
      queryClient.invalidateQueries({ queryKey: [api.evalResults.list.path] });
      toast({
        title: "Evaluation Started",
        description: "Your models are now being benchmarked.",
      });
    },
  });
}

export function useCancelEvalRun() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (runId: number) => {
      const url = buildUrl(api.evalRuns.cancel.path, { id: runId });
      const res = await fetch(url, {
        method: api.evalRuns.cancel.method,
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to cancel evaluation");
      return api.evalRuns.cancel.responses[200].parse(await res.json());
    },
    onSuccess: (run) => {
      queryClient.invalidateQueries({ queryKey: [api.evalRuns.list.path] });
      queryClient.invalidateQueries({ queryKey: [api.evalRuns.get.path, run.id] });
      queryClient.invalidateQueries({ queryKey: [api.evalRuns.results.path, run.id] });
      queryClient.invalidateQueries({ queryKey: [api.evalRuns.stats.path, run.id] });
      toast({
        title: "Cancellation requested",
        description: "The run will stop after the in-flight work finishes.",
      });
    },
  });
}
