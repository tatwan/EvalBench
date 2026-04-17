import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api } from "@shared/routes";
import { useToast } from "@/hooks/use-toast";

export function useModels() {
  return useQuery({
    queryKey: [api.models.list.path],
    queryFn: async () => {
      const res = await fetch(api.models.list.path, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch models");
      return api.models.list.responses[200].parse(await res.json());
    },
  });
}

export function useDiscoverModels() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async () => {
      const res = await fetch(api.models.discover.path, {
        method: api.models.discover.method,
        credentials: "include",
      });
      if (!res.ok) throw new Error("Failed to discover models");
      return api.models.discover.responses[200].parse(await res.json());
    },
    onSuccess: (data) => {
      queryClient.setQueryData([api.models.list.path], data);
      queryClient.invalidateQueries({ queryKey: [api.ollama.status.path] });
      toast({
        title: "Models Discovered",
        description: `Found ${data.length} local models ready for evaluation.`,
      });
    },
    onError: () => {
      toast({
        title: "Discovery Failed",
        description: "Could not connect to local Ollama instance.",
        variant: "destructive",
      });
    },
  });
}

export function useOllamaStatus() {
  return useQuery({
    queryKey: [api.ollama.status.path],
    queryFn: async () => {
      const res = await fetch(api.ollama.status.path, { credentials: "include" });
      if (!res.ok) return { running: false, modelCount: 0 };
      const payload = await res.json().catch(() => null) as
        | { running?: boolean; modelCount?: number; model_count?: number; error?: string }
        | null;
      return {
        running: Boolean(payload?.running),
        modelCount: Number(payload?.modelCount ?? payload?.model_count ?? 0),
        error: payload?.error,
      };
    },
    refetchInterval: 10_000,
    staleTime: 8_000,
  });
}

export function useStartOllama() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async () => {
      const res = await fetch(api.ollama.start.path, {
        method: api.ollama.start.method,
        credentials: "include",
      });
      const payload = await res.json().catch(() => null);
      if (!res.ok) {
        throw new Error(payload?.detail || payload?.message || "Failed to start Ollama");
      }
      return api.ollama.start.responses[200].parse(payload);
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: [api.ollama.status.path] });
      queryClient.invalidateQueries({ queryKey: [api.models.list.path] });
      toast({
        title: data.running ? "Ollama starting up" : "Ollama still offline",
        description: data.message,
        variant: data.running ? "default" : "destructive",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Couldn't start Ollama",
        description: error.message,
        variant: "destructive",
      });
    },
  });
}
