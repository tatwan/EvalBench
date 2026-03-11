import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { AppLayout } from "@/components/layout/AppLayout";

// Pages
import Dashboard from "@/pages/Dashboard";
import Models from "@/pages/Models";
import EvalWizard from "@/pages/EvalWizard";
import Arena from "@/pages/Arena";
import ArenaLeaderboard from "@/pages/ArenaLeaderboard";

function Router() {
  return (
    <AppLayout>
      <Switch>
        <Route path="/" component={Dashboard}/>
        <Route path="/models" component={Models}/>
        <Route path="/evaluate" component={EvalWizard}/>
        <Route path="/arena" component={Arena}/>
        <Route path="/leaderboard" component={ArenaLeaderboard}/>
        {/* Placeholder for datasets page */}
        <Route path="/datasets">
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground border-2 border-dashed border-white/10 rounded-2xl">
            <h2 className="text-xl font-bold mb-2 text-foreground">Datasets coming soon</h2>
            <p>Golden dataset management is planned for v0.2</p>
          </div>
        </Route>
        <Route component={NotFound} />
      </Switch>
    </AppLayout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
