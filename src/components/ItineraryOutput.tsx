import { useState, useEffect, useCallback, useRef } from "react";
import { 
  MapPin, Clock, DollarSign, Utensils, Camera, Star, Plane, Sun, 
  CloudRain, Sparkles, AlertTriangle, ExternalLink, Edit3, Send,
  Mountain, Building, Trees, Tent, Heart, Zap, PartyPopper,
  ChevronDown, ChevronUp, Lightbulb, X, Plus, Loader2, ChevronRight
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

// Section type definitions
type SectionType = 'day' | 'flight' | 'budget' | 'accommodation' | 'timing' | 'summary' | 'nearmiss' | 'alternative' | 'constraints' | 'other';

interface Section {
  id: string;
  type: SectionType;
  title: string;
  headerItem: ItineraryItem;
  items: ItineraryItem[];
  icon: typeof Plane;
  colorClass: string;
  dayNumber?: number;
}

// Detect section type from content
function detectSectionType(content: string): { type: SectionType; title: string } | null {
  const trimmed = content.trim().replace(/^#+\s*/, '');
  
  if (/^(Day\s+\d+|##\s*Day)/i.test(trimmed)) {
    return { type: 'day', title: trimmed.replace(/^Day\s+\d+:?\s*/i, '') };
  }
  if (/^(Flights?|Flight Details|Getting There|Travel Info|Return flight|Outbound flight)/i.test(trimmed)) {
    return { type: 'flight', title: trimmed };
  }
  if (/^(Budget|Cost|Estimated Budget|Daily Budget)/i.test(trimmed)) {
    return { type: 'budget', title: trimmed };
  }
  if (/^(Accommodation|Where to Stay|Hotels?|Lodging)/i.test(trimmed)) {
    return { type: 'accommodation', title: trimmed };
  }
  if (/^(Best Time|When to Visit|Travel Season|Timing)/i.test(trimmed)) {
    return { type: 'timing', title: trimmed };
  }
  if (/^(Trip Summary|Overview|At a Glance)/i.test(trimmed)) {
    return { type: 'summary', title: trimmed };
  }
  if (/^(Near Misses|Almost Included|Alternatives|Swap Options)/i.test(trimmed)) {
    return { type: 'nearmiss', title: trimmed };
  }
  if (/^(Alternative Guided Trips|Other Tours)/i.test(trimmed)) {
    return { type: 'alternative', title: trimmed };
  }
  if (/^(Constraints|Assumptions|Trade-?offs|Notes|Important)/i.test(trimmed)) {
    return { type: 'constraints', title: trimmed };
  }
  return null;
}

function getSectionConfig(type: SectionType, dayNumber?: number) {
  const dayColors = [
    'from-blue-500/20 to-blue-600/10 border-blue-500/30',
    'from-emerald-500/20 to-emerald-600/10 border-emerald-500/30',
    'from-purple-500/20 to-purple-600/10 border-purple-500/30',
    'from-amber-500/20 to-amber-600/10 border-amber-500/30',
    'from-rose-500/20 to-rose-600/10 border-rose-500/30',
    'from-cyan-500/20 to-cyan-600/10 border-cyan-500/30',
    'from-indigo-500/20 to-indigo-600/10 border-indigo-500/30',
  ];
  
  const configs: Record<SectionType, { icon: typeof Plane; colorClass: string }> = {
    day: { 
      icon: MapPin, 
      colorClass: dayNumber ? dayColors[(dayNumber - 1) % dayColors.length] : dayColors[0]
    },
    flight: { icon: Plane, colorClass: 'from-sky-500/10 to-sky-600/5 border-sky-500/20' },
    budget: { icon: DollarSign, colorClass: 'from-emerald-500/10 to-emerald-600/5 border-emerald-500/20' },
    accommodation: { icon: Building, colorClass: 'from-indigo-500/10 to-indigo-600/5 border-indigo-500/20' },
    timing: { icon: Sun, colorClass: 'from-amber-500/10 to-amber-600/5 border-amber-500/20' },
    summary: { icon: Sparkles, colorClass: 'from-primary/10 to-primary/5 border-primary/20' },
    nearmiss: { icon: Lightbulb, colorClass: 'from-amber-500/10 to-amber-600/5 border-amber-500/20' },
    alternative: { icon: MapPin, colorClass: 'from-teal-500/10 to-teal-600/5 border-teal-500/20' },
    constraints: { icon: AlertTriangle, colorClass: 'from-slate-500/10 to-slate-600/5 border-slate-500/20' },
    other: { icon: Star, colorClass: 'from-gray-500/10 to-gray-600/5 border-gray-500/20' },
  };
  
  return configs[type];
}

export function ItineraryOutput({ itinerary, isLoading, onEdit, tripPreferences }: ItineraryOutputProps) {
  const [editMode, setEditMode] = useState(false);
  const [editRequest, setEditRequest] = useState("");
  const [expandedSections, setExpandedSections] = useState<Set<string>>(new Set());
  const [expandedSubsections, setExpandedSubsections] = useState<Set<string>>(new Set());
  const [addingNearMiss, setAddingNearMiss] = useState<string | null>(null);
  const itemRefs = useRef<Record<string, HTMLDivElement | null>>({});

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
    insertItemAfter,
    findItemsInSection,
  } = useItineraryItems(itinerary);

  // Sync items when itinerary changes (streaming updates)
  useEffect(() => {
    if (itinerary) {
      syncWithItinerary(itinerary);
    }
  }, [itinerary, syncWithItinerary]);

  // Auto-expand all sections when items change
  useEffect(() => {
    if (items.length > 0) {
      const sectionIds = new Set<string>();
      const subsectionIds = new Set<string>();
      
      items.forEach((item) => {
        const sectionInfo = detectSectionType(item.content);
        if (sectionInfo) {
          sectionIds.add(item.id);
        }
        // Also expand subsection headers
        const trimmed = item.content.trim();
        if (trimmed.match(/^\*?\*?(Morning|Afternoon|Evening|Night|Meals|Logistics|Getting there|How to book)\*?\*?:?$/i) ||
            trimmed.match(/^\*\*[^*]+\*\*:?$/) ||
            trimmed.match(/^###?\s+/)) {
          subsectionIds.add(item.id);
        }
      });
      
      setExpandedSections(sectionIds);
      setExpandedSubsections(subsectionIds);
    }
  }, [items]);

  const toggleSection = (sectionId: string) => {
    setExpandedSections(prev => {
      const next = new Set(prev);
      if (next.has(sectionId)) {
        next.delete(sectionId);
      } else {
        next.add(sectionId);
      }
      return next;
    });
  };

  const toggleSubsection = (subsectionId: string) => {
    setExpandedSubsections(prev => {
      const next = new Set(prev);
      if (next.has(subsectionId)) {
        next.delete(subsectionId);
      } else {
        next.add(subsectionId);
      }
      return next;
    });
  };

  const handleSubmitEdit = () => {
    if (editRequest.trim() && onEdit) {
      onEdit(editRequest);
      setEditRequest("");
      setEditMode(false);
    }
  };

  // Handle feedback submission for a specific item
  const handleSubmitFeedback = useCallback(async (
    itemId: string,
    overrides?: { vote?: 'up' | 'down' | 'neutral' | null; comment?: string | null }
  ) => {
    const current = getItem(itemId);
    if (!current) return;

    const vote = overrides?.vote ?? current.vote;
    const comment = overrides?.comment ?? current.comment;

    if (!vote && !comment) return;

    if (vote === 'up' && !comment) {
      toast({
        title: "Noted!",
        description: "We'll keep this recommendation.",
      });
      return;
    }

    const shouldUpdate = vote === 'down' || vote === 'neutral' || !!comment;
    if (!shouldUpdate) return;

    if (overrides?.vote !== undefined && overrides.vote !== current.vote) {
      setVote(itemId, overrides.vote as any);
    }
    if (overrides?.comment !== undefined && overrides.comment !== current.comment) {
      setComment(itemId, (overrides.comment ?? '') as any);
    }

    setItemUpdating(itemId, true);

    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/update-itinerary-item`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          itemContent: current.content,
          itemContext: current.context,
          feedback: {
            vote,
            comment,
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
        updateItemContent(itemId, data.updatedContent);
        toast({
          title: "Updated!",
          description: "This recommendation has been refreshed.",
        });
      } else {
        setItemUpdating(itemId, false);
        toast({
          title: "Kept as is",
          description: data.reason || "No changes needed.",
        });
      }
    } catch (error) {
      console.error("Error updating item:", error);
      setItemUpdating(itemId, false);
      toast({
        title: "Couldn't update",
        description: error instanceof Error ? error.message : "Please try again",
        variant: "destructive",
      });
    }
  }, [getItem, itineraryText, tripPreferences, setItemUpdating, updateItemContent, setVote, setComment]);

  // Handle adding a Near Miss item to the itinerary
  const handleAddNearMiss = useCallback(async (nearMissItem: ItineraryItem) => {
    setAddingNearMiss(nearMissItem.id);

    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/add-near-miss`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          nearMissContent: nearMissItem.content,
          fullItinerary: itineraryText,
          tripPreferences: tripPreferences || {},
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to add item");
      }

      const data = await response.json();
      
      if (data.success && data.placement) {
        const { dayNumber, section, insertAfterText, formattedItem } = data.placement;
        
        const sectionItems = findItemsInSection(dayNumber, section);
        
        let afterItemId: string | null = null;
        if (insertAfterText && sectionItems.length > 0) {
          const matchingItem = sectionItems.find(item => 
            item.content.toLowerCase().includes(insertAfterText.toLowerCase().slice(0, 30))
          );
          if (matchingItem) {
            afterItemId = matchingItem.id;
          } else {
            afterItemId = sectionItems[sectionItems.length - 1]?.id || null;
          }
        } else if (sectionItems.length > 0) {
          afterItemId = sectionItems[sectionItems.length - 1].id;
        }

        const context = `Day ${dayNumber} > ${section}`;
        const newItemId = insertItemAfter(afterItemId, formattedItem, context);

        toast({
          title: "Added to itinerary!",
          description: `Added to Day ${dayNumber} - ${section}. Scroll up to see it.`,
        });

        setTimeout(() => {
          const element = itemRefs.current[newItemId];
          if (element) {
            element.scrollIntoView({ behavior: 'smooth', block: 'center' });
            element.classList.add('ring-2', 'ring-primary', 'ring-offset-2');
            setTimeout(() => {
              element.classList.remove('ring-2', 'ring-primary', 'ring-offset-2');
            }, 3000);
          }
        }, 100);
      }
    } catch (error) {
      console.error("Error adding near miss:", error);
      toast({
        title: "Couldn't add item",
        description: error instanceof Error ? error.message : "Please try again",
        variant: "destructive",
      });
    } finally {
      setAddingNearMiss(null);
    }
  }, [itineraryText, tripPreferences, findItemsInSection, insertItemAfter]);

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
        const rawHref = linkMatch[2].trim();

        const makeSearchUrl = (query: string) =>
          `https://www.google.com/search?q=${encodeURIComponent(query)}`;

        const makeGoogleMapsUrl = (query: string) =>
          `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;

        const normalizeUrl = (href: string): string => {
          if (/^(javascript|data):/i.test(href)) return makeSearchUrl(label);

          const withProto = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href) ? href : `https://${href}`;

          try {
            const url = new URL(withProto);

            if (/goo\.gl$/i.test(url.hostname) || /maps\.app\.goo\.gl$/i.test(url.hostname)) {
              return makeGoogleMapsUrl(label);
            }

            if (url.protocol !== 'http:' && url.protocol !== 'https:') {
              return makeSearchUrl(label);
            }

            return url.toString();
          } catch {
            return makeSearchUrl(label);
          }
        };

        const href = normalizeUrl(rawHref);

        const handleClick = (e: React.MouseEvent) => {
          e.preventDefault();
          e.stopPropagation();
          window.open(href, '_blank', 'noopener,noreferrer');
        };

        return (
          <button
            key={i}
            type="button"
            onClick={handleClick}
            className="text-primary underline underline-offset-2 hover:text-primary/80 inline-flex items-center gap-1 cursor-pointer bg-transparent border-none p-0 m-0 font-inherit text-[length:inherit]"
          >
            {label}
            <ExternalLink className="w-3 h-3" />
          </button>
        );
      }
      return part;
    });
  };

  // Group items into sections
  const groupItemsIntoSections = (): Section[] => {
    const sections: Section[] = [];
    let currentSection: Section | null = null;
    let inNearMissSection = false;
    
    for (const item of items) {
      const cleanedLine = cleanLine(item.content);
      const trimmedLine = cleanedLine.trim();
      
      if (!trimmedLine) continue;
      
      const sectionInfo = detectSectionType(trimmedLine);
      
      if (sectionInfo) {
        // Start a new section
        const dayMatch = trimmedLine.match(/Day\s+(\d+)/i);
        const dayNumber = dayMatch ? parseInt(dayMatch[1]) : undefined;
        const config = getSectionConfig(sectionInfo.type, dayNumber);
        
        if (sectionInfo.type === 'nearmiss') {
          inNearMissSection = true;
        } else if (['day', 'flight', 'budget', 'accommodation', 'summary'].includes(sectionInfo.type)) {
          inNearMissSection = false;
        }
        
        currentSection = {
          id: item.id,
          type: sectionInfo.type,
          title: sectionInfo.title || trimmedLine.replace(/^#+\s*/, ''),
          headerItem: item,
          items: [],
          icon: config.icon,
          colorClass: config.colorClass,
          dayNumber,
        };
        sections.push(currentSection);
      } else if (currentSection) {
        // Add item to current section
        currentSection.items.push({ ...item, _inNearMiss: inNearMissSection } as any);
      } else {
        // Items before any section - create an "other" section
        const config = getSectionConfig('other');
        currentSection = {
          id: `other-${item.id}`,
          type: 'other',
          title: 'Overview',
          headerItem: item,
          items: [item],
          icon: config.icon,
          colorClass: config.colorClass,
        };
        sections.push(currentSection);
      }
    }
    
    return sections;
  };

  // Render a bullet item with feedback controls
  const renderBulletItem = (item: ItineraryItem, isNearMissItem: boolean) => {
    const cleanedLine = cleanLine(item.content);
    const trimmedLine = cleanedLine.trim();
    const content = trimmedLine.replace(/^[-•]\s*/, '');
    const activityType = detectActivityType(content);
    const indentLevel = item.indentLevel;
    
    const hasFood = /restaurant|eat|food|breakfast|lunch|dinner|café|cafe|meal|dine|cuisine/i.test(content);
    const hasPhoto = /photo|view|scenic|visit|see|explore|landmark|monument|museum/i.test(content);
    const hasTip = /tip|recommend|don't miss|must|should|pro tip|insider/i.test(content);
    const hasFlight = /flight|airport|airline|depart|arrive|layover/i.test(content);
    const hasWeather = /weather|rain|sun|temperature|climate|season/i.test(content);
    const hasDrink = /bar|brewery|cocktail|beer|wine|drinks?|pub/i.test(content);
    
    const Icon = hasFlight ? Plane : hasFood ? Utensils : hasDrink ? PartyPopper : hasPhoto ? Camera : hasTip ? Star : hasWeather ? CloudRain : null;
    const iconColor = hasFlight ? 'text-sky-500' : hasFood ? 'text-orange-500' : hasDrink ? 'text-violet-500' : hasPhoto ? 'text-blue-500' : hasTip ? 'text-amber-500' : hasWeather ? 'text-cyan-500' : '';
    
    const parsedContent = parseInlineContent(content);
    const marginLeft = 0.5 + (indentLevel * 1);
    
    return (
      <div 
        key={item.id}
        ref={(el) => { itemRefs.current[item.id] = el; }}
        className={cn(
          "flex items-start gap-3 py-2 group hover:bg-muted/30 px-3 rounded-lg transition-all relative",
          item.isUpdating && "opacity-60",
          isNearMissItem && "bg-amber-500/5 border-l-2 border-amber-500/30"
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
        
        {isNearMissItem && (
          <Button
            variant="ghost"
            size="sm"
            className="shrink-0 h-7 px-2 opacity-0 group-hover:opacity-100 transition-opacity bg-amber-500/10 hover:bg-amber-500/20 text-amber-700"
            onClick={() => handleAddNearMiss(item)}
            disabled={addingNearMiss === item.id}
          >
            {addingNearMiss === item.id ? (
              <>
                <Loader2 className="w-3 h-3 mr-1 animate-spin" />
                Adding...
              </>
            ) : (
              <>
                <Plus className="w-3 h-3 mr-1" />
                Add to trip
              </>
            )}
          </Button>
        )}

        {item.type === 'bullet' && !isNearMissItem && (
          <div className="shrink-0 self-center">
            <ItemFeedbackControls
              item={item}
              canUndo={canUndo(item.id)}
              onVote={(vote) => setVote(item.id, vote)}
              onComment={(comment) => setComment(item.id, comment)}
              onSubmitFeedback={(overrides) => handleSubmitFeedback(item.id, overrides)}
              onUndo={() => undoItem(item.id)}
            />
          </div>
        )}
      </div>
    );
  };

  // Render section content (items within a section)
  const renderSectionContent = (section: Section) => {
    const contentItems: React.ReactNode[] = [];
    let currentSubsection: { id: string; title: string; items: ItineraryItem[] } | null = null;
    const subsections: { id: string; title: string; icon: string; items: ItineraryItem[] }[] = [];
    
    for (const item of section.items) {
      const cleanedLine = cleanLine(item.content);
      const trimmedLine = cleanedLine.trim();
      const isNearMissItem = section.type === 'nearmiss' && item.type === 'bullet';
      
      // Check if this is a subsection header
      const timeMatch = trimmedLine.match(/^\*?\*?(Morning|Afternoon|Evening|Night|Meals|Logistics|Getting there|How to book)\*?\*?:?$/i);
      const boldHeaderMatch = trimmedLine.match(/^\*\*([^*]+)\*\*:?$/);
      const hashHeaderMatch = trimmedLine.match(/^###?\s+(.+)/);
      
      if (timeMatch || boldHeaderMatch || hashHeaderMatch) {
        // Save previous subsection
        if (currentSubsection && currentSubsection.items.length > 0) {
          subsections.push({ ...currentSubsection, icon: getTimeIcon(currentSubsection.title) });
        }
        
        const title = timeMatch?.[1] || boldHeaderMatch?.[1] || hashHeaderMatch?.[1] || trimmedLine;
        currentSubsection = {
          id: item.id,
          title: title.replace(/\*\*/g, '').replace(/:$/, ''),
          items: [],
        };
      } else if (currentSubsection) {
        currentSubsection.items.push({ ...item, _inNearMiss: isNearMissItem } as any);
      } else {
        // Items not in any subsection
        if (trimmedLine.startsWith('-') || trimmedLine.startsWith('•')) {
          contentItems.push(renderBulletItem(item, isNearMissItem));
        } else if (trimmedLine) {
          contentItems.push(
            <p key={item.id} className="text-foreground/80 leading-relaxed py-1 ml-2">
              {parseInlineContent(trimmedLine.replace(/^#+\s*/, ''))}
            </p>
          );
        }
      }
    }
    
    // Don't forget the last subsection
    if (currentSubsection && currentSubsection.items.length > 0) {
      subsections.push({ ...currentSubsection, icon: getTimeIcon(currentSubsection.title) });
    }
    
    // Render subsections as collapsible
    const subsectionNodes = subsections.map((sub) => (
      <Collapsible 
        key={sub.id} 
        open={expandedSubsections.has(sub.id)}
        onOpenChange={() => toggleSubsection(sub.id)}
      >
        <CollapsibleTrigger className="w-full">
          <div className="flex items-center gap-3 mt-4 mb-2 hover:bg-muted/30 rounded-lg px-2 py-1.5 transition-colors">
            <span className="text-lg">{sub.icon}</span>
            <h4 className="text-sm font-semibold text-foreground uppercase tracking-wide flex-1 text-left">
              {sub.title}
            </h4>
            <ChevronRight className={cn(
              "w-4 h-4 text-muted-foreground transition-transform",
              expandedSubsections.has(sub.id) && "rotate-90"
            )} />
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="ml-2 border-l-2 border-muted pl-4 space-y-1">
            {sub.items.map((subItem) => {
              const cleanedSubLine = cleanLine(subItem.content);
              const trimmedSubLine = cleanedSubLine.trim();
              const isNearMiss = (subItem as any)._inNearMiss || false;
              
              if (trimmedSubLine.startsWith('-') || trimmedSubLine.startsWith('•')) {
                return renderBulletItem(subItem, isNearMiss);
              }
              if (trimmedSubLine) {
                return (
                  <p key={subItem.id} className="text-foreground/80 leading-relaxed py-1">
                    {parseInlineContent(trimmedSubLine.replace(/^#+\s*/, ''))}
                  </p>
                );
              }
              return null;
            })}
          </div>
        </CollapsibleContent>
      </Collapsible>
    ));
    
    return (
      <>
        {contentItems}
        {subsectionNodes}
      </>
    );
  };

  const getTimeIcon = (title: string): string => {
    const lower = title.toLowerCase();
    const timeIcons: Record<string, string> = {
      'morning': '🌅',
      'afternoon': '☀️',
      'evening': '🌆',
      'night': '🌙',
      'meals': '🍽️',
      'logistics': '🚃',
      'getting there': '🚃',
      'how to book': '📱',
      'theme': '🎨',
      'book first': '📋',
      'return flight': '✈️',
      'outbound flight': '✈️',
    };
    return Object.entries(timeIcons).find(([k]) => lower.includes(k))?.[1] || '📍';
  };

  const sections = groupItemsIntoSections();

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

      {/* Collapsible sections */}
      <div className="space-y-4">
        {sections.map((section) => {
          const Icon = section.icon;
          const isExpanded = expandedSections.has(section.id);
          const displayTitle = section.type === 'day' 
            ? `Day ${section.dayNumber}${section.title ? `: ${section.title}` : ''}`
            : section.title;
          
          return (
            <Collapsible 
              key={section.id} 
              open={isExpanded}
              onOpenChange={() => toggleSection(section.id)}
            >
              <CollapsibleTrigger className="w-full">
                <div className={cn(
                  "p-4 rounded-xl bg-gradient-to-r border transition-all hover:shadow-md cursor-pointer",
                  section.colorClass
                )}>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-3">
                      {section.type === 'day' ? (
                        <div className="w-10 h-10 rounded-full bg-background/80 flex items-center justify-center shadow-sm">
                          <span className="text-lg font-bold text-primary">{section.dayNumber}</span>
                        </div>
                      ) : (
                        <Icon className="w-5 h-5" />
                      )}
                      <h3 className="text-lg font-display font-semibold text-foreground text-left">
                        {displayTitle}
                      </h3>
                    </div>
                    <ChevronDown className={cn(
                      "w-5 h-5 text-muted-foreground transition-transform",
                      isExpanded && "rotate-180"
                    )} />
                  </div>
                </div>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <div className="mt-2 ml-4 pl-4 border-l-2 border-muted space-y-1">
                  {renderSectionContent(section)}
                </div>
              </CollapsibleContent>
            </Collapsible>
          );
        })}
      </div>
    </div>
  );
}
