import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { api } from "@shared/routes";
import { apiRequest } from "@/lib/queryClient";
import { buildUrl } from "@shared/routes";
import { useToast } from "@/hooks/use-toast";

type DatasetDraftItem = {
  input: string;
  expectedOutput: string;
  context?: string;
  tags?: unknown;
  difficulty?: string;
};

type CreateDatasetPayload = {
  name: string;
  source?: string;
  items: DatasetDraftItem[];
};

type ImportDatasetPayload = {
  name: string;
  source?: string;
  format: "json" | "csv";
  content: string;
};

export function useDatasets() {
  return useQuery({
    queryKey: [api.datasets.list.path],
    queryFn: async () => {
      const res = await fetch(api.datasets.list.path, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch datasets");
      return api.datasets.list.responses[200].parse(await res.json());
    },
  });
}

export function useDataset(datasetId: number | null) {
  return useQuery({
    queryKey: [api.datasets.get.path, datasetId],
    queryFn: async () => {
      const url = buildUrl(api.datasets.get.path, { id: datasetId! });
      const res = await fetch(url, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch dataset");
      return api.datasets.get.responses[200].parse(await res.json());
    },
    enabled: typeof datasetId === "number" && datasetId > 0,
  });
}

export function useCreateDataset() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (payload: CreateDatasetPayload) => {
      const res = await apiRequest(api.datasets.create.method, api.datasets.create.path, payload);
      return api.datasets.create.responses[201].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.datasets.list.path] });
      toast({
        title: "Dataset created",
        description: "Your new dataset is ready to use in Eval Wizard.",
      });
    },
  });
}

export function usePreviewDatasetImport() {
  return useMutation({
    mutationFn: async (payload: ImportDatasetPayload) => {
      const res = await apiRequest(api.datasets.importPreview.method, api.datasets.importPreview.path, payload);
      return api.datasets.importPreview.responses[200].parse(await res.json());
    },
  });
}

export function useImportDataset() {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  return useMutation({
    mutationFn: async (payload: ImportDatasetPayload) => {
      const res = await apiRequest(api.datasets.import.method, api.datasets.import.path, payload);
      return api.datasets.import.responses[201].parse(await res.json());
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.datasets.list.path] });
      toast({
        title: "Dataset imported",
        description: "Your imported dataset is now available for evaluation.",
      });
    },
  });
}
