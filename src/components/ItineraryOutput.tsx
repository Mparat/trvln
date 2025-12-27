import { useState, type MouseEvent } from "react";
import { 
  MapPin, Clock, DollarSign, Utensils, Camera, Star, Plane, Sun, 
  CloudRain, Sparkles, AlertTriangle, ExternalLink, Edit3, Send,
  Mountain, Building, Trees, Tent, Heart, Zap, PartyPopper,
  ChevronDown, ChevronUp, Lightbulb, X
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

interface ItineraryOutputProps {
  itinerary: string;
  isLoading: boolean;
  onEdit?: (editRequest: string) => void;
}

// Activity type detection and tagging
const activityTypes = {
  nature: { label: 'Nature', icon: Mountain, color: 'bg-emerald-500/10 text-emerald-700 border-emerald-500/20' },
  culture: { label: 'Culture', icon: Building, color: 'bg-purple-500/10 text-purple-700 border-purple-500/20' },
  food: { label: 'Food', icon: Utensils, color: 'bg-orange-500/10 text-orange-700 border-orange-500/20' },
  adventure: { label: 'Adventure', icon: Zap, color: 'bg-red-500/10 text-red-700 border-red-500/20' },
  photo: { label: 'Photo Op', icon: Camera, color: 'bg-blue-500/10 text-blue-700 border-blue-500/20' },
  relaxation: { label: 'Relaxation', icon: Heart, color: 'bg-pink-500/10 text-pink-700 border-pink-500/20' },
  nightlife: { label: 'Nightlife', icon: PartyPopper, color: 'bg-violet-500/10 text-violet-700 border-violet-500/20' },
};

function detectActivityType(content: string): keyof typeof activityTypes | null {
  const lower = content.toLowerCase();
  if (/hike|trail|mountain|waterfall|beach|ocean|lake|forest|park|garden|nature|scenic|view/i.test(lower)) return 'nature';
  if (/temple|shrine|museum|palace|castle|historic|ancient|monument|art|gallery|cathedral/i.test(lower)) return 'culture';
  if (/restaurant|eat|food|breakfast|lunch|dinner|café|cafe|meal|dine|cuisine|bar|bistro|market/i.test(lower)) return 'food';
  if (/adventure|climb|kayak|surf|dive|zip|bungee|raft|extreme|sport/i.test(lower)) return 'adventure';
  if (/photo|instagram|view|scenic|sunset|sunrise|landmark|iconic/i.test(lower)) return 'photo';
  if (/spa|massage|relax|beach|pool|resort|rest/i.test(lower)) return 'relaxation';
  if (/club|party|nightlife|bar|dancing|drink/i.test(lower)) return 'nightlife';
  return null;
}

function ActivityTag({ type }: { type: keyof typeof activityTypes }) {
  const config = activityTypes[type];
  const Icon = config.icon;
  return (
    <Badge variant="outline" className={cn("gap-1 text-xs", config.color)}>
      <Icon className="w-3 h-3" />
      {config.label}
    </Badge>
  );
}

export function ItineraryOutput({ itinerary, isLoading, onEdit }: ItineraryOutputProps) {
  const [editMode, setEditMode] = useState(false);
  const [editRequest, setEditRequest] = useState("");
  const [showNearMisses, setShowNearMisses] = useState(false);

  const handleSubmitEdit = () => {
    if (editRequest.trim() && onEdit) {
      onEdit(editRequest);
      setEditRequest("");
      setEditMode(false);
    }
  };

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

  // Clean up asterisks - convert bold markers to special tokens, then remove all remaining asterisks
  const cleanLine = (line: string): string => {
    let cleaned = line;
    // Remove leading asterisks used as bullets (replace with proper dash)
    cleaned = cleaned.replace(/^\s*\*\s+/, '- ');
    // Protect links first - convert [text](url) to special tokens
    cleaned = cleaned.replace(/\[([^\]]+)\]\(([^)]+)\)/g, 'LINKSTART$1LINKMID$2LINKEND');
    // Convert **bold** to a special marker we can parse later
    cleaned = cleaned.replace(/\*\*([^*]+)\*\*/g, 'BOLDSTART$1BOLDEND');
    // Remove ALL remaining asterisks
    cleaned = cleaned.replace(/\*/g, '');
    // Convert markers back to original format for parsing
    cleaned = cleaned.replace(/BOLDSTART/g, '**').replace(/BOLDEND/g, '**');
    cleaned = cleaned.replace(/LINKSTART/g, '[').replace(/LINKMID/g, '](').replace(/LINKEND/g, ')');
    return cleaned;
  };

  // Parse bold text and links into React elements
  const parseInlineContent = (content: string) => {
    return content.split(/(\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/g).map((part, i) => {
      if (part.startsWith('**') && part.endsWith('**')) {
        return (
          <strong key={i} className="font-semibold text-foreground">
            {part.slice(2, -2)}
          </strong>
        );
      }

      const linkMatch = part.match(/\[([^\]]+)\]\(([^)]+)\)/);
      if (linkMatch) {
        const label = linkMatch[1];
        const rawHref = linkMatch[2];

        const isMapsShort = /(^|\/\/)(maps\.app\.goo\.gl|goo\.gl\/maps)(\/|$)/i.test(rawHref);
        const isGoogleMaps = /(^|\/\/)(www\.)?google\.com\/maps/i.test(rawHref);
        const isGoogleFlights = /(^|\/\/)(www\.)?google\.com\/flights/i.test(rawHref);

        // Prefer non-Google destinations in the preview environment where google.com may be blocked.
        // - Maps: use OpenStreetMap search
        // - Flights: use Kayak
        const href = isMapsShort || isGoogleMaps
          ? `https://www.openstreetmap.org/search?query=${encodeURIComponent(label)}`
          : isGoogleFlights
            ? 'https://www.kayak.com/flights'
            : rawHref;

        const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
          e.preventDefault();
          window.open(href, '_blank', 'noopener,noreferrer');
        };

        return (
          <button
            key={i}
            onClick={handleClick}
            className="text-primary underline underline-offset-2 hover:text-primary/80 inline-flex items-center gap-1 cursor-pointer bg-transparent border-none p-0 font-inherit text-inherit"
            type="button"
          >
            {label}
            <ExternalLink className="w-3 h-3" />
          </button>
        );
      }
      return part;
    });
  };

  // Detect indentation level (for nested bullets)
  const getIndentLevel = (line: string): number => {
    const match = line.match(/^(\s*)/);
    if (!match) return 0;
    return Math.floor(match[1].length / 2);
  };

  const lines = itinerary.split('\n');
  let currentDay = 0;
  let inNearMisses = false;
  let inConstraints = false;
  
  const renderContent = () => {
    return lines.map((line, index) => {
      const cleanedLine = cleanLine(line);
      const trimmedLine = cleanedLine.trim();
      const indentLevel = getIndentLevel(line);
      
      if (!trimmedLine) return null;

      // Detect Alternative Guided Trips section
      if (trimmedLine.match(/^(##\s*)?(Alternative Guided Trips|Other Tours)/i)) {
        inNearMisses = false;
        return (
          <div key={index} className="mt-6 p-4 bg-gradient-to-r from-teal-500/10 to-teal-600/5 rounded-xl border border-teal-500/20">
            <div className="flex items-center gap-2">
              <MapPin className="w-5 h-5 text-teal-600" />
              <h3 className="text-lg font-display font-semibold text-foreground">
                {trimmedLine.replace(/^#+\s*/, '')}
              </h3>
            </div>
          </div>
        );
      }

      // Detect near-misses section
      if (trimmedLine.match(/^(##\s*)?(Near Misses|Almost Included|Alternatives|Swap Options)/i)) {
        inNearMisses = true;
        return (
          <Collapsible key={index} open={showNearMisses} onOpenChange={setShowNearMisses}>
            <CollapsibleTrigger className="w-full mt-8">
              <div className="p-4 bg-gradient-to-r from-amber-500/10 to-amber-600/5 rounded-xl border border-amber-500/20 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Lightbulb className="w-5 h-5 text-amber-600" />
                  <h3 className="text-lg font-display font-semibold text-foreground">
                    {trimmedLine.replace(/^#+\s*/, '')}
                  </h3>
                </div>
                {showNearMisses ? <ChevronUp className="w-5 h-5" /> : <ChevronDown className="w-5 h-5" />}
              </div>
            </CollapsibleTrigger>
            <CollapsibleContent className="mt-2 ml-4">
              {/* Near misses content will be rendered in subsequent lines */}
            </CollapsibleContent>
          </Collapsible>
        );
      }

      // Constraints/Assumptions section
      if (trimmedLine.match(/^(##\s*)?(Constraints|Assumptions|Trade-?offs|Notes|Important)/i)) {
        inConstraints = true;
        return (
          <div key={index} className="mt-6 p-4 bg-gradient-to-r from-slate-500/10 to-slate-600/5 rounded-xl border border-slate-500/20">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-slate-600" />
              <h3 className="text-lg font-display font-semibold text-foreground">
                {trimmedLine.replace(/^#+\s*/, '')}
              </h3>
            </div>
          </div>
        );
      }

      // Trip Summary section
      if (trimmedLine.match(/^(##\s*)?(Trip Summary|Overview|At a Glance)/i)) {
        return (
          <div key={index} className="p-4 bg-gradient-to-r from-primary/10 to-primary/5 rounded-xl border border-primary/20">
            <div className="flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-primary" />
              <h3 className="text-lg font-display font-semibold text-foreground">
                {trimmedLine.replace(/^#+\s*/, '')}
              </h3>
            </div>
          </div>
        );
      }

      // Day headers
      if (trimmedLine.match(/^(Day\s+\d+|##\s*Day)/i)) {
        currentDay++;
        inNearMisses = false;
        inConstraints = false;
        const dayColors = [
          'from-blue-500/20 to-blue-600/10 border-blue-500/30',
          'from-emerald-500/20 to-emerald-600/10 border-emerald-500/30',
          'from-purple-500/20 to-purple-600/10 border-purple-500/30',
          'from-amber-500/20 to-amber-600/10 border-amber-500/30',
          'from-rose-500/20 to-rose-600/10 border-rose-500/30',
          'from-cyan-500/20 to-cyan-600/10 border-cyan-500/30',
          'from-indigo-500/20 to-indigo-600/10 border-indigo-500/30',
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
        inNearMisses = false;
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
        inNearMisses = false;
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
        inNearMisses = false;
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

      // Accommodation section
      if (trimmedLine.match(/^(##\s*)?(Accommodation|Where to Stay|Hotels?|Lodging)/i)) {
        inNearMisses = false;
        return (
          <div key={index} className="mt-6 p-4 bg-gradient-to-r from-indigo-500/10 to-indigo-600/5 rounded-xl border border-indigo-500/20">
            <div className="flex items-center gap-2">
              <Building className="w-5 h-5 text-indigo-600" />
              <h3 className="text-lg font-display font-semibold text-foreground">
                {trimmedLine.replace(/^#+\s*/, '')}
              </h3>
            </div>
          </div>
        );
      }

      // Section headers (Morning, Afternoon, Evening, Meals, Logistics, etc.)
      if (trimmedLine.match(/^\*?\*?(Morning|Afternoon|Evening|Night|Meals|Logistics|Getting there|How to book)\*?\*?:?$/i)) {
        const timeIcons: Record<string, string> = {
          'morning': '🌅',
          'afternoon': '☀️',
          'evening': '🌆',
          'night': '🌙',
          'meals': '🍽️',
          'logistics': '🚃',
          'getting there': '🚃',
          'how to book': '📱',
        };
        const cleanedLine = trimmedLine.replace(/\*\*/g, '').replace(/:$/, '').toLowerCase();
        const timeKey = Object.keys(timeIcons).find(k => cleanedLine.includes(k)) || '';
        
        return (
          <div key={index} className="flex items-center gap-3 ml-4 mt-5 mb-2">
            <span className="text-lg">{timeIcons[timeKey] || '📍'}</span>
            <h4 className="text-sm font-semibold text-foreground uppercase tracking-wide">{trimmedLine.replace(/\*\*/g, '')}</h4>
            <div className="flex-1 h-px bg-border" />
          </div>
        );
      }

      // Bold section headers like **Theme:** or **Book First**
      if (trimmedLine.match(/^\*\*[^*]+\*\*:?$/)) {
        const headerText = trimmedLine.replace(/\*\*/g, '').replace(/:$/, '');
        return (
          <h4 key={index} className="text-base font-semibold text-foreground mt-4 mb-2 ml-4">
            {headerText}
          </h4>
        );
      }

      // Bullet points with activity tags and nested indentation
      if (trimmedLine.startsWith('-') || trimmedLine.startsWith('•')) {
        const content = trimmedLine.replace(/^[-•]\s*/, '');
        const activityType = detectActivityType(content);
        const hasFood = /restaurant|eat|food|breakfast|lunch|dinner|café|cafe|meal|dine|cuisine/i.test(content);
        const hasPhoto = /photo|view|scenic|visit|see|explore|landmark|monument|museum/i.test(content);
        const hasTip = /tip|recommend|don't miss|must|should|pro tip|insider/i.test(content);
        const hasFlight = /flight|airport|airline|depart|arrive|layover/i.test(content);
        const hasWeather = /weather|rain|sun|temperature|climate|season/i.test(content);
        const hasDrink = /bar|brewery|cocktail|beer|wine|drinks?|pub/i.test(content);
        
        const Icon = hasFlight ? Plane : hasFood ? Utensils : hasDrink ? PartyPopper : hasPhoto ? Camera : hasTip ? Star : hasWeather ? CloudRain : null;
        const iconColor = hasFlight ? 'text-sky-500' : hasFood ? 'text-orange-500' : hasDrink ? 'text-violet-500' : hasPhoto ? 'text-blue-500' : hasTip ? 'text-amber-500' : hasWeather ? 'text-cyan-500' : '';
        
        // Parse bold text and links using shared function
        const parsedContent = parseInlineContent(content);

        // Calculate left margin based on indent level
        const marginLeft = 1.5 + (indentLevel * 1); // base 1.5rem + 1rem per indent level
        
        return (
          <div 
            key={index} 
            className="flex items-start gap-3 py-2 group hover:bg-muted/30 px-3 -mx-3 rounded-lg transition-colors"
            style={{ marginLeft: `${marginLeft}rem` }}
          >
            {Icon ? (
              <Icon className={cn("w-4 h-4 mt-1 shrink-0", iconColor)} />
            ) : (
              <div className={cn(
                "rounded-full mt-2 shrink-0",
                indentLevel === 0 ? "w-2 h-2 bg-primary/60" : "w-1.5 h-1.5 bg-muted-foreground/40"
              )} />
            )}
            <div className="flex-1">
              <p className="text-foreground/90 leading-relaxed">{parsedContent}</p>
              {activityType && indentLevel === 0 && (
                <div className="mt-1">
                  <ActivityTag type={activityType} />
                </div>
              )}
            </div>
          </div>
        );
      }

      // Regular text (could be sub-headers or descriptions)
      const isSubHeader = trimmedLine.match(/^###?\s+/);
      if (isSubHeader) {
        const headerContent = trimmedLine.replace(/^#+\s*/, '');
        return (
          <h4 key={index} className="text-base font-medium text-foreground mt-4 mb-2 ml-4">
            {parseInlineContent(headerContent)}
          </h4>
        );
      }

      // Regular text - parse links and bold
      const textContent = trimmedLine.replace(/^#+\s*/, '');
      
      return (
        <p key={index} className="text-foreground/80 ml-6 leading-relaxed py-1">
          {parseInlineContent(textContent)}
        </p>
      );
    });
  };

  return (
    <div className="space-y-6">
      {/* Edit functionality */}
      {onEdit && (
        <Card className="p-4 bg-muted/30 border-dashed">
          {editMode ? (
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h4 className="text-sm font-medium text-foreground flex items-center gap-2">
                  <Edit3 className="w-4 h-4" />
                  Request changes
                </h4>
                <Button variant="ghost" size="sm" onClick={() => setEditMode(false)}>
                  <X className="w-4 h-4" />
                </Button>
              </div>
              <Textarea
                value={editRequest}
                onChange={(e) => setEditRequest(e.target.value)}
                placeholder="e.g., 'Add more restaurant options for Day 2' or 'Swap the museum visit with a hiking trip'"
                className="min-h-[80px] resize-none"
              />
              <Button onClick={handleSubmitEdit} disabled={!editRequest.trim()} className="gap-2">
                <Send className="w-4 h-4" />
                Update Itinerary
              </Button>
            </div>
          ) : (
            <Button 
              variant="outline" 
              className="w-full gap-2" 
              onClick={() => setEditMode(true)}
            >
              <Edit3 className="w-4 h-4" />
              Edit this itinerary
            </Button>
          )}
        </Card>
      )}

      {/* Itinerary content */}
      <div className="animate-fade-in">
        {renderContent()}
      </div>
    </div>
  );
}
