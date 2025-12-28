import { DollarSign, MapPin, Calendar, Plane, Sparkles } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

interface TripSummaryCardProps {
  itinerary: string;
  departureCity?: string;
  startDate?: Date;
  endDate?: Date;
  durationDays?: number;
}

function extractSummaryData(itinerary: string, providedDuration?: number) {
  // Extract cities mentioned
  const cityMatches = itinerary.match(/\*\*([A-Z][a-z]+(?:\s[A-Z][a-z]+)*)\*\*/g) || [];
  const cities = [...new Set(cityMatches.map(m => m.replace(/\*\*/g, '')))].slice(0, 5);
  
  // Extract budget info
  const budgetMatch = itinerary.match(/\$[\d,]+(?:\s*[-–]\s*\$[\d,]+)?(?:\s*(?:per day|\/day|daily))?/i);
  const budget = budgetMatch ? budgetMatch[0] : null;
  
  // Count days from itinerary - look for "Day X:" patterns
  const dayMatches = itinerary.match(/\*\*Day\s+(\d+)/gi) || [];
  const dayNumbers = dayMatches.map(m => {
    const num = m.match(/\d+/);
    return num ? parseInt(num[0], 10) : 0;
  });
  const maxDayFromItinerary = dayNumbers.length > 0 ? Math.max(...dayNumbers) : 0;
  
  // Use the higher of: provided duration, days from itinerary, or count of day matches
  const totalDays = providedDuration 
    ? providedDuration 
    : maxDayFromItinerary > 0 
      ? maxDayFromItinerary 
      : dayMatches.length;
  
  // Extract highlights (look for key activities)
  const highlights: string[] = [];
  const highlightPatterns = [
    /visit(?:ing)?\s+(?:the\s+)?([^,.]+)/gi,
    /explore\s+(?:the\s+)?([^,.]+)/gi,
    /experience\s+(?:the\s+)?([^,.]+)/gi,
  ];
  
  highlightPatterns.forEach(pattern => {
    const matches = itinerary.matchAll(pattern);
    for (const match of matches) {
      if (match[1] && match[1].length < 50) {
        highlights.push(match[1].trim());
      }
    }
  });

  return {
    cities,
    budget,
    totalDays,
    highlights: [...new Set(highlights)].slice(0, 4),
  };
}

export function TripSummaryCard({ itinerary, departureCity, startDate, endDate, durationDays }: TripSummaryCardProps) {
  const summary = extractSummaryData(itinerary, durationDays);
  
  if (!itinerary || summary.totalDays === 0) return null;

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
          <p className="font-semibold text-foreground">{summary.totalDays} days</p>
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
            {summary.highlights.map((highlight, i) => (
              <Badge key={i} variant="outline" className="text-xs">
                {highlight}
              </Badge>
            ))}
          </div>
        </div>
      )}
    </Card>
  );
}
