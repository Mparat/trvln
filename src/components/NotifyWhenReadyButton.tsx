import { useCallback, useEffect, useState } from "react";
import { Bell, BellRing } from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import {
  getNotifyStatus,
  isNotifyEnabled,
  notificationsSupported,
  requestNotifyPermission,
  setNotifyEnabled,
  type NotifyStatus,
} from "@/lib/notifications";

interface NotifyWhenReadyButtonProps {
  className?: string;
}

/**
 * Opt-in for the "your itinerary is ready" browser notification. Browsers only
 * grant permission off a user gesture (and punish sites that ask on load), so
 * the prompt lives behind this tap.
 */
export function NotifyWhenReadyButton({ className }: NotifyWhenReadyButtonProps) {
  const [status, setStatus] = useState<NotifyStatus>('default');
  const [enabled, setEnabled] = useState(false);

  // Read from the browser after mount so the button never renders a state the
  // server/initial paint can't know.
  useEffect(() => {
    setStatus(getNotifyStatus());
    setEnabled(isNotifyEnabled());
  }, []);

  const handleClick = useCallback(async () => {
    if (!notificationsSupported()) {
      toast({
        title: "Notifications aren't supported here",
        description: "Your browser can't show them — keep this tab open and we'll surface the itinerary as soon as it lands.",
      });
      return;
    }

    if (enabled) {
      setNotifyEnabled(false);
      setEnabled(false);
      toast({ title: "Notifications off", description: "We'll stay quiet — the itinerary still appears right here." });
      return;
    }

    const result = await requestNotifyPermission();
    setStatus(result);

    if (result === 'granted') {
      setNotifyEnabled(true);
      setEnabled(true);
      toast({
        title: "You're all set",
        description: "Go do something else — we'll ping you the moment your itinerary is ready.",
      });
      return;
    }

    toast({
      title: result === 'denied' ? "Notifications are blocked" : "Notifications not enabled",
      description: result === 'denied'
        ? "Allow notifications for this site in your browser settings, then try again."
        : "No problem — the itinerary will be waiting here when you come back.",
      variant: result === 'denied' ? "destructive" : undefined,
    });
  }, [enabled]);

  if (status === 'unsupported') return null;

  return (
    <button
      type="button"
      onClick={handleClick}
      aria-pressed={enabled}
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-4 py-2 text-sm font-medium transition-colors",
        enabled
          ? "border-primary/40 bg-primary/10 text-primary hover:bg-primary/15"
          : "border-border bg-background/60 text-muted-foreground hover:border-primary/40 hover:text-primary",
        className
      )}
    >
      {enabled ? <BellRing className="w-4 h-4" /> : <Bell className="w-4 h-4" />}
      {enabled ? "We'll ping you when it's ready" : "Notify me when it's ready"}
    </button>
  );
}
