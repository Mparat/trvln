import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Loader2, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CreditPack } from "@/lib/checkout";

interface PaywallModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onPurchase: (pack: CreditPack) => void;
  /** Which pack's checkout is being opened, if any. */
  loadingPack: CreditPack | null;
}

const OPTIONS: { pack: CreditPack; price: string; trips: string; perTrip: string; best?: boolean }[] = [
  { pack: 'pack_2', price: '$5', trips: '2 trips', perTrip: '$2.50 per trip' },
  { pack: 'pack_10', price: '$20', trips: '10 trips', perTrip: '$2 per trip', best: true },
];

export function PaywallModal({ open, onOpenChange, onPurchase, loadingPack }: PaywallModalProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader className="text-center">
          <DialogTitle className="text-2xl font-display bg-gradient-to-r from-foreground via-primary to-foreground bg-clip-text text-transparent">
            Where to next?
          </DialogTitle>
          <DialogDescription>
            You've used your trips. Keep exploring.
          </DialogDescription>
        </DialogHeader>

        <div className="grid sm:grid-cols-2 gap-3 pt-2">
          {OPTIONS.map(({ pack, price, trips, perTrip, best }) => (
            <div
              key={pack}
              className={cn(
                "relative flex flex-col items-center gap-1 rounded-2xl border p-5 pt-6 shadow-medium bg-card",
                best ? "border-primary" : "border-border",
              )}
            >
              {best && (
                <span className="absolute -top-2.5 flex items-center gap-1 rounded-full bg-primary text-primary-foreground text-[11px] font-semibold px-2.5 py-0.5">
                  <Sparkles className="w-3 h-3" />
                  Best value
                </span>
              )}
              <span className="text-3xl font-display font-bold text-foreground">{price}</span>
              <span className="text-sm font-semibold text-foreground">{trips}</span>
              <span className="text-xs text-muted-foreground mb-3">{perTrip}</span>
              <Button
                className="w-full h-10"
                variant={best ? "default" : "outline"}
                onClick={() => onPurchase(pack)}
                disabled={loadingPack !== null}
              >
                {loadingPack === pack
                  ? <Loader2 className="w-4 h-4 animate-spin" />
                  : `Get ${trips}`}
              </Button>
            </div>
          ))}
        </div>
        <p className="text-[11px] text-muted-foreground text-center">
          One-time purchase, no subscription. Each trip includes all three itinerary styles and edits.
        </p>
      </DialogContent>
    </Dialog>
  );
}
