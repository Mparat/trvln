import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { 
  MapPin, Clock, DollarSign, Utensils, Camera, Star, Plane, Sun, 
  CloudRain, Sparkles, AlertTriangle, ExternalLink, Edit3, Send,
  Mountain, Building, Trees, Tent, Heart, Zap, PartyPopper,
  Lightbulb, X, Plus, Loader2, ChevronDown
} from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Textarea } from "@/components/ui/textarea";
import { Card } from "@/components/ui/card";
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
  const [addingNearMiss, setAddingNearMiss] = useState<string | null>(null);
  const [inNearMissSection, setInNearMissSection] = useState(false);
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    'EXECUTIVE SUMMARY': true,
    'KEY BOOKINGS & BUDGET': true,
    'DAY-BY-DAY ITINERARY': true,
    'ALTERNATIVES & ADDITIONAL OPTIONS': true,
  });
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

  // Main section headers for collapsible sections
  const mainSectionHeaders = [
    'EXECUTIVE SUMMARY',
    'KEY BOOKINGS & BUDGET',
    'DAY-BY-DAY ITINERARY',
    'ALTERNATIVES & ADDITIONAL OPTIONS'
  ];

  const isMainSectionHeader = (content: string): string | null => {
    const trimmed = content.trim().replace(/^#+\s*/, '').replace(/\*\*/g, '');
    for (const header of mainSectionHeaders) {
      if (trimmed.toUpperCase().includes(header)) {
        return header;
      }
    }
    return null;
  };

  // Check if a line is a section header
  const isSectionHeader = (content: string): boolean => {
    const trimmed = content.trim().replace(/^#+\s*/, '');
    return /^(Day\s+\d+|Flights?|Flight Details|Getting There|Travel Info|Return flight|Outbound flight|Budget|Cost|Estimated Budget|Accommodation|Where to Stay|Hotels?|Best Time|When to Visit|Trip Summary|Overview|Near Misses|Almost Included|Alternatives|Alternative Guided Trips|Constraints|Assumptions|Trade-?offs|Notes|Important)/i.test(trimmed);
  };

  // Check if a line is a near miss section
  const isNearMissHeader = (content: string): boolean => {
    const trimmed = content.trim().replace(/^#+\s*/, '');
    return /^(Near Misses|Almost Included|Alternatives|Swap Options)/i.test(trimmed);
  };

  // Check if entering a new major section (resets near miss tracking)
  const isNewMajorSection = (content: string): boolean => {
    const trimmed = content.trim().replace(/^#+\s*/, '');
    return /^(Day\s+\d+|Flights?|Budget|Accommodation|Trip Summary)/i.test(trimmed);
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
          
          // Use postMessage to tell parent frame to open URL externally
          if (window.parent && window.parent !== window) {
            window.parent.postMessage(
              { type: 'OPEN_EXTERNAL_URL', url: href },
              '*'
            );
          } else {
            window.open(href, '_blank', 'noopener,noreferrer');
          }
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

  // Group items by main sections - MUST be before early returns
  const groupedSections = useMemo(() => {
    const sections: { header: string; items: typeof items }[] = [];
    let currentSection: { header: string; items: typeof items } | null = null;
    let preItems: typeof items = [];

    items.forEach((item) => {
      const cleanedLine = cleanLine(item.content);
      const trimmedLine = cleanedLine.trim();
      
      if (!trimmedLine) return;

      const mainHeader = isMainSectionHeader(trimmedLine);
      if (mainHeader) {
        if (currentSection) {
          sections.push(currentSection);
        } else if (preItems.length > 0) {
          sections.push({ header: '', items: preItems });
          preItems = [];
        }
        currentSection = { header: mainHeader, items: [] };
      } else if (currentSection) {
        currentSection.items.push(item);
      } else {
        preItems.push(item);
      }
    });

    if (currentSection) {
      sections.push(currentSection);
    }
    if (preItems.length > 0) {
      sections.unshift({ header: '', items: preItems });
    }

    return sections;
  }, [items]);

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

  const toggleSection = (section: string) => {
    setOpenSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  // Render a single item
  const renderItem = (item: typeof items[0], currentInNearMiss: boolean) => {
    const cleanedLine = cleanLine(item.content);
    const trimmedLine = cleanedLine.trim();
    
    if (!trimmedLine) return null;

    // Skip main section headers (they're rendered as collapsible triggers)
    if (isMainSectionHeader(trimmedLine)) return null;
    
    const isNearMissItem = currentInNearMiss && item.type === 'bullet';
    
    // Header items (## Day 1, ## Flights, etc.)
    if (item.type === 'day-header' || item.type === 'section-header' || isSectionHeader(trimmedLine)) {
      const dayMatch = trimmedLine.match(/Day\s+(\d+)/i);
      const dayNumber = dayMatch ? parseInt(dayMatch[1]) : null;
      
      return (
        <div key={item.id} className="mt-8 mb-4 first:mt-0">
          <div className="flex items-center gap-3">
            {dayNumber && (
              <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                <span className="text-lg font-bold text-primary">{dayNumber}</span>
              </div>
            )}
            <h3 className="text-xl font-display font-semibold text-foreground">
              {parseInlineContent(trimmedLine.replace(/^#+\s*/, ''))}
            </h3>
          </div>
        </div>
      );
    }
    
    // Subheader items (Morning, Afternoon, etc.)
    const timeMatch = trimmedLine.match(/^\*?\*?(Morning|Afternoon|Evening|Night|Meals|Logistics|Getting there|How to book)\*?\*?:?$/i);
    const boldHeaderMatch = trimmedLine.match(/^\*\*([^*]+)\*\*:?$/);
    const hashHeaderMatch = trimmedLine.match(/^###?\s+(.+)/);
    
    if (timeMatch || boldHeaderMatch || hashHeaderMatch) {
      const title = timeMatch?.[1] || boldHeaderMatch?.[1] || hashHeaderMatch?.[1] || trimmedLine;
      return (
        <div key={item.id} className="mt-4 mb-2">
          <h4 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">
            {title.replace(/\*\*/g, '').replace(/:$/, '')}
          </h4>
        </div>
      );
    }
    
    // Bullet items
    if (trimmedLine.startsWith('-') || trimmedLine.startsWith('•')) {
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
    }
    
    // Regular paragraph text
    return (
      <p key={item.id} className="text-foreground/80 leading-relaxed py-1 ml-2">
        {parseInlineContent(trimmedLine.replace(/^#+\s*/, ''))}
      </p>
    );
  };

  // Render items for a section
  const renderSectionItems = (sectionItems: typeof items) => {
    let currentInNearMiss = false;
    
    return sectionItems.map((item) => {
      const cleanedLine = cleanLine(item.content);
      const trimmedLine = cleanedLine.trim();
      
      if (!trimmedLine) return null;
      
      // Track near miss section
      if (isNearMissHeader(trimmedLine)) {
        currentInNearMiss = true;
      } else if (isNewMajorSection(trimmedLine)) {
        currentInNearMiss = false;
      }
      
      return renderItem(item, currentInNearMiss);
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
        {groupedSections.map((section, index) => {
          if (!section.header) {
            // Pre-content items (before any main section)
            return (
              <div key={`pre-${index}`} className="space-y-1">
                {renderSectionItems(section.items)}
              </div>
            );
          }

          return (
            <Collapsible
              key={section.header}
              open={openSections[section.header]}
              onOpenChange={() => toggleSection(section.header)}
            >
              <CollapsibleTrigger className="w-full">
                <div className="flex items-center justify-between py-3 px-4 bg-muted/50 rounded-lg hover:bg-muted/70 transition-colors cursor-pointer">
                  <h2 className="text-lg font-display font-bold text-foreground tracking-wide">
                    {section.header}
                  </h2>
                  <ChevronDown 
                    className={cn(
                      "w-5 h-5 text-muted-foreground transition-transform duration-200",
                      openSections[section.header] && "rotate-180"
                    )}
                  />
                </div>
              </CollapsibleTrigger>
              <CollapsibleContent className="pt-2">
                <div className="space-y-1">
                  {renderSectionItems(section.items)}
                </div>
              </CollapsibleContent>
            </Collapsible>
          );
        })}
      </div>
    </div>
  );
}
