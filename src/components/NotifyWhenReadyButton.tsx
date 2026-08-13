import { useCallback, useEffect, useState } from "react";
import { MessageSquareText, Smartphone } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import {
  disableReadyText,
  enableReadyText,
  formatPhone,
  getSavedPhone,
  isReadyTextEnabled,
  normalizePhone,
} from "@/lib/readyText";

interface NotifyWhenReadyButtonProps {
  className?: string;
}

/**
 * "Text me when it's ready" opt-in shown on the loading scene. Opens a dialog
 * that collects a phone number; once saved, finished variants trigger an SMS
 * from the send-ready-text edge function.
 */
export function NotifyWhenReadyButton({ className }: NotifyWhenReadyButtonProps) {
  const [enabled, setEnabled] = useState(false);
  const [savedPhone, setSavedPhone] = useState('');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [phoneInput, setPhoneInput] = useState('');
  const [inputError, setInputError] = useState('');

  // Read from storage after mount so the initial paint never guesses.
  useEffect(() => {
    setEnabled(isReadyTextEnabled());
    setSavedPhone(getSavedPhone());
  }, []);

  const openDialog = useCallback(() => {
    setPhoneInput(getSavedPhone());
    setInputError('');
    setDialogOpen(true);
  }, []);

  const handleSave = useCallback(() => {
    const normalized = normalizePhone(phoneInput);
    if (!normalized) {
      setInputError("That doesn't look like a full phone number — include your country code, e.g. +1 555 123 4567");
      return;
    }
    enableReadyText(normalized);
    setEnabled(true);
    setSavedPhone(normalized);
    setDialogOpen(false);
    toast({
      title: "You're all set",
      description: `Go do something else — we'll text ${formatPhone(normalized)} the moment your itinerary is ready.`,
    });
  }, [phoneInput]);

  const handleTurnOff = useCallback(() => {
    disableReadyText();
    setEnabled(false);
    setDialogOpen(false);
    toast({ title: "Texts off", description: "We'll stay quiet — the itinerary still appears right here." });
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        aria-pressed={enabled}
        className={cn(
          "inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-colors",
          enabled
            ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15"
            : "border-border bg-background/60 text-muted-foreground hover:border-primary/40 hover:text-primary",
          className
        )}
      >
        {enabled ? <MessageSquareText className="w-4 h-4" /> : <Smartphone className="w-4 h-4" />}
        {enabled ? `We'll text ${formatPhone(savedPhone)}` : "Text me when it's ready"}
      </button>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Text me when it's ready</DialogTitle>
            <DialogDescription>
              Drop your number and go do something else — we'll send one text when your
              itinerary is finished. Standard message rates apply.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-1">
            <Label htmlFor="ready-text-phone">Phone number</Label>
            <Input
              id="ready-text-phone"
              type="tel"
              autoComplete="tel"
              inputMode="tel"
              placeholder="+1 555 123 4567"
              value={phoneInput}
              onChange={(e) => { setPhoneInput(e.target.value); setInputError(''); }}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSave(); }}
            />
            <p className={cn("text-xs", inputError ? "text-destructive" : "text-muted-foreground")}>
              {inputError || "US and Canadian numbers can skip the country code."}
            </p>
          </div>
          <DialogFooter className="gap-2 sm:gap-0">
            {enabled && (
              <Button variant="ghost" onClick={handleTurnOff}>
                Turn off texts
              </Button>
            )}
            <Button onClick={handleSave}>
              {enabled ? "Update number" : "Text me"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
