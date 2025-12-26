import { DollarSign, Calendar, MapPin, Sparkles, Plane, Sun } from "lucide-react";

interface CitySummary {
  name: string;
  days: number;
  activities: string[];
}

interface ItinerarySummaryProps {
  budgetPerDay: string;
  cities: CitySummary[];
  bestTimeToVisit?: string;
  flightInfo?: string;
}

export function ItinerarySummary({ budgetPerDay, cities, bestTimeToVisit, flightInfo }: ItinerarySummaryProps) {
  return (
    <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
      {/* Budget Per Day */}
      <div className="p-4 bg-gradient-to-br from-emerald-500/10 to-emerald-600/5 rounded-xl border border-emerald-500/20">
        <div className="flex items-center gap-2 text-emerald-600 mb-2">
          <DollarSign className="w-4 h-4" />
          <span className="text-xs font-medium uppercase tracking-wide">Est. Budget/Day</span>
        </div>
        <p className="text-xl font-semibold text-foreground">{budgetPerDay}</p>
      </div>

      {/* Cities & Days */}
      <div className="p-4 bg-gradient-to-br from-blue-500/10 to-blue-600/5 rounded-xl border border-blue-500/20">
        <div className="flex items-center gap-2 text-blue-600 mb-2">
          <Calendar className="w-4 h-4" />
          <span className="text-xs font-medium uppercase tracking-wide">Cities & Duration</span>
        </div>
        <div className="space-y-1">
          {cities.map((city, i) => (
            <div key={i} className="flex items-center justify-between text-sm">
              <span className="text-foreground font-medium">{city.name}</span>
              <span className="text-muted-foreground">{city.days} day{city.days > 1 ? 's' : ''}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Key Activities */}
      <div className="p-4 bg-gradient-to-br from-purple-500/10 to-purple-600/5 rounded-xl border border-purple-500/20">
        <div className="flex items-center gap-2 text-purple-600 mb-2">
          <Sparkles className="w-4 h-4" />
          <span className="text-xs font-medium uppercase tracking-wide">Key Activities</span>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {cities.flatMap(c => c.activities).slice(0, 5).map((activity, i) => (
            <span key={i} className="px-2 py-0.5 text-xs bg-purple-500/10 text-purple-700 rounded-full">
              {activity}
            </span>
          ))}
        </div>
      </div>

      {/* Best Time & Flights */}
      <div className="p-4 bg-gradient-to-br from-amber-500/10 to-amber-600/5 rounded-xl border border-amber-500/20">
        {bestTimeToVisit ? (
          <>
            <div className="flex items-center gap-2 text-amber-600 mb-2">
              <Sun className="w-4 h-4" />
              <span className="text-xs font-medium uppercase tracking-wide">Best Time</span>
            </div>
            <p className="text-sm text-foreground">{bestTimeToVisit}</p>
          </>
        ) : flightInfo ? (
          <>
            <div className="flex items-center gap-2 text-amber-600 mb-2">
              <Plane className="w-4 h-4" />
              <span className="text-xs font-medium uppercase tracking-wide">Flights</span>
            </div>
            <p className="text-sm text-foreground">{flightInfo}</p>
          </>
        ) : (
          <>
            <div className="flex items-center gap-2 text-amber-600 mb-2">
              <MapPin className="w-4 h-4" />
              <span className="text-xs font-medium uppercase tracking-wide">Destinations</span>
            </div>
            <p className="text-sm text-foreground">{cities.length} location{cities.length > 1 ? 's' : ''}</p>
          </>
        )}
      </div>
    </div>
  );
}
