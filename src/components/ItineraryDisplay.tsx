import { MapPin, Clock, DollarSign, Utensils, Camera, Star, Plane, Sun, CloudRain } from "lucide-react";
import { cn } from "@/lib/utils";

interface ItineraryDisplayProps {
  itinerary: string;
  isLoading: boolean;
}

export function ItineraryDisplay({ itinerary, isLoading }: ItineraryDisplayProps) {
  if (isLoading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-full bg-muted" />
          <div className="space-y-2 flex-1">
            <div className="h-4 bg-muted rounded w-1/3" />
            <div className="h-3 bg-muted rounded w-1/2" />
          </div>
        </div>
        {[1, 2, 3].map((i) => (
          <div key={i} className="pl-12 space-y-3">
            <div className="h-4 bg-muted rounded w-2/3" />
            <div className="h-3 bg-muted rounded w-full" />
            <div className="h-3 bg-muted rounded w-4/5" />
          </div>
        ))}
      </div>
    );
  }

  if (!itinerary) return null;

  // Parse the itinerary and render with styling
  const lines = itinerary.split('\n');
  let currentDay = 0;
  
  return (
    <div className="space-y-6 animate-fade-in">
      {lines.map((line, index) => {
        const trimmedLine = line.trim();
        
        if (!trimmedLine) return null;

        // Day headers
        if (trimmedLine.match(/^(Day\s+\d+|##\s*Day)/i)) {
          currentDay++;
          const dayColors = [
            'from-blue-500/20 to-blue-600/10 border-blue-500/30',
            'from-emerald-500/20 to-emerald-600/10 border-emerald-500/30',
            'from-purple-500/20 to-purple-600/10 border-purple-500/30',
            'from-amber-500/20 to-amber-600/10 border-amber-500/30',
            'from-rose-500/20 to-rose-600/10 border-rose-500/30',
          ];
          const colorClass = dayColors[(currentDay - 1) % dayColors.length];
          
          return (
            <div 
              key={index} 
              className={cn(
                "mt-8 first:mt-0 p-4 rounded-xl bg-gradient-to-r border",
                colorClass
              )}
            >
              <div className="flex items-center gap-3">
                <div className="w-12 h-12 rounded-full bg-background/80 flex items-center justify-center shadow-sm">
                  <span className="text-lg font-bold text-primary">{currentDay}</span>
                </div>
                <h3 className="text-xl font-display font-semibold text-foreground">
                  {trimmedLine.replace(/^#+\s*/, '').replace(/^Day\s+\d+:?\s*/i, '')}
                </h3>
              </div>
            </div>
          );
        }

        // Flight info section
        if (trimmedLine.match(/^(##\s*)?(Flights?|Flight Details|Getting There|Travel Info)/i)) {
          return (
            <div key={index} className="mt-6 p-4 bg-gradient-to-r from-sky-500/10 to-sky-600/5 rounded-xl border border-sky-500/20">
              <div className="flex items-center gap-2">
                <Plane className="w-5 h-5 text-sky-600" />
                <h3 className="text-lg font-display font-semibold text-foreground">
                  {trimmedLine.replace(/^#+\s*/, '')}
                </h3>
              </div>
            </div>
          );
        }

        // Best time to visit section
        if (trimmedLine.match(/^(##\s*)?(Best Time|When to Visit|Travel Season|Timing)/i)) {
          return (
            <div key={index} className="mt-6 p-4 bg-gradient-to-r from-amber-500/10 to-amber-600/5 rounded-xl border border-amber-500/20">
              <div className="flex items-center gap-2">
                <Sun className="w-5 h-5 text-amber-600" />
                <h3 className="text-lg font-display font-semibold text-foreground">
                  {trimmedLine.replace(/^#+\s*/, '')}
                </h3>
              </div>
            </div>
          );
        }

        // Budget section
        if (trimmedLine.match(/^(##\s*)?(Budget|Cost|Estimated Budget|Daily Budget)/i)) {
          return (
            <div key={index} className="mt-6 p-4 bg-gradient-to-r from-emerald-500/10 to-emerald-600/5 rounded-xl border border-emerald-500/20">
              <div className="flex items-center gap-2">
                <DollarSign className="w-5 h-5 text-emerald-600" />
                <h3 className="text-lg font-display font-semibold text-foreground">
                  {trimmedLine.replace(/^#+\s*/, '')}
                </h3>
              </div>
            </div>
          );
        }

        // Section headers (Morning, Afternoon, Evening)
        if (trimmedLine.match(/^(Morning|Afternoon|Evening|Night)/i)) {
          const timeIcons: Record<string, string> = {
            'morning': '🌅',
            'afternoon': '☀️',
            'evening': '🌆',
            'night': '🌙',
          };
          const timeKey = trimmedLine.toLowerCase().split(' ')[0];
          
          return (
            <div key={index} className="flex items-center gap-3 ml-4 mt-6 mb-3">
              <span className="text-xl">{timeIcons[timeKey] || '⏰'}</span>
              <h4 className="text-base font-semibold text-foreground">{trimmedLine}</h4>
              <div className="flex-1 h-px bg-border" />
            </div>
          );
        }

        // Bullet points
        if (trimmedLine.startsWith('-') || trimmedLine.startsWith('•') || trimmedLine.startsWith('*')) {
          const content = trimmedLine.replace(/^[-•*]\s*/, '');
          const hasFood = /restaurant|eat|food|breakfast|lunch|dinner|café|cafe|meal|dine|cuisine/i.test(content);
          const hasPhoto = /photo|view|scenic|visit|see|explore|landmark|monument|museum/i.test(content);
          const hasTip = /tip|recommend|don't miss|must|should|pro tip|insider/i.test(content);
          const hasFlight = /flight|airport|airline|depart|arrive|layover/i.test(content);
          const hasWeather = /weather|rain|sun|temperature|climate|season/i.test(content);
          
          const Icon = hasFlight ? Plane : hasFood ? Utensils : hasPhoto ? Camera : hasTip ? Star : hasWeather ? CloudRain : null;
          const iconColor = hasFlight ? 'text-sky-500' : hasFood ? 'text-orange-500' : hasPhoto ? 'text-blue-500' : hasTip ? 'text-amber-500' : hasWeather ? 'text-cyan-500' : '';
          
          // Parse bold text
          const parsedContent = content.split(/(\*\*[^*]+\*\*)/g).map((part, i) => {
            if (part.startsWith('**') && part.endsWith('**')) {
              return <strong key={i} className="font-semibold text-foreground">{part.slice(2, -2)}</strong>;
            }
            return part;
          });
          
          return (
            <div key={index} className="flex items-start gap-3 ml-6 py-1.5 group hover:bg-muted/30 px-3 -mx-3 rounded-lg transition-colors">
              {Icon ? (
                <Icon className={cn("w-4 h-4 mt-1 shrink-0", iconColor)} />
              ) : (
                <div className="w-2 h-2 rounded-full bg-primary/60 mt-2 shrink-0" />
              )}
              <p className="text-foreground/90 leading-relaxed">{parsedContent}</p>
            </div>
          );
        }

        // Regular text (could be sub-headers or descriptions)
        const isSubHeader = trimmedLine.match(/^###?\s+/);
        if (isSubHeader) {
          return (
            <h4 key={index} className="text-base font-medium text-foreground mt-4 mb-2 ml-4">
              {trimmedLine.replace(/^#+\s*/, '')}
            </h4>
          );
        }

        return (
          <p key={index} className="text-foreground/80 ml-6 leading-relaxed py-1">
            {trimmedLine.replace(/^#+\s*/, '')}
          </p>
        );
      })}
    </div>
  );
}
