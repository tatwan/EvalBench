import { useModels, useDiscoverModels } from "@/hooks/use-models";
import { Card, CardContent } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { Badge } from "@/components/ui/Badge";
import { Cpu, Search, HardDrive, Zap, RefreshCw } from "lucide-react";
import { motion } from "framer-motion";

export default function Models() {
  const { data: models = [], isLoading } = useModels();
  const discoverMutation = useDiscoverModels();

  return (
    <div className="space-y-8">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-3xl font-bold text-gradient">Local Models</h1>
          <p className="text-muted-foreground mt-2">Manage models available via Ollama.</p>
        </div>
        <Button 
          onClick={() => discoverMutation.mutate()} 
          isLoading={discoverMutation.isPending}
          className="gap-2"
        >
          {!discoverMutation.isPending && <RefreshCw className="w-4 h-4" />}
          Discover Models
        </Button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[1, 2, 3].map(i => (
            <Card key={i} className="animate-pulse h-48 bg-white/5" />
          ))}
        </div>
      ) : models.length === 0 ? (
        <div className="glass-panel rounded-3xl p-12 text-center flex flex-col items-center justify-center border-dashed border-2 border-white/10">
          <div className="w-16 h-16 bg-white/5 rounded-full flex items-center justify-center mb-4">
            <Search className="w-8 h-8 text-muted-foreground" />
          </div>
          <h3 className="text-xl font-semibold mb-2">No models found</h3>
          <p className="text-muted-foreground max-w-md mb-6">
            Make sure Ollama is running locally, then click discover to sync your downloaded models into EvalBench.
          </p>
          <Button onClick={() => discoverMutation.mutate()} isLoading={discoverMutation.isPending}>
            Scan for Local Models
          </Button>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {models.map((model, index) => (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.1 }}
              key={model.id}
            >
              <Card className="hover:border-primary/50 transition-colors group h-full flex flex-col">
                <CardContent className="p-6 flex flex-col h-full">
                  <div className="flex justify-between items-start mb-4">
                    <div className="flex items-center gap-3">
                      <div className="p-2.5 bg-primary/10 rounded-xl text-primary ring-1 ring-primary/20 group-hover:scale-110 transition-transform">
                        <Cpu className="w-5 h-5" />
                      </div>
                      <h3 className="font-semibold text-lg truncate" title={model.name}>
                        {model.name}
                      </h3>
                    </div>
                  </div>
                  
                  <div className="mt-auto space-y-4">
                    <div className="grid grid-cols-2 gap-3">
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <HardDrive className="w-4 h-4" />
                        <span>{model.sizeGb ? `${model.sizeGb} GB` : 'Unknown'}</span>
                      </div>
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <Zap className="w-4 h-4" />
                        <span>{model.params || 'N/A'} Params</span>
                      </div>
                    </div>
                    
                    <div className="pt-4 border-t border-white/5 flex gap-2 flex-wrap">
                      {model.family && <Badge variant="secondary">{model.family}</Badge>}
                      {model.quantization && <Badge variant="outline">{model.quantization}</Badge>}
                    </div>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          ))}
        </div>
      )}
    </div>
  );
}
