import { MapPin, Clock, DollarSign, Utensils, Camera, Star } from "lucide-react";
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
  
  return (
    <div className="prose prose-stone max-w-none animate-fade-in">
      <div className="space-y-4">
        {lines.map((line, index) => {
          const trimmedLine = line.trim();
          
          if (!trimmedLine) return null;

          // Day headers
          if (trimmedLine.match(/^(Day\s+\d+|##\s*Day)/i)) {
            return (
              <div key={index} className="flex items-center gap-3 mt-8 first:mt-0">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <MapPin className="w-5 h-5 text-primary" />
                </div>
                <h3 className="text-xl font-display font-semibold text-foreground m-0">
                  {trimmedLine.replace(/^#+\s*/, '')}
                </h3>
              </div>
            );
          }

          // Section headers (Morning, Afternoon, Evening)
          if (trimmedLine.match(/^(Morning|Afternoon|Evening|Night)/i)) {
            return (
              <div key={index} className="flex items-center gap-2 ml-12 mt-4">
                <Clock className="w-4 h-4 text-olive" />
                <h4 className="text-base font-medium text-olive m-0">{trimmedLine}</h4>
              </div>
            );
          }

          // Bullet points
          if (trimmedLine.startsWith('-') || trimmedLine.startsWith('•') || trimmedLine.startsWith('*')) {
            const content = trimmedLine.replace(/^[-•*]\s*/, '');
            const hasFood = /restaurant|eat|food|breakfast|lunch|dinner|café|cafe/i.test(content);
            const hasPhoto = /photo|view|scenic|visit|see|explore/i.test(content);
            const hasTip = /tip|recommend|don't miss|must|should/i.test(content);
            
            const Icon = hasFood ? Utensils : hasPhoto ? Camera : hasTip ? Star : null;
            
            return (
              <div key={index} className="flex items-start gap-3 ml-12">
                {Icon ? (
                  <Icon className="w-4 h-4 text-muted-foreground mt-1 shrink-0" />
                ) : (
                  <div className="w-1.5 h-1.5 rounded-full bg-primary mt-2 shrink-0" />
                )}
                <p className="text-foreground/80 m-0 leading-relaxed">{content}</p>
              </div>
            );
          }

          // Regular text
          return (
            <p key={index} className="text-foreground/80 ml-12 m-0 leading-relaxed">
              {trimmedLine.replace(/^#+\s*/, '')}
            </p>
          );
        })}
      </div>
    </div>
  );
}
