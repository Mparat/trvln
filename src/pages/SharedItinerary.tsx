import { useEffect, useState, useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { Sparkles, ExternalLink, ChevronDown } from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { cn } from "@/lib/utils";

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

  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const id = searchParams.get("id");
    if (id) {
      // Small delay to ensure localStorage is ready
      const checkStorage = () => {
        const stored = localStorage.getItem(`itinerary-${id}`);
        if (stored) {
          setItinerary(stored);
          setIsLoading(false);
        } else {
          // Retry once after a brief delay
          setTimeout(() => {
            const retryStored = localStorage.getItem(`itinerary-${id}`);
            if (retryStored) {
              setItinerary(retryStored);
            }
            setIsLoading(false);
          }, 100);
        }
      };
      checkStorage();
    } else {
      setIsLoading(false);
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
      return (
        <div key={item.id} className="mt-6 mb-3 first:mt-0">
          <h3 className="text-lg font-semibold text-foreground">
            {parseInlineContent(trimmedLine.replace(/^#+\s*/, ''))}
          </h3>
        </div>
      );
    }
    
    if (item.type === 'subheader' || isSubHeader(trimmedLine)) {
      return (
        <div key={item.id} className="mt-5 mb-2">
          <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
            {parseInlineContent(trimmedLine.replace(/^\*\*|\*\*$/g, ''))}
          </span>
        </div>
      );
    }
    
    if (item.type === 'bullet') {
      const bulletContent = trimmedLine.replace(/^[-•*]\s*/, '');
      
      return (
        <div key={item.id} className="flex items-start gap-2 py-1.5 pl-2">
          <span className="text-muted-foreground mt-0.5">•</span>
          <p className="text-foreground leading-relaxed">
            {parseInlineContent(bulletContent)}
          </p>
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

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center">
        <div className="text-center">
          <div className="w-10 h-10 rounded-full border-4 border-primary/30 border-t-primary animate-spin mx-auto mb-4" />
          <p className="text-muted-foreground">Loading itinerary...</p>
        </div>
      </div>
    );
  }

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
