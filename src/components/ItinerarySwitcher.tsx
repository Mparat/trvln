import { cn } from "@/lib/utils";
import { Loader2 } from "lucide-react";
import type { ItineraryVariant } from "@/pages/Index";

interface ItinerarySwitcherProps {
  variants: ItineraryVariant[];
  activeIndex: number;
  onSelect: (index: number) => void;
  loadingVariants: Record<string, boolean>;
}

export function ItinerarySwitcher({ 
  variants, 
  activeIndex, 
  onSelect,
  loadingVariants 
}: ItinerarySwitcherProps) {
  return (
    <div className="flex gap-2.5 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
      {variants.map((variant, index) => {
        const isActive = index === activeIndex;
        const isLoading = loadingVariants[variant.id];
        const hasContent = variant.content.length > 0;

        return (
          <button
            key={variant.id}
            onClick={() => onSelect(index)}
            className={cn(
              "flex-1 min-w-fit flex items-center justify-center gap-2 px-4 py-3 rounded-2xl text-sm font-semibold border transition-all whitespace-nowrap",
              isActive
                ? "bg-background text-foreground border-foreground shadow-sm"
                : "bg-transparent text-muted-foreground border-border hover:text-foreground hover:border-foreground/40"
            )}
          >
            <span className="text-base leading-none">{variant.emoji}</span>
            <span>{variant.name}</span>
            {isLoading && (
              <Loader2 className="w-3 h-3 animate-spin" />
            )}
            {!isLoading && hasContent && !isActive && (
              <span className="w-1.5 h-1.5 rounded-full bg-primary shrink-0" />
            )}
          </button>
        );
      })}
    </div>
  );
}