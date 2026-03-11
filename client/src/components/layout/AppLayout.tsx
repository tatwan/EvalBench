import { Sidebar } from "./Sidebar";
import { motion } from "framer-motion";
import { ReactNode } from "react";
import { Link, useLocation } from "wouter";
import { Search } from "lucide-react";
import { Button } from "@/components/ui/Button";

export function AppLayout({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const labels: Record<string, string> = {
    "/": "Dashboard",
    "/history": "Run History",
    "/models": "Models",
    "/compare": "Compare",
    "/evaluate": "Eval Wizard",
    "/learn": "Metric Guide",
    "/settings": "Settings",
    "/arena": "Arena",
    "/leaderboard": "Leaderboard",
    "/datasets": "Datasets",
  };

  const label =
    labels[location] ??
    (location.startsWith("/evaluate") ? "Eval Wizard" : "EvalBench");

  return (
    <div className="flex h-screen bg-background text-foreground overflow-hidden">
      <Sidebar />
      <div className="flex-1 flex flex-col min-h-screen overflow-hidden">
        <header className="h-14 bg-card border-b border-border px-6 flex items-center justify-between sticky top-0 z-10">
          <div className="text-sm text-muted-foreground flex items-center gap-2">
            <span className="font-medium text-muted-foreground">EvalBench</span>
            <span className="text-border">&gt;</span>
            <span className="text-foreground font-semibold">{label}</span>
          </div>
          <div className="flex items-center gap-3">
            <div className="hidden md:flex items-center gap-2 rounded-md border border-border bg-muted px-3 py-1.5 text-xs text-muted-foreground">
              <Search className="h-4 w-4" />
              <span>Search...</span>
              <kbd className="ml-2 rounded border border-border bg-card px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground">
                Cmd+K
              </kbd>
            </div>
            <Link href="/evaluate">
              <Button size="sm" className="gap-2">+ New Eval</Button>
            </Link>
          </div>
        </header>
        <main className="flex-1 overflow-y-auto overflow-x-hidden">
          <motion.div
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35, ease: "easeOut" }}
            className="p-6 lg:p-8 max-w-7xl mx-auto w-full min-h-full"
          >
            {children}
          </motion.div>
        </main>
      </div>
    </div>
  );
}
