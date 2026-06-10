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
              "flex-1 min-w-fit flex items-center justify-center gap-2 px-5 py-3.5 rounded-2xl text-sm font-semibold border bg-background shadow-sm transition-all whitespace-nowrap",
              isActive
                ? "text-foreground border-primary"
                : "text-muted-foreground border-transparent hover:text-foreground hover:border-border"
            )}
          >
            <span className="text-base leading-none">{variant.emoji}</span>
            <span className="truncate">{variant.name}</span>
            {isLoading && (
              <Loader2 className="w-3 h-3 animate-spin shrink-0" />
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