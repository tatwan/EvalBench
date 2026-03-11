import { cn } from "@/lib/utils";

type ScoreFormat = "ratio" | "percent" | "raw";

type ScoreBadgeProps = {
  value: number;
  metric?: string;
  format?: ScoreFormat;
  precision?: number;
  className?: string;
};

type Grade = "excellent" | "good" | "fair" | "poor";

const gradeStyles: Record<Grade, string> = {
  excellent: "bg-emerald-100 text-emerald-700",
  good: "bg-blue-100 text-blue-700",
  fair: "bg-amber-100 text-amber-700",
  poor: "bg-rose-100 text-rose-700",
};

function normalizeValue(value: number, format: ScoreFormat): number {
  if (format === "percent") return value / 100;
  return value;
}

function getGrade(value: number, metric: string | undefined, format: ScoreFormat): Grade {
  const normalized = normalizeValue(value, format);
  const m = metric?.toLowerCase() ?? "";

  if (m.includes("rouge")) {
    if (normalized >= 0.4) return "excellent";
    if (normalized >= 0.3) return "good";
    if (normalized >= 0.2) return "fair";
    return "poor";
  }

  if (normalized >= 0.7) return "excellent";
  if (normalized >= 0.55) return "good";
  if (normalized >= 0.4) return "fair";
  return "poor";
}

function formatValue(value: number, format: ScoreFormat, precision?: number): string {
  if (format === "percent") return `${value.toFixed(precision ?? 1)}%`;
  if (format === "raw") return value.toFixed(precision ?? 2);
  return value.toFixed(precision ?? 3);
}

export function ScoreBadge({ value, metric, format = "ratio", precision, className }: ScoreBadgeProps) {
  const grade = getGrade(value, metric, format);
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-md px-2 py-0.5 text-xs font-semibold font-mono",
        gradeStyles[grade],
        className
      )}
    >
      {formatValue(value, format, precision)}
    </span>
  );
}
