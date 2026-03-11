import { ButtonHTMLAttributes, forwardRef } from "react";
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";
import { Loader2 } from "lucide-react";

function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "outline" | "ghost" | "danger" | "glass";
  size?: "sm" | "md" | "lg" | "icon";
  isLoading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = "primary", size = "md", isLoading, children, disabled, ...props }, ref) => {
    const variants = {
      primary: "bg-gradient-to-b from-sky-400 to-blue-600 text-white shadow-lg shadow-primary/20 hover:shadow-primary/40 hover:-translate-y-0.5 border border-sky-300/20",
      secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80",
      outline: "border border-border bg-transparent hover:bg-accent text-foreground",
      ghost: "bg-transparent hover:bg-white/5 text-foreground",
      danger: "bg-destructive/90 text-destructive-foreground hover:bg-destructive shadow-lg shadow-destructive/20",
      glass: "bg-white/5 backdrop-blur-md border border-white/10 hover:bg-white/10 text-foreground",
    };

    const sizes = {
      sm: "h-9 px-3 text-xs",
      md: "h-11 px-5 py-2 text-sm",
      lg: "h-14 px-8 text-base",
      icon: "h-11 w-11 flex items-center justify-center",
    };

    return (
      <button
        ref={ref}
        disabled={disabled || isLoading}
        className={cn(
          "inline-flex items-center justify-center rounded-xl font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 active:scale-[0.98]",
          variants[variant],
          sizes[size],
          className
        )}
        {...props}
      >
        {isLoading && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
        {children}
      </button>
    );
  }
);
Button.displayName = "Button";
