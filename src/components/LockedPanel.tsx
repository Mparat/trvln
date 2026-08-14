import { Lock } from "lucide-react";
import { cn } from "@/lib/utils";

interface LockedPanelProps {
  onUnlock: () => void;
  /** Number of placeholder rows/cards to sketch under the blur. */
  rows?: number;
  /** Single-line rows (booking items) instead of activity-sized cards. */
  compact?: boolean;
  label?: string;
  className?: string;
}

// Blurred placeholder for content the server never delivered. The bars
// underneath are pure decoration — locked content doesn't exist client-side,
// so there is nothing here to reveal by poking at the DOM.
export function LockedPanel({
  onUnlock,
  rows = 2,
  compact = false,
  label = "Unlock the full trip",
  className,
}: LockedPanelProps) {
  const shown = Math.max(1, Math.min(rows, compact ? 5 : 3));
  return (
    <div className={cn("relative overflow-hidden rounded-2xl", className)}>
      <div aria-hidden className="space-y-3 blur-[3px] select-none pointer-events-none">
        {Array.from({ length: shown }).map((_, i) =>
          compact ? (
            <div key={i} className="flex items-center gap-3 p-4 rounded-xl border border-border/60 bg-card">
              <div className="flex-1 space-y-2">
                <div className="h-3.5 rounded bg-muted" style={{ width: `${55 - (i % 3) * 10}%` }} />
                <div className="h-2.5 rounded bg-muted/70" style={{ width: `${35 + (i % 2) * 14}%` }} />
              </div>
              <div className="h-7 w-16 rounded-lg bg-muted/80 shrink-0" />
            </div>
          ) : (
            <div key={i} className="bg-card border border-border/60 rounded-2xl p-4 space-y-2.5">
              <div className="h-4 rounded bg-muted" style={{ width: `${45 + (i % 2) * 15}%` }} />
              <div className="h-3 rounded bg-muted/70 w-full" />
              <div className="h-3 rounded bg-muted/70" style={{ width: `${60 + (i % 3) * 12}%` }} />
              <div className="flex gap-2 pt-1">
                <div className="h-5 w-14 rounded-full bg-muted/80" />
                <div className="h-5 w-20 rounded-full bg-muted/80" />
              </div>
            </div>
          )
        )}
      </div>
      <div className="absolute inset-0 z-10 flex items-center justify-center bg-background/45 backdrop-blur-[2px]">
        <button
          type="button"
          onClick={onUnlock}
          className="flex items-center gap-2 rounded-full bg-card border border-border shadow-medium px-4 py-2.5 text-sm font-semibold text-foreground hover:border-primary hover:text-primary transition-colors"
        >
          <Lock className="w-3.5 h-3.5" />
          {label}
        </button>
      </div>
    </div>
  );
}
