import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Check, Loader2 } from "lucide-react";

interface UnlockDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Kicks off checkout (signing in first if needed). */
  onUnlock: () => void;
  loading?: boolean;
}

const INCLUDED = [
  "Every day of this itinerary, fully planned",
  "Complete booking checklist with links",
  "All three trip styles, in full",
  "Plus one more full trip generation, on us",
];

export function UnlockDialog({ open, onOpenChange, onUnlock, loading }: UnlockDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader className="text-center">
          <DialogTitle className="text-xl font-display bg-gradient-to-r from-foreground via-primary to-foreground bg-clip-text text-transparent">
            Unlock your full trip
          </DialogTitle>
          <DialogDescription>
            One-time purchase. No subscription.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          <ul className="space-y-2.5">
            {INCLUDED.map(line => (
              <li key={line} className="flex items-start gap-2.5 text-sm text-foreground">
                <Check className="w-4 h-4 text-primary shrink-0 mt-0.5" />
                <span className={line.startsWith("Plus") ? "font-semibold" : undefined}>{line}</span>
              </li>
            ))}
          </ul>

          <Button className="w-full h-11" onClick={onUnlock} disabled={loading}>
            {loading
              ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Opening checkout...</>
              : <>Unlock for $5</>
            }
          </Button>
          <p className="text-[11px] text-muted-foreground text-center">
            Secure payment by Stripe. You'll be back here right after.
          </p>
        </div>
      </DialogContent>
    </Dialog>
  );
}
