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
      return res.json() as Promise<{ running: boolean; modelCount: number; error?: string }>;
    },
    refetchInterval: 10_000,
    staleTime: 8_000,
  });
}
