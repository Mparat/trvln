import { useState, useEffect, useCallback, type MouseEvent } from "react";
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
import { ItemFeedbackControls } from "./ItemFeedbackControls";
import { useItineraryItems, type ItineraryItem } from "@/hooks/useItineraryItems";
import { toast } from "@/hooks/use-toast";

interface ItineraryOutputProps {
  itinerary: string;
  isLoading: boolean;
  onEdit?: (editRequest: string) => void;
  tripPreferences?: {
    cities?: string[];
    atmosphere?: string[];
    interests?: string[];
    budgetAccommodation?: number;
  };
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

export function ItineraryOutput({ itinerary, isLoading, onEdit, tripPreferences }: ItineraryOutputProps) {
  const [editMode, setEditMode] = useState(false);
  const [editRequest, setEditRequest] = useState("");
  const [showNearMisses, setShowNearMisses] = useState(false);

  const {
    items,
    syncWithItinerary,
    setVote,
    setComment,
    updateItemContent,
    undoItem,
    setItemUpdating,
    canUndo,
    getItem,
    itineraryText,
  } = useItineraryItems(itinerary);

  // Sync items when itinerary changes (streaming updates)
  useEffect(() => {
    if (itinerary) {
      syncWithItinerary(itinerary);
    }
  }, [itinerary, syncWithItinerary]);

  const handleSubmitEdit = () => {
    if (editRequest.trim() && onEdit) {
      onEdit(editRequest);
      setEditRequest("");
      setEditMode(false);
    }
  };

  // Handle feedback submission for a specific item
  const handleSubmitFeedback = useCallback(async (itemId: string) => {
    const item = getItem(itemId);
    if (!item) return;

    // Need either a vote or a comment to submit
    if (!item.vote && !item.comment) return;

    // Upvotes without comments don't need an API call - just acknowledge
    if (item.vote === 'up' && !item.comment) {
      toast({
        title: "Noted!",
        description: "We'll keep this recommendation.",
      });
      return;
    }

    // If only upvote with comment, still trigger update based on comment
    const shouldUpdate = item.vote === 'down' || item.vote === 'neutral' || !!item.comment;
    if (!shouldUpdate) return;

    setItemUpdating(item.id, true);

    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/update-itinerary-item`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          itemContent: item.content,
          itemContext: item.context,
          feedback: {
            vote: item.vote,
            comment: item.comment,
          },
          fullItinerary: itineraryText,
          tripPreferences: tripPreferences || {},
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to update item");
      }

      const data = await response.json();

      if (data.changed) {
        updateItemContent(item.id, data.updatedContent);
        toast({
          title: "Updated!",
          description: "This recommendation has been refreshed.",
        });
      } else {
        setItemUpdating(item.id, false);
        toast({
          title: "Kept as is",
          description: data.reason || "No changes needed.",
        });
      }
    } catch (error) {
      console.error("Error updating item:", error);
      setItemUpdating(item.id, false);
      toast({
        title: "Couldn't update",
        description: error instanceof Error ? error.message : "Please try again",
        variant: "destructive",
      });
    }
  }, [getItem, itineraryText, tripPreferences, setItemUpdating, updateItemContent]);

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

  // Clean up asterisks
  const cleanLine = (line: string): string => {
    let cleaned = line;
    cleaned = cleaned.replace(/^\s*\*\s+/, '- ');
    cleaned = cleaned.replace(/\[([^\]]+)\]\(([^)]+)\)/g, 'LINKSTART$1LINKMID$2LINKEND');
    cleaned = cleaned.replace(/\*\*([^*]+)\*\*/g, 'BOLDSTART$1BOLDEND');
    cleaned = cleaned.replace(/\*/g, '');
    cleaned = cleaned.replace(/BOLDSTART/g, '**').replace(/BOLDEND/g, '**');
    cleaned = cleaned.replace(/LINKSTART/g, '[').replace(/LINKMID/g, '](').replace(/LINKEND/g, ')');
    return cleaned;
  };

  // Parse inline content
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
        const href = isMapsShort
          ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(label)}`
          : rawHref;

        const handleClick = (e: MouseEvent<HTMLButtonElement>) => {
          e.preventDefault();
          e.stopPropagation();
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

  const getIndentLevel = (line: string): number => {
    const match = line.match(/^(\s*)/);
    if (!match) return 0;
    return Math.floor(match[1].length / 2);
  };

  // Render a single itinerary item with feedback controls
  const renderItemWithFeedback = (item: ItineraryItem, index: number) => {
    const cleanedLine = cleanLine(item.content);
    const trimmedLine = cleanedLine.trim();
    const indentLevel = item.indentLevel;

    if (!trimmedLine) return null;

    // Check if this item type should have feedback controls
    const canHaveFeedback = item.type === 'bullet';

    // Detect Alternative Guided Trips section
    if (trimmedLine.match(/^(##\s*)?(Alternative Guided Trips|Other Tours)/i)) {
      return (
        <div key={item.id} className="mt-6 p-4 bg-gradient-to-r from-teal-500/10 to-teal-600/5 rounded-xl border border-teal-500/20">
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
      return (
        <Collapsible key={item.id} open={showNearMisses} onOpenChange={setShowNearMisses}>
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
          <CollapsibleContent className="mt-2 ml-4" />
        </Collapsible>
      );
    }

    // Constraints/Assumptions section
    if (trimmedLine.match(/^(##\s*)?(Constraints|Assumptions|Trade-?offs|Notes|Important)/i)) {
      return (
        <div key={item.id} className="mt-6 p-4 bg-gradient-to-r from-slate-500/10 to-slate-600/5 rounded-xl border border-slate-500/20">
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
        <div key={item.id} className="p-4 bg-gradient-to-r from-primary/10 to-primary/5 rounded-xl border border-primary/20">
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
      const dayMatch = trimmedLine.match(/Day\s+(\d+)/i);
      const dayNum = dayMatch ? parseInt(dayMatch[1]) : index;
      const dayColors = [
        'from-blue-500/20 to-blue-600/10 border-blue-500/30',
        'from-emerald-500/20 to-emerald-600/10 border-emerald-500/30',
        'from-purple-500/20 to-purple-600/10 border-purple-500/30',
        'from-amber-500/20 to-amber-600/10 border-amber-500/30',
        'from-rose-500/20 to-rose-600/10 border-rose-500/30',
        'from-cyan-500/20 to-cyan-600/10 border-cyan-500/30',
        'from-indigo-500/20 to-indigo-600/10 border-indigo-500/30',
      ];
      const colorClass = dayColors[(dayNum - 1) % dayColors.length];
      
      return (
        <div 
          key={item.id} 
          className={cn("mt-8 first:mt-0 p-4 rounded-xl bg-gradient-to-r border", colorClass)}
        >
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-full bg-background/80 flex items-center justify-center shadow-sm">
              <span className="text-lg font-bold text-primary">{dayNum}</span>
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
        <div key={item.id} className="mt-6 p-4 bg-gradient-to-r from-sky-500/10 to-sky-600/5 rounded-xl border border-sky-500/20">
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
        <div key={item.id} className="mt-6 p-4 bg-gradient-to-r from-amber-500/10 to-amber-600/5 rounded-xl border border-amber-500/20">
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
        <div key={item.id} className="mt-6 p-4 bg-gradient-to-r from-emerald-500/10 to-emerald-600/5 rounded-xl border border-emerald-500/20">
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
      return (
        <div key={item.id} className="mt-6 p-4 bg-gradient-to-r from-indigo-500/10 to-indigo-600/5 rounded-xl border border-indigo-500/20">
          <div className="flex items-center gap-2">
            <Building className="w-5 h-5 text-indigo-600" />
            <h3 className="text-lg font-display font-semibold text-foreground">
              {trimmedLine.replace(/^#+\s*/, '')}
            </h3>
          </div>
        </div>
      );
    }

    // Section headers (Morning, Afternoon, etc.)
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
      const cleanedSectionLine = trimmedLine.replace(/\*\*/g, '').replace(/:$/, '').toLowerCase();
      const timeKey = Object.keys(timeIcons).find(k => cleanedSectionLine.includes(k)) || '';
      
      return (
        <div key={item.id} className="flex items-center gap-3 ml-4 mt-5 mb-2">
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
        <h4 key={item.id} className="text-base font-semibold text-foreground mt-4 mb-2 ml-4">
          {headerText}
        </h4>
      );
    }

    // Bullet points with activity tags and feedback controls
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
      
      const parsedContent = parseInlineContent(content);
      const marginLeft = 1.5 + (indentLevel * 1);
      
      return (
        <div 
          key={item.id} 
          className={cn(
            "flex items-start gap-3 py-2 group hover:bg-muted/30 px-3 -mx-3 rounded-lg transition-colors relative",
            item.isUpdating && "opacity-60"
          )}
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
          <div className="flex-1 min-w-0">
            <p className="text-foreground/90 leading-relaxed">{parsedContent}</p>
            {activityType && indentLevel === 0 && (
              <div className="mt-1">
                <ActivityTag type={activityType} />
              </div>
            )}
            {item.comment && !item.isUpdating && (
              <div className="mt-2 text-xs text-muted-foreground bg-muted/50 px-2 py-1 rounded">
                💬 {item.comment}
              </div>
            )}
          </div>
          
          {/* Feedback controls - show on hover for bullet items */}
          {canHaveFeedback && (
            <div className="shrink-0 self-center">
              <ItemFeedbackControls
                item={item}
                canUndo={canUndo(item.id)}
                onVote={(vote) => setVote(item.id, vote)}
                onComment={(comment) => setComment(item.id, comment)}
                onSubmitFeedback={() => handleSubmitFeedback(item.id)}
                onUndo={() => undoItem(item.id)}
              />
            </div>
          )}
        </div>
      );
    }

    // Regular text
    const isSubHeader = trimmedLine.match(/^###?\s+/);
    if (isSubHeader) {
      const headerContent = trimmedLine.replace(/^#+\s*/, '');
      return (
        <h4 key={item.id} className="text-base font-medium text-foreground mt-4 mb-2 ml-4">
          {parseInlineContent(headerContent)}
        </h4>
      );
    }

    const textContent = trimmedLine.replace(/^#+\s*/, '');
    
    return (
      <p key={item.id} className="text-foreground/80 ml-6 leading-relaxed py-1">
        {parseInlineContent(textContent)}
      </p>
    );
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
                <Button 
                  variant="ghost" 
                  size="sm"
                  onClick={() => setEditMode(false)}
                >
                  <X className="w-4 h-4" />
                </Button>
              </div>
              <Textarea
                value={editRequest}
                onChange={(e) => setEditRequest(e.target.value)}
                placeholder="e.g., 'Add more food options' or 'Replace day 2 with beach activities'"
                className="min-h-[80px] resize-none"
              />
              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => setEditMode(false)}>
                  Cancel
                </Button>
                <Button size="sm" onClick={handleSubmitEdit} disabled={!editRequest.trim()}>
                  <Send className="w-4 h-4 mr-2" />
                  Submit
                </Button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => setEditMode(true)}
              className="w-full flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors py-2"
            >
              <Edit3 className="w-4 h-4" />
              <span>Want to make changes? Click here or hover over items to give feedback</span>
            </button>
          )}
        </Card>
      )}

      {/* Itinerary content with feedback controls */}
      <div className="space-y-1">
        {items.map((item, index) => renderItemWithFeedback(item, index))}
      </div>
    </div>
  );
}
