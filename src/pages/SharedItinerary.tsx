import { useEffect, useState, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { 
  MapPin, Clock, DollarSign, Utensils, Camera, Star, Plane, Sun, 
  CloudRain, Sparkles, AlertTriangle, ExternalLink,
  Mountain, Building, Trees, Tent, Heart, Zap, PartyPopper,
  Lightbulb, ChevronDown
} from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

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

// Icon mapping for bullet points
function getIconForContent(content: string) {
  const lower = content.toLowerCase();
  if (lower.includes('flight') || lower.includes('airport') || lower.includes('airline')) return Plane;
  if (lower.includes('hotel') || lower.includes('stay') || lower.includes('accommodation') || lower.includes('check-in') || lower.includes('check in')) return Building;
  if (lower.includes('restaurant') || lower.includes('eat') || lower.includes('food') || lower.includes('breakfast') || lower.includes('lunch') || lower.includes('dinner') || lower.includes('café') || lower.includes('cafe')) return Utensils;
  if (lower.includes('photo') || lower.includes('camera') || lower.includes('instagram') || lower.includes('view') || lower.includes('scenic')) return Camera;
  if (lower.includes('hike') || lower.includes('trail') || lower.includes('mountain') || lower.includes('nature')) return Mountain;
  if (lower.includes('tip') || lower.includes('note') || lower.includes('recommend')) return Lightbulb;
  if (lower.includes('budget') || lower.includes('cost') || lower.includes('price') || lower.includes('$') || lower.includes('€') || lower.includes('¥')) return DollarSign;
  if (lower.includes('time') || lower.includes('hour') || lower.includes('duration') || lower.includes('am') || lower.includes('pm')) return Clock;
  if (lower.includes('weather') || lower.includes('rain')) return CloudRain;
  if (lower.includes('sun') || lower.includes('sunny') || lower.includes('warm')) return Sun;
  if (lower.includes('warning') || lower.includes('caution') || lower.includes('avoid')) return AlertTriangle;
  if (lower.includes('must') || lower.includes('highlight') || lower.includes('best') || lower.includes('top')) return Star;
  return MapPin;
}

const cleanLine = (line: string): string => {
  let cleaned = line;
  cleaned = cleaned.replace(/^```[\w]*\s*$/gm, '');
  cleaned = cleaned.replace(/^---+$/gm, '');
  return cleaned;
};

const isMainSectionHeader = (line: string): boolean => {
  const mainSections = ['EXECUTIVE SUMMARY', 'KEY BOOKINGS & BUDGET', 'DAY-BY-DAY ITINERARY', 'ALTERNATIVES & ADDITIONAL OPTIONS'];
  const trimmed = line.trim().replace(/^#+\s*/, '').replace(/\*\*/g, '');
  return mainSections.some(section => trimmed.toUpperCase().includes(section));
};

const getMainSectionName = (line: string): string => {
  const mainSections = ['EXECUTIVE SUMMARY', 'KEY BOOKINGS & BUDGET', 'DAY-BY-DAY ITINERARY', 'ALTERNATIVES & ADDITIONAL OPTIONS'];
  const trimmed = line.trim().replace(/^#+\s*/, '').replace(/\*\*/g, '').toUpperCase();
  return mainSections.find(section => trimmed.includes(section)) || '';
};

const isSectionHeader = (line: string): boolean => {
  return /^#{1,3}\s+/.test(line) || /^\*\*[^*]+\*\*$/.test(line.trim());
};

const isSubHeader = (line: string): boolean => {
  const subHeaderPatterns = [
    /^(morning|afternoon|evening|night)\s*[-–:]/i,
    /^\*\*(morning|afternoon|evening|night)[^*]*\*\*/i,
  ];
  return subHeaderPatterns.some(p => p.test(line.trim()));
};

const parseInlineContent = (text: string) => {
  const parts: (string | JSX.Element)[] = [];
  const regex = /\[([^\]]+)\]\(([^)]+)\)|(\*\*[^*]+\*\*)/g;
  let lastIndex = 0;
  let match;
  let key = 0;
  
  while ((match = regex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index));
    }
    
    if (match[1] && match[2]) {
      parts.push(
        <a 
          key={key++}
          href={match[2]} 
          target="_blank" 
          rel="noopener noreferrer"
          className="text-primary hover:underline inline-flex items-center gap-1"
          onClick={(e) => e.stopPropagation()}
        >
          {match[1]}
          <ExternalLink className="w-3 h-3" />
        </a>
      );
    } else if (match[3]) {
      const boldText = match[3].replace(/\*\*/g, '');
      parts.push(<strong key={key++} className="font-semibold">{boldText}</strong>);
    }
    
    lastIndex = match.index + match[0].length;
  }
  
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex));
  }
  
  return parts.length > 0 ? parts : text;
};

interface ParsedItem {
  id: string;
  content: string;
  type: 'main-section' | 'day-header' | 'section-header' | 'subheader' | 'bullet' | 'text';
}

export default function SharedItinerary() {
  const [searchParams] = useSearchParams();
  const [itinerary, setItinerary] = useState<string>("");
  const [openSections, setOpenSections] = useState<Record<string, boolean>>({
    'EXECUTIVE SUMMARY': true,
    'KEY BOOKINGS & BUDGET': true,
    'DAY-BY-DAY ITINERARY': true,
    'ALTERNATIVES & ADDITIONAL OPTIONS': true,
  });

  useEffect(() => {
    const data = searchParams.get("data");
    if (data) {
      try {
        const decoded = decodeURIComponent(atob(data));
        setItinerary(decoded);
      } catch (e) {
        console.error("Failed to decode itinerary data");
      }
    }
  }, [searchParams]);

  const items = useMemo<ParsedItem[]>(() => {
    if (!itinerary) return [];
    
    const lines = itinerary.split('\n');
    return lines.map((line, index) => {
      const cleaned = cleanLine(line);
      const trimmed = cleaned.trim();
      
      let type: ParsedItem['type'] = 'text';
      
      if (isMainSectionHeader(trimmed)) {
        type = 'main-section';
      } else if (/^#+\s*Day\s+\d+/i.test(trimmed) || /^\*\*Day\s+\d+/i.test(trimmed)) {
        type = 'day-header';
      } else if (isSectionHeader(trimmed)) {
        type = 'section-header';
      } else if (isSubHeader(trimmed)) {
        type = 'subheader';
      } else if (trimmed.startsWith('-') || trimmed.startsWith('•') || trimmed.startsWith('*')) {
        type = 'bullet';
      }
      
      return {
        id: `item-${index}`,
        content: cleaned,
        type,
      };
    });
  }, [itinerary]);

  const groupedSections = useMemo(() => {
    const sections: { header: string; items: ParsedItem[] }[] = [];
    let currentSection: { header: string; items: ParsedItem[] } | null = null;
    
    items.forEach((item) => {
      const trimmed = item.content.trim();
      
      if (item.type === 'main-section') {
        if (currentSection) {
          sections.push(currentSection);
        }
        currentSection = { header: getMainSectionName(trimmed), items: [] };
      } else if (currentSection) {
        currentSection.items.push(item);
      } else {
        if (!sections.find(s => s.header === '')) {
          sections.push({ header: '', items: [] });
        }
        const preSection = sections.find(s => s.header === '');
        if (preSection) preSection.items.push(item);
      }
    });
    
    if (currentSection && currentSection.items.length > 0) {
      sections.push(currentSection);
    }
    
    return sections;
  }, [items]);

  const toggleSection = (section: string) => {
    setOpenSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const renderItem = (item: ParsedItem, currentInNearMiss: boolean) => {
    const cleanedLine = cleanLine(item.content);
    const trimmedLine = cleanedLine.trim();
    
    if (!trimmedLine) return null;
    if (isMainSectionHeader(trimmedLine)) return null;
    
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
    
    if (item.type === 'subheader' || isSubHeader(trimmedLine)) {
      return (
        <div key={item.id} className="mt-6 mb-2">
          <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            {parseInlineContent(trimmedLine.replace(/^\*\*|\*\*$/g, ''))}
          </span>
        </div>
      );
    }
    
    if (item.type === 'bullet') {
      const bulletContent = trimmedLine.replace(/^[-•*]\s*/, '');
      const activityType = detectActivityType(bulletContent);
      const Icon = getIconForContent(bulletContent);
      
      return (
        <div key={item.id} className="group relative py-2 pl-6 border-l-2 border-muted hover:border-primary/50 transition-colors">
          <div className="absolute left-0 top-1/2 -translate-y-1/2 -translate-x-1/2 w-6 h-6 rounded-full bg-background border-2 border-muted group-hover:border-primary/50 flex items-center justify-center transition-colors">
            <Icon className="w-3 h-3 text-muted-foreground group-hover:text-primary transition-colors" />
          </div>
          <div className="flex items-start justify-between gap-2">
            <div className="flex-1">
              <p className="text-foreground leading-relaxed">
                {parseInlineContent(bulletContent)}
              </p>
              {activityType && (
                <div className="mt-2">
                  <ActivityTag type={activityType} />
                </div>
              )}
            </div>
          </div>
        </div>
      );
    }
    
    return (
      <p key={item.id} className="text-foreground leading-relaxed py-1">
        {parseInlineContent(trimmedLine)}
      </p>
    );
  };

  const renderSectionItems = (sectionItems: ParsedItem[]) => {
    let inNearMiss = false;
    
    return sectionItems.map((item) => {
      const content = item.content.toLowerCase();
      if (content.includes('alternatives') || content.includes('near miss') || content.includes('near-miss')) {
        inNearMiss = true;
      }
      return renderItem(item, inNearMiss);
    });
  };

  if (!itinerary) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <h1 className="text-2xl font-display font-bold text-foreground mb-2">No Itinerary Found</h1>
          <p className="text-muted-foreground">The itinerary data could not be loaded.</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
              <Sparkles className="w-5 h-5 text-primary" />
            </div>
            <h1 className="text-2xl font-display font-bold text-foreground">
              Your Itinerary
            </h1>
          </div>
        </div>

        <div className="space-y-4">
          {groupedSections.map((section, index) => {
            if (!section.header) {
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
    </div>
  );
}
