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
        <button
          type="button"
          aria-label={description}
          title={description}
          className={cn(
            "inline-flex items-center justify-center text-[11px] font-bold text-muted-foreground cursor-help align-middle",
            className
          )}
        >
          ?
        </button>
      </TooltipTrigger>
      <TooltipContent className="max-w-xs text-xs leading-relaxed">
        {description}
      </TooltipContent>
    </Tooltip>
  );
}
