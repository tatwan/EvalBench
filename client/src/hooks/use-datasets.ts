import { useQuery } from "@tanstack/react-query";
import { api } from "@shared/routes";

export function useDatasets() {
  return useQuery({
    queryKey: [api.datasets.list.path],
    queryFn: async () => {
      const res = await fetch(api.datasets.list.path, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch datasets");
      return res.json();
    },
  });
}
