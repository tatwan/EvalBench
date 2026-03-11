import { Link, useLocation } from "wouter";
import { Activity, LayoutDashboard, Cpu, Swords, Settings, Database, Trophy, History, SplitSquareHorizontal, BookOpen } from "lucide-react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import type { ElementType } from "react";
import { useModels, useOllamaStatus } from "@/hooks/use-models";
import { useEvalRuns } from "@/hooks/use-eval";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

type NavItem = {
  href: string;
  label: string;
  icon: ElementType;
  badge?: string | number;
  isNew?: boolean;
  match?: (path: string) => boolean;
};

export function Sidebar() {
  const [location] = useLocation();
  const { data: models = [] } = useModels();
  const { data: runs = [] } = useEvalRuns();
  const { data: ollamaStatus } = useOllamaStatus();

  const sections: { label: string; items: NavItem[] }[] = [
    {
      label: "Evaluate",
      items: [
        { href: "/", label: "Dashboard", icon: LayoutDashboard },
        { href: "/evaluate", label: "Eval Wizard", icon: Activity, isNew: true, match: (path) => path.startsWith("/evaluate") },
        { href: "/history", label: "Run History", icon: History, badge: runs.length },
      ],
    },
    {
      label: "Analyze",
      items: [
        { href: "/models", label: "Models", icon: Cpu, badge: models.length },
        { href: "/arena", label: "Arena", icon: Swords },
        { href: "/leaderboard", label: "Leaderboard", icon: Trophy },
        { href: "/compare", label: "Compare", icon: SplitSquareHorizontal },
      ],
    },
    {
      label: "Learn",
      items: [
        { href: "/learn", label: "Metric Guide", icon: BookOpen },
        { href: "/datasets", label: "Datasets", icon: Database },
      ],
    },
  ];

  const isActive = (item: NavItem) => {
    if (item.match) return item.match(location);
    return location === item.href;
  };

  return (
    <aside className="w-64 flex-shrink-0 flex flex-col border-r border-border bg-card h-screen sticky top-0">
      <div className="px-5 py-5 flex items-center gap-3 border-b border-border">
        <div className="w-9 h-9 rounded-lg bg-gradient-to-br from-violet-500 to-violet-400 flex items-center justify-center shadow-sm">
          <Activity className="w-5 h-5 text-white" />
        </div>
        <div>
          <div className="font-extrabold text-lg tracking-tight text-foreground">EvalBench</div>
          <div className="text-[11px] text-muted-foreground">v0.4 - Local LLM Eval</div>
        </div>
      </div>

      <nav className="flex-1 px-3 py-4 space-y-4 overflow-y-auto">
        {sections.map((section) => (
          <div key={section.label}>
            <div className="px-3 text-[10.5px] font-bold uppercase tracking-[0.18em] text-muted-foreground/80">
              {section.label}
            </div>
            <div className="mt-2 space-y-1">
              {section.items.map((item) => {
                const active = isActive(item);
                const Icon = item.icon;
                return (
                  <Link key={item.href} href={item.href} className="block">
                    <div
                      className={cn(
                        "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
                        active
                          ? "bg-violet-100 text-violet-700"
                          : "text-foreground/70 hover:bg-muted hover:text-foreground"
                      )}
                    >
                      <Icon className="w-4.5 h-4.5" />
                      <span className="flex-1">{item.label}</span>
                      {item.isNew && (
                        <span className="text-[9px] font-bold px-2 py-0.5 rounded-full bg-violet-600 text-white">NEW</span>
                      )}
                      {item.badge !== undefined && !item.isNew && (
                        <span className="text-[11px] font-mono text-muted-foreground">{item.badge}</span>
                      )}
                    </div>
                  </Link>
                );
              })}
            </div>
          </div>
        ))}
      </nav>

      <div className="px-4 pb-4">
        <div className="p-3 rounded-lg bg-muted border border-border flex items-center gap-3 mb-3">
          <span className={cn("h-2 w-2 rounded-full", ollamaStatus?.running ? "bg-emerald-500" : "bg-rose-500")} />
          <div className="min-w-0">
            <div className="text-xs font-semibold text-foreground">
              {ollamaStatus?.running ? "Ollama Connected" : "Ollama Offline"}
            </div>
            <div className="text-[11px] text-muted-foreground font-mono truncate">
              {ollamaStatus?.running ? "localhost:11434" : "Run `ollama serve`"}
            </div>
          </div>
        </div>
        <Link href="/settings" className="block">
          <div
            className={cn(
              "flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors",
              location === "/settings"
                ? "bg-violet-100 text-violet-700"
                : "text-foreground/70 hover:bg-muted hover:text-foreground"
            )}
          >
            <Settings className="w-4.5 h-4.5" />
            <span>Settings</span>
          </div>
        </Link>
      </div>
    </aside>
  );
}
