import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { 
  Clock, DollarSign, Sparkles, ExternalLink, Edit3, Send,
  X, Plus, Loader2, ChevronDown, Share2
} from "lucide-react";
import { jsPDF } from "jspdf";
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

  // Clean up markdown formatting characters
  const cleanLine = (line: string): string => {
    let cleaned = line;
    // Skip lines that are only code fences or horizontal rules
    if (/^```+\s*$/.test(cleaned.trim()) || /^---+\s*$/.test(cleaned.trim())) {
      return '';
    }
    // Remove inline code fences and horizontal rules
    cleaned = cleaned.replace(/```/g, '');
    cleaned = cleaned.replace(/---/g, '');
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

  // Parse inline content with support for markdown links and raw URLs
  const parseInlineContent = (content: string) => {
    const makeSearchUrl = (query: string) =>
      `https://www.google.com/search?q=${encodeURIComponent(query)}`;

    const makeGoogleMapsUrl = (query: string) =>
      `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;

    const normalizeUrl = (href: string, label?: string): string => {
      if (/^(javascript|data):/i.test(href)) return makeSearchUrl(label || href);

      const withProto = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(href) ? href : `https://${href}`;

      try {
        const url = new URL(withProto);

        if (/goo\.gl$/i.test(url.hostname) || /maps\.app\.goo\.gl$/i.test(url.hostname)) {
          return makeGoogleMapsUrl(label || href);
        }

        if (url.protocol !== 'http:' && url.protocol !== 'https:') {
          return makeSearchUrl(label || href);
        }

        return url.toString();
      } catch {
        return makeSearchUrl(label || href);
      }
    };

    // First, split by markdown links and raw URLs
    // Pattern matches: markdown links [text](url), or raw URLs (https://... or http://...)
    const combinedPattern = /(\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*|https?:\/\/[^\s\])\]]+)/g;
    
    return content.split(combinedPattern).map((part, i) => {
      if (!part) return null;
      
      // Bold text
      if (part.startsWith('**') && part.endsWith('**')) {
        return (
          <strong key={i} className="font-semibold text-foreground">
            {part.slice(2, -2)}
          </strong>
        );
      }

      // Markdown link [text](url)
      const linkMatch = part.match(/\[([^\]]+)\]\(([^)]+)\)/);
      if (linkMatch) {
        const label = linkMatch[1];
        const rawHref = linkMatch[2].trim();
        const href = normalizeUrl(rawHref, label);

        return (
          <a
            key={i}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline underline-offset-2 hover:text-primary/80 inline-flex items-center gap-1"
          >
            {label}
            <ExternalLink className="w-3 h-3" />
          </a>
        );
      }

      // Raw URL (https://... or http://...)
      if (/^https?:\/\//i.test(part)) {
        const href = normalizeUrl(part);
        // Truncate display URL if too long
        const displayUrl = part.length > 50 ? part.slice(0, 47) + '...' : part;
        
        return (
          <a
            key={i}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline underline-offset-2 hover:text-primary/80 inline-flex items-center gap-1"
          >
            {displayUrl}
            <ExternalLink className="w-3 h-3" />
          </a>
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
    const seenHeaders = new Set<string>();

    items.forEach((item) => {
      const cleanedLine = cleanLine(item.content);
      const trimmedLine = cleanedLine.trim();
      
      if (!trimmedLine) return;

      const mainHeader = isMainSectionHeader(trimmedLine);
      if (mainHeader) {
        // Skip duplicate headers
        if (seenHeaders.has(mainHeader)) {
          return;
        }
        seenHeaders.add(mainHeader);
        
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

  // Export itinerary to PDF - must be before early returns
  const handleExportPDF = useCallback(() => {
    const doc = new jsPDF();
    const pageWidth = doc.internal.pageSize.getWidth();
    const pageHeight = doc.internal.pageSize.getHeight();
    const margin = 20;
    const maxLineWidth = pageWidth - margin * 2;
    let yPosition = margin;

    // Color palette (RGB values)
    const colors = {
      primary: [59, 130, 246] as [number, number, number],     // Blue
      foreground: [30, 30, 30] as [number, number, number],    // Dark gray
      muted: [100, 100, 100] as [number, number, number],      // Medium gray
      accent: [168, 85, 247] as [number, number, number],      // Purple
      success: [34, 197, 94] as [number, number, number],      // Green
      warning: [245, 158, 11] as [number, number, number],     // Amber
    };

    const checkPageBreak = (neededSpace: number) => {
      if (yPosition + neededSpace > pageHeight - margin) {
        doc.addPage();
        yPosition = margin;
      }
    };

    // Extract links from text and return clean text + link positions
    const extractLinks = (text: string): { cleanText: string; links: { text: string; url: string; start: number; end: number }[] } => {
      const links: { text: string; url: string; start: number; end: number }[] = [];
      let cleanText = text;
      const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
      let match;
      let offset = 0;

      while ((match = linkRegex.exec(text)) !== null) {
        const fullMatch = match[0];
        const linkText = match[1];
        const url = match[2];
        const start = match.index - offset;
        const end = start + linkText.length;
        
        links.push({ text: linkText, url, start, end });
        cleanText = cleanText.replace(fullMatch, linkText);
        offset += fullMatch.length - linkText.length;
      }

      return { cleanText, links };
    };

    // Add text with formatting and clickable links
    const addFormattedText = (
      text: string, 
      fontSize: number, 
      options: { 
        isBold?: boolean; 
        indent?: number; 
        color?: [number, number, number];
        bulletChar?: string;
      } = {}
    ) => {
      const { isBold = false, indent = 0, color = colors.foreground, bulletChar } = options;
      
      // Clean text while preserving link structure for now
      let processedText = text
        .replace(/^#+\s*/, '')
        .replace(/\*\*([^*]+)\*\*/g, '$1')
        .trim();
      
      if (!processedText) return;

      // Add bullet if specified
      if (bulletChar) {
        processedText = `${bulletChar} ${processedText}`;
      }

      // Extract links
      const { cleanText, links } = extractLinks(processedText);
      
      doc.setFontSize(fontSize);
      doc.setTextColor(...color);
      
      const lines = doc.splitTextToSize(cleanText, maxLineWidth - indent);
      
      for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
        const line = lines[lineIdx];
        checkPageBreak(fontSize * 0.5);
        
        // Find links in this line
        let charOffset = 0;
        for (let i = 0; i < lineIdx; i++) {
          charOffset += lines[i].length + 1; // +1 for space/newline
        }
        
        const lineLinks = links.filter(l => 
          l.start >= charOffset && l.start < charOffset + line.length
        );

        if (lineLinks.length > 0) {
          // Render text with links
          let xPos = margin + indent;
          let currentPos = 0;
          
          for (const link of lineLinks) {
            const localStart = link.start - charOffset;
            const localEnd = Math.min(link.end - charOffset, line.length);
            
            // Text before link
            if (localStart > currentPos) {
              const beforeText = line.substring(currentPos, localStart);
              doc.setFont("helvetica", isBold ? "bold" : "normal");
              doc.setTextColor(...color);
              doc.text(beforeText, xPos, yPosition);
              xPos += doc.getTextWidth(beforeText);
            }
            
            // Link text (blue and underlined)
            const linkText = line.substring(localStart, localEnd);
            doc.setFont("helvetica", isBold ? "bold" : "normal");
            doc.setTextColor(...colors.primary);
            doc.text(linkText, xPos, yPosition);
            
            // Add clickable link annotation
            const linkWidth = doc.getTextWidth(linkText);
            doc.link(xPos, yPosition - fontSize * 0.3, linkWidth, fontSize * 0.4, { url: link.url });
            
            xPos += linkWidth;
            currentPos = localEnd;
          }
          
          // Remaining text after last link
          if (currentPos < line.length) {
            const afterText = line.substring(currentPos);
            doc.setFont("helvetica", isBold ? "bold" : "normal");
            doc.setTextColor(...color);
            doc.text(afterText, xPos, yPosition);
          }
        } else {
          // No links, render normally
          doc.setFont("helvetica", isBold ? "bold" : "normal");
          doc.text(line, margin + indent, yPosition);
        }
        
        yPosition += fontSize * 0.5;
      }
      yPosition += 2;
    };

    // Add section divider line
    const addDivider = () => {
      checkPageBreak(8);
      doc.setDrawColor(200, 200, 200);
      doc.setLineWidth(0.5);
      doc.line(margin, yPosition, pageWidth - margin, yPosition);
      yPosition += 6;
    };

    // Title
    doc.setFillColor(240, 245, 255);
    doc.rect(0, 0, pageWidth, 35, 'F');
    yPosition = 25;
    doc.setFontSize(24);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...colors.primary);
    doc.text("Travel Itinerary", margin, yPosition);
    yPosition += 15;

    // Date generated
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(...colors.muted);
    doc.text(`Generated on ${new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}`, margin, yPosition);
    yPosition += 10;

    addDivider();

    // Process ALL items from the itinerary
    items.forEach((item) => {
      const cleanedLine = cleanLine(item.content).trim();
      if (!cleanedLine) return;

      const mainSection = isMainSectionHeader(cleanedLine);
      if (mainSection) {
        // Main section header with background
        checkPageBreak(15);
        yPosition += 8;
        doc.setFillColor(245, 247, 250);
        doc.roundedRect(margin - 5, yPosition - 6, pageWidth - margin * 2 + 10, 12, 2, 2, 'F');
        doc.setFontSize(14);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(...colors.foreground);
        doc.text(mainSection, margin, yPosition + 2);
        yPosition += 12;
      } else if (item.type === 'day-header' || item.type === 'section-header' || isSectionHeader(cleanedLine)) {
        // Day/Section headers
        checkPageBreak(12);
        yPosition += 6;
        
        const dayMatch = cleanedLine.match(/Day\s+(\d+)/i);
        if (dayMatch) {
          // Day header with circle number
          const dayNum = dayMatch[1];
          doc.setFillColor(...colors.primary);
          doc.circle(margin + 5, yPosition - 2, 5, 'F');
          doc.setFontSize(10);
          doc.setFont("helvetica", "bold");
          doc.setTextColor(255, 255, 255);
          doc.text(dayNum, margin + 5, yPosition, { align: 'center' });
          
          doc.setFontSize(13);
          doc.setTextColor(...colors.foreground);
          doc.text(cleanedLine.replace(/^#+\s*/, ''), margin + 15, yPosition);
        } else {
          addFormattedText(cleanedLine, 12, { isBold: true, color: colors.foreground });
        }
        yPosition += 4;
      } else if (cleanedLine.match(/^\*?\*?(Morning|Afternoon|Evening|Night|Meals|Logistics|Getting there|How to book)\*?\*?:?$/i)) {
        // Time-of-day subheaders
        checkPageBreak(10);
        yPosition += 4;
        doc.setFontSize(10);
        doc.setFont("helvetica", "bold");
        doc.setTextColor(...colors.muted);
        const timeText = cleanedLine.replace(/\*\*/g, '').replace(/:$/, '').toUpperCase();
        doc.text(timeText, margin + 8, yPosition);
        yPosition += 4;
      } else if (cleanedLine.startsWith('-') || cleanedLine.startsWith('•')) {
        // Bullet points
        const content = cleanedLine.replace(/^[-•]\s*/, '');
        const indentLevel = item.indentLevel || 0;
        const bulletIndent = 10 + (indentLevel * 8);
        
        // Determine icon/bullet style based on content
        const hasFlight = /flight|airport|airline|depart|arrive/i.test(content);
        const hasFood = /restaurant|eat|food|breakfast|lunch|dinner|café|cafe|meal/i.test(content);
        const hasPhoto = /photo|view|scenic|visit|see|explore/i.test(content);
        const hasTip = /tip|recommend|don't miss|must|should|pro tip/i.test(content);
        
        let bulletColor = colors.foreground;
        if (hasFlight) bulletColor = [14, 165, 233]; // Sky blue
        else if (hasFood) bulletColor = [249, 115, 22]; // Orange
        else if (hasPhoto) bulletColor = [59, 130, 246]; // Blue
        else if (hasTip) bulletColor = [245, 158, 11]; // Amber

        addFormattedText(content, 10, { 
          indent: bulletIndent, 
          bulletChar: '•',
          color: bulletColor as [number, number, number]
        });
      } else {
        // Regular paragraph text
        addFormattedText(cleanedLine, 10, { indent: 8, color: colors.muted });
      }
    });

    // Footer on last page
    const pageCount = doc.getNumberOfPages();
    for (let i = 1; i <= pageCount; i++) {
      doc.setPage(i);
      doc.setFontSize(8);
      doc.setFont("helvetica", "normal");
      doc.setTextColor(...colors.muted);
      doc.text(`Page ${i} of ${pageCount}`, pageWidth / 2, pageHeight - 10, { align: 'center' });
    }

    doc.save("travel-itinerary.pdf");
    
    toast({
      title: "PDF Exported",
      description: "Your full itinerary has been downloaded with clickable links.",
    });
  }, [items]);

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
        <div key={item.id} className="mt-8 mb-4 first:mt-0 pl-2">
          <div className="flex items-center gap-3">
            {dayNumber && (
              <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
                <span className="text-2xl font-bold text-primary">{dayNumber}</span>
              </div>
            )}
            <h3 className={cn(
              "font-display font-bold text-foreground",
              dayNumber ? "text-3xl" : "text-2xl"
            )}>
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
        <div key={item.id} className="mt-6 mb-3 pl-2">
          <h4 className="text-base font-semibold text-foreground/80">
            {title.replace(/\*\*/g, '').replace(/:$/, '')}
          </h4>
        </div>
      );
    }
    
    // Bullet items
    if (trimmedLine.startsWith('-') || trimmedLine.startsWith('•')) {
      const content = trimmedLine.replace(/^[-•]\s*/, '');
      const indentLevel = item.indentLevel;
      
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
          <div className={cn(
            "rounded-full mt-2 shrink-0",
            indentLevel === 0 ? "w-2 h-2 bg-primary/60" : "w-1.5 h-1.5 bg-muted-foreground/40"
          )} />
          <div className="flex-1 min-w-0">
            <p className="text-foreground/90 leading-relaxed">{parsedContent}</p>
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
      <p key={item.id} className="text-foreground/80 leading-relaxed py-1 pl-3">
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
      {/* Header with Export button */}
      <div className="flex items-center justify-between">
        <h2 className="text-2xl font-display font-bold text-foreground">Your Itinerary</h2>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExportPDF}
            className="gap-2"
          >
            <Share2 className="w-4 h-4" />
            Export PDF
          </Button>
        </div>
      </div>
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
