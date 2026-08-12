import { DollarSign, MapPin, Calendar, Plane, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import type { ItineraryData } from "@/types/itinerary";

interface TripSummaryCardProps {
  /** Parsed itinerary. The card renders nothing until this is available. */
  data?: ItineraryData;
  departureCity?: string;
  startDate?: Date;
  endDate?: Date;
  durationDays?: number;
}

export function TripSummaryCard({ data, departureCity, startDate, endDate, durationDays }: TripSummaryCardProps) {
  // The model returns a JSON itinerary whose `summary` block already holds
  // everything this card shows. It used to scrape those values out of the raw
  // string with markdown-era regexes (`**City**`, `**Day 1**`), which silently
  // stopped matching when the output became JSON: destinations came back empty
  // and "highlights" were sentence fragments cut at the next comma, trailing
  // JSON quotes and all. Worse, it rendered that guesswork even when the
  // itinerary had failed to parse, so a truncated generation still showed a
  // confident-looking summary above an error.
  if (!data?.summary) return null;

  const summary = {
    // `destination` is a single string ("Dolomites, Italy" or "Lisbon & Porto").
    // Split so multi-stop trips still render as separate chips.
    cities: data.summary.destination
      ? data.summary.destination.split(/\s*(?:,|&|\band\b|\/)\s*/).map(c => c.trim()).filter(Boolean)
      : [],
    budget: data.summary.totalBudget || null,
    duration: data.summary.duration || (durationDays ? `${durationDays} days` : null),
    highlights: (data.summary.highlights ?? []).slice(0, 4),
  };

  return (
    <Card className="p-6 bg-gradient-to-br from-primary/5 via-background to-background border-primary/20">
      <div className="flex items-center gap-2 mb-4">
        <Sparkles className="w-5 h-5 text-primary" />
        <h3 className="font-display text-lg font-semibold text-foreground">Trip at a Glance</h3>
      </div>
      
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {/* Duration */}
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-muted-foreground text-sm">
            <Calendar className="w-4 h-4" />
            Duration
          </div>
          <p className="font-semibold text-foreground">{summary.duration}</p>
          {startDate && endDate && (
            <p className="text-xs text-muted-foreground">
              {startDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} - {endDate.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}
            </p>
          )}
        </div>

        {/* Cities */}
        <div className="space-y-1">
          <div className="flex items-center gap-1.5 text-muted-foreground text-sm">
            <MapPin className="w-4 h-4" />
            Destinations
          </div>
          <div className="flex flex-wrap gap-1">
            {summary.cities.slice(0, 3).map(city => (
              <Badge key={city} variant="secondary" className="text-xs">
                {city}
              </Badge>
            ))}
            {summary.cities.length > 3 && (
              <Badge variant="outline" className="text-xs">
                +{summary.cities.length - 3}
              </Badge>
            )}
          </div>
        </div>

        {/* Budget */}
        {summary.budget && (
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-muted-foreground text-sm">
              <DollarSign className="w-4 h-4" />
              Est. Budget
            </div>
            <p className="font-semibold text-foreground">{summary.budget}</p>
          </div>
        )}

        {/* Departure */}
        {departureCity && (
          <div className="space-y-1">
            <div className="flex items-center gap-1.5 text-muted-foreground text-sm">
              <Plane className="w-4 h-4" />
              Departing from
            </div>
            <p className="font-semibold text-foreground">{departureCity}</p>
          </div>
        )}
      </div>

      {/* Highlights */}
      {summary.highlights.length > 0 && (
        <div className="mt-4 pt-4 border-t border-border">
          <p className="text-sm text-muted-foreground mb-2">Key highlights:</p>
          <div className="flex flex-wrap gap-2">
            {summary.highlights.map((highlight) => (
              <Badge key={highlight} variant="outline" className="text-xs">
                {highlight}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
