import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

export type Setting = {
  key: string;
  value: string | null;
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
