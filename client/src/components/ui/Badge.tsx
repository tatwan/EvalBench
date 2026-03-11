import { ReactNode } from "react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface BadgeProps {
  children: ReactNode;
  variant?: "default" | "secondary" | "outline" | "success" | "warning";
  className?: string;
}

export function Badge({ children, variant = "default", className }: BadgeProps) {
  const variants = {
    default: "bg-primary/20 text-primary ring-1 ring-primary/30",
    secondary: "bg-secondary text-secondary-foreground ring-1 ring-white/10",
    outline: "border border-border text-muted-foreground",
    success: "bg-emerald-500/10 text-emerald-400 ring-1 ring-emerald-500/30",
    warning: "bg-amber-500/10 text-amber-400 ring-1 ring-amber-500/30",
  };

  return (
    <span
      className={cn(
        "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-semibold uppercase tracking-wider",
        variants[variant],
        className
      )}
    >
      {children}
    </span>
  );
}
