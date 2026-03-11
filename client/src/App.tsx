import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { AppLayout } from "@/components/layout/AppLayout";

// Pages
import Dashboard from "@/pages/Dashboard";
import RunHistory from "@/pages/RunHistory";
import Models from "@/pages/Models";
import CompareModels from "@/pages/CompareModels";
import EvalWizard from "@/pages/EvalWizard";
import RunDetails from "@/pages/RunDetails";
import Learn from "@/pages/Learn";
import Settings from "@/pages/Settings";
import Arena from "@/pages/Arena";
import ArenaLeaderboard from "@/pages/ArenaLeaderboard";

function Router() {
  return (
    <AppLayout>
      <Switch>
        <Route path="/" component={Dashboard}/>
        <Route path="/history" component={RunHistory}/>
        <Route path="/models" component={Models}/>
        <Route path="/compare" component={CompareModels}/>
        <Route path="/evaluate" component={EvalWizard}/>
        <Route path="/evaluate/:id" component={RunDetails}/>
        <Route path="/learn" component={Learn}/>
        <Route path="/settings" component={Settings} />
        <Route path="/arena" component={Arena}/>
        <Route path="/leaderboard" component={ArenaLeaderboard}/>
        {/* Placeholder for datasets page */}
        <Route path="/datasets">
          <div className="flex flex-col items-center justify-center h-64 text-muted-foreground border-2 border-dashed border-border rounded-2xl bg-muted/40">
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
