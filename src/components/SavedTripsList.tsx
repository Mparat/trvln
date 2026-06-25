import { useState, useEffect } from "react";
import { supabase } from "@/lib/supabase";
import { ChevronLeft, Trash2, Loader2, BookmarkX } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import type { ItineraryVariant } from "@/pages/Index";
import type { TripPreferences } from "@/components/TripInputForm";

interface SavedTrip {
  id: string;
  title: string;
  variants: ItineraryVariant[];
  preferences: TripPreferences | null;
  created_at: string;
}

interface SavedTripsListProps {
  onBack: () => void;
  onOpen: (variants: ItineraryVariant[], preferences: TripPreferences | null) => void;
}

export function SavedTripsList({ onBack, onOpen }: SavedTripsListProps) {
  const [trips, setTrips] = useState<SavedTrip[]>([]);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase
        .from("saved_trips")
        .select("id, title, variants, preferences, created_at")
        .order("created_at", { ascending: false });
      setTrips((data as SavedTrip[]) ?? []);
      setLoading(false);
    })();
  }, []);

  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    setDeleting(id);
    await supabase.from("saved_trips").delete().eq("id", id);
    setTrips((prev) => prev.filter((t) => t.id !== id));
    setDeleting(null);
  };

  return (
    <div className="min-h-screen gradient-hero">
      {/* Nav */}
      <div className="sticky top-0 z-30 bg-background/95 backdrop-blur-sm border-b border-border">
        <div className="container max-w-4xl mx-auto flex items-center justify-between px-4 py-3">
          <button
            onClick={onBack}
            className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
          >
            <ChevronLeft className="w-4 h-4" />
            Back
          </button>
          <div className="flex items-center gap-2">
            <img src="/favicon.svg" alt="Travellin'" className="w-5 h-5" />
            <span className="font-display text-sm text-primary">Travellin'</span>
          </div>
          <div className="w-16" />
        </div>
      </div>

      <main className="container pb-20">
        <div className="max-w-4xl mx-auto pt-8 space-y-6">
          <div>
            <h1 className="text-2xl font-display font-bold text-foreground">Saved trips</h1>
            {!loading && (
              <p className="text-sm text-muted-foreground mt-1">
                {trips.length === 0 ? "No saved trips yet" : `${trips.length} trip${trips.length !== 1 ? "s" : ""}`}
              </p>
            )}
          </div>

          {loading ? (
            <div className="flex items-center justify-center py-20">
              <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
            </div>
          ) : trips.length === 0 ? (
            <div className="text-center py-20 space-y-3">
              <BookmarkX className="w-10 h-10 text-muted-foreground/30 mx-auto" />
              <p className="text-sm text-muted-foreground">Generate a trip and tap Save to see it here</p>
            </div>
          ) : (
            <div className="space-y-3">
              {trips.map((trip) => {
                const subtitle = trip.variants.map((v) => `${v.emoji} ${v.name}`).join("  ·  ");
                return (
                  <button
                    key={trip.id}
                    onClick={() => onOpen(trip.variants, trip.preferences)}
                    className="w-full text-left bg-card rounded-2xl border border-border/60 p-5 hover:bg-muted/10 transition-colors group relative"
                  >
                    <div className="pr-10">
                      <p className="font-semibold text-foreground leading-snug">{trip.title}</p>
                      <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed line-clamp-1">{subtitle}</p>
                      <p className="text-xs text-muted-foreground/50 mt-2">
                        {formatDistanceToNow(new Date(trip.created_at), { addSuffix: true })}
                      </p>
                    </div>
                    {/* Delete */}
                    <button
                      onClick={(e) => handleDelete(trip.id, e)}
                      disabled={deleting === trip.id}
                      className="absolute right-4 top-4 p-1.5 rounded-lg text-muted-foreground/30 opacity-0 group-hover:opacity-100 hover:text-red-500 hover:bg-red-50 transition-all"
                    >
                      {deleting === trip.id ? (
                        <Loader2 className="w-4 h-4 animate-spin" />
                      ) : (
                        <Trash2 className="w-4 h-4" />
                      )}
                    </button>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
