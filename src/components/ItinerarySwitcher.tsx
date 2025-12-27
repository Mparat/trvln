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
    <div className="flex gap-2 p-1 bg-muted/50 rounded-xl border border-border">
      {variants.map((variant, index) => {
        const isActive = index === activeIndex;
        const isLoading = loadingVariants[variant.id];
        const hasContent = variant.content.length > 0;

        return (
          <button
            key={variant.id}
            onClick={() => onSelect(index)}
            className={cn(
              "flex-1 flex items-center justify-center gap-2 px-4 py-3 rounded-lg text-sm font-medium transition-all",
              isActive
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground hover:bg-background/50"
            )}
          >
            <span className="text-lg">{variant.emoji}</span>
            <span className="hidden sm:inline">{variant.name}</span>
            {isLoading && (
              <Loader2 className="w-3 h-3 animate-spin" />
            )}
            {!isLoading && hasContent && (
              <span className="w-2 h-2 rounded-full bg-primary" />
            )}
          </button>
        );
      })}
    </div>
  );
}