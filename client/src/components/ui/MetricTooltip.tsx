import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

type MetricTooltipProps = {
  description: string;
  className?: string;
};

export function MetricTooltip({ description, className }: MetricTooltipProps) {
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span
          className={cn(
            "inline-flex h-4 w-4 items-center justify-center rounded-full border border-border bg-muted text-[10px] font-bold text-muted-foreground cursor-help align-middle",
            className
          )}
        >
          ?
        </span>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs leading-relaxed">
        {description}
      </TooltipContent>
    </Tooltip>
  );
}
