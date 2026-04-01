import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

export type Setting = {
  key: string;
  value: string | null;
};

export type SettingConnectionTarget =
  | "ollama"
  | "judge"
  | "openai"
  | "anthropic"
  | "gemini"
  | "groq"
  | "grok";

export type SettingConnectionTestPayload = {
  target: SettingConnectionTarget;
  ollamaHost?: string;
  judgeModel?: string;
  openaiApiKey?: string;
  anthropicApiKey?: string;
  geminiApiKey?: string;
  groqApiKey?: string;
  grokApiKey?: string;
};

export type SettingConnectionTestResult = {
  target: string;
  ok: boolean;
  message: string;
  details?: string | null;
};

// Fetch all settings as an array
export function useSettings() {
  return useQuery<Setting[]>({
    queryKey: ["/api/settings"],
  });
}

// Fetch a single setting by key
export function useSetting(key: string) {
  const { data: settings } = useSettings();
  const setting = settings?.find(s => s.key === key);
  return setting?.value ?? null;
}

// Mutate a setting
export function useUpdateSetting() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ key, value }: { key: string; value: string | null }) => {
      const res = await apiRequest("PUT", `/api/settings/${key}`, { value });
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/settings"] });
    },
  });
}

export function useTestSettingConnection() {
  return useMutation({
    mutationFn: async (payload: SettingConnectionTestPayload) => {
      const res = await apiRequest("POST", "/api/settings/test-connection", payload);
      return (await res.json()) as SettingConnectionTestResult;
    },
  });
}

export function useWipeData() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async () => {
      const res = await apiRequest("POST", "/api/settings/wipe-data", {});
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/eval-runs"] });
      queryClient.invalidateQueries({ queryKey: ["/api/eval-results"] });
      queryClient.invalidateQueries({ queryKey: ["/api/arena"] });
      queryClient.invalidateQueries({ queryKey: ["/api/models"] });
    },
  });
}

