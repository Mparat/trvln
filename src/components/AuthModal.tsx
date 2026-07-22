import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/lib/supabase";
import { Loader2, Mail, CheckCircle2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface AuthModalProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function AuthModal({ open, onOpenChange }: AuthModalProps) {
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  const handleGoogle = async () => {
    setGoogleLoading(true);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: window.location.origin },
    });
    if (error) {
      toast({ title: "Couldn't sign in with Google", description: error.message, variant: "destructive" });
      setGoogleLoading(false);
    }
    // On success the browser redirects away — nothing more to do
  };

  const handleMagicLink = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim()) return;
    setSending(true);
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(),
      options: { emailRedirectTo: window.location.origin },
    });
    setSending(false);
    if (error) {
      toast({ title: "Couldn't send link", description: error.message, variant: "destructive" });
    } else {
      setSent(true);
    }
  };

  const handleOpenChange = (next: boolean) => {
    if (!next) { setSent(false); setEmail(""); }
    onOpenChange(next);
  };

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="sm:max-w-sm">
        <DialogHeader className="text-center">
          <DialogTitle className="text-xl">Save your trip</DialogTitle>
          <DialogDescription>
            Sign in to save and revisit your itineraries anytime.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-1">
          {/* Google */}
          <Button
            variant="outline"
            className="w-full gap-2.5 h-11"
            onClick={handleGoogle}
            disabled={googleLoading}
          >
            {googleLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <GoogleIcon />}
            Continue with Google
          </Button>

          <div className="flex items-center gap-3">
            <div className="flex-1 border-t border-border" />
            <span className="text-xs text-muted-foreground">or</span>
            <div className="flex-1 border-t border-border" />
          </div>

          {/* Magic link */}
          {sent ? (
            <div className="text-center py-4 space-y-2">
              <CheckCircle2 className="w-9 h-9 text-green-500 mx-auto" />
              <p className="font-semibold text-sm text-foreground">Check your inbox</p>
              <p className="text-xs text-muted-foreground">
                We sent a sign-in link to <span className="font-medium">{email}</span>
              </p>
            </div>
          ) : (
            <form onSubmit={handleMagicLink} className="space-y-3">
              <Input
                type="email"
                placeholder="your@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                disabled={sending}
                required
              />
              <Button type="submit" className="w-full h-11" disabled={sending || !email.trim()}>
                {sending
                  ? <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Sending...</>
                  : <><Mail className="w-4 h-4 mr-2" />Send magic link</>
                }
              </Button>
            </form>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

function GoogleIcon() {
  return (
    <svg viewBox="0 0 24 24" className="w-4 h-4 shrink-0" aria-hidden="true">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05"/>
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
    </svg>
  );
}
