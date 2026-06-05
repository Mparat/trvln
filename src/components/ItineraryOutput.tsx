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
import { StructuredItinerary } from "./StructuredItinerary";
import { ItineraryData } from "@/types/itinerary";

interface ItineraryOutputProps {
  itinerary: string;
  isLoading: boolean;
  isStreaming?: boolean;
  isEditing?: boolean;
  onEdit?: (editRequest: string) => void;
  themeTitle?: string;
  structuredData?: ItineraryData;
  tripPreferences?: {
    cities?: string[];
    atmosphere?: string[];
    interests?: string[];
    budgetAccommodation?: number;
  };
}


// Strip emojis for PDF export (jsPDF's Helvetica doesn't support Unicode emojis)
const stripEmojis = (text: string): string => {
  return text.replace(/[\u{1F300}-\u{1F9FF}]|[\u{2600}-\u{26FF}]|[\u{2700}-\u{27BF}]|[\u{1F600}-\u{1F64F}]|[\u{1F680}-\u{1F6FF}]|[\u{1F1E0}-\u{1F1FF}]|[\u{1F000}-\u{1FFFF}]/gu, '').replace(/\s+/g, ' ').trim();
};

export function ItineraryOutput({ itinerary, isLoading, isStreaming, isEditing, onEdit, themeTitle, structuredData, tripPreferences }: ItineraryOutputProps) {
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
    if (editRequest.trim() && onEdit && !isEditing) {
      onEdit(editRequest);
      // Don't close immediately - wait for isEditing to become false
    }
  };

  // Track previous isEditing state to detect when edit completes
  const wasEditingRef = useRef(false);
  
  // Close edit box when editing completes (transitions from true to false)
  useEffect(() => {
    if (wasEditingRef.current && !isEditing) {
      // Edit just completed, close the edit box
      setEditRequest("");
      setEditMode(false);
    }
    wasEditingRef.current = !!isEditing;
  }, [isEditing]);

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
      setVote(itemId, overrides.vote);
    }
    if (overrides?.comment !== undefined && overrides.comment !== current.comment) {
      setComment(itemId, overrides.comment ?? '');
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

    // Color palette (RGB values) - matches web view styling
    const colors = {
      primary: [59, 130, 246] as [number, number, number],     // Blue
      foreground: [15, 23, 42] as [number, number, number],    // Slate-900 (darker text)
      muted: [71, 85, 105] as [number, number, number],        // Slate-600
      accent: [249, 115, 22] as [number, number, number],      // Orange
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
      
      // Strip emojis and clean text
      let processedText = stripEmojis(text)
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

    // Title - use theme title if available
    const pdfTitle = themeTitle ? stripEmojis(themeTitle) : "Travel Itinerary";
    doc.setFillColor(240, 245, 255);
    doc.rect(0, 0, pageWidth, 35, 'F');
    yPosition = 25;
    doc.setFontSize(22);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...colors.primary);
    doc.text(pdfTitle, margin, yPosition);
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
        // Bullet points - consistent foreground color (no category-based coloring)
        const content = cleanedLine.replace(/^[-•]\s*/, '');
        const indentLevel = item.indentLevel || 0;
        const bulletIndent = 10 + (indentLevel * 8);

        addFormattedText(content, 10, { 
          indent: bulletIndent, 
          bulletChar: '•',
          color: colors.foreground
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

    // Save with theme-based filename
    const safeFilename = pdfTitle.replace(/[^a-zA-Z0-9\s-]/g, '').replace(/\s+/g, '-').toLowerCase();
    doc.save(`${safeFilename || 'travel-itinerary'}.pdf`);
    
    toast({
      title: "PDF Exported",
      description: "Your full itinerary has been downloaded with clickable links.",
    });
  }, [items, themeTitle]);

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

  if (!itinerary && !structuredData) return null;

  // Only intercept streaming when content looks like JSON (starts with '{').
  // Markdown content should fall through and render as it streams in.
  if (isStreaming && !structuredData && itinerary.trimStart().startsWith('{')) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-5 text-center">
        <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
          <Sparkles className="w-7 h-7 text-primary animate-pulse" />
        </div>
        <div>
          <p className="font-semibold text-foreground">Building your itinerary…</p>
          <p className="text-sm text-muted-foreground mt-1">Researching destinations, hotels, and activities</p>
        </div>
        <div className="flex gap-1.5">
          {[0, 1, 2].map(i => (
            <div
              key={i}
              className="w-2 h-2 rounded-full bg-primary/50 animate-bounce"
              style={{ animationDelay: `${i * 0.18}s` }}
            />
          ))}
        </div>
      </div>
    );
  }

  // JSON was detected but failed to parse — don't render raw JSON as markdown
  if (!isStreaming && !structuredData && itinerary.trimStart().startsWith('{')) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
        <div className="w-12 h-12 rounded-full bg-destructive/10 flex items-center justify-center">
          <X className="w-6 h-6 text-destructive" />
        </div>
        <div>
          <p className="font-semibold text-foreground">Itinerary generation incomplete</p>
          <p className="text-sm text-muted-foreground mt-1">The response was cut off before finishing. Please regenerate.</p>
        </div>
      </div>
    );
  }

  // When structured JSON data is available, render the beautiful UI
  if (structuredData) {
    return (
      <div className="space-y-5">
        {/* Edit mode card */}
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
                  placeholder="e.g., 'Add more food options' or 'Replace day 2 with beach activities'"
                  className="min-h-[80px] resize-none"
                />
                <div className="flex justify-end gap-2">
                  <Button variant="outline" size="sm" onClick={() => !isEditing && setEditMode(false)} disabled={isEditing}>
                    Cancel
                  </Button>
                  <Button size="sm" onClick={handleSubmitEdit} disabled={!editRequest.trim() || isEditing}>
                    {isEditing ? (
                      <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Updating...</>
                    ) : (
                      <><Send className="w-4 h-4 mr-2" />Submit</>
                    )}
                  </Button>
                </div>
              </div>
            ) : (
              <button
                onClick={() => setEditMode(true)}
                className="w-full flex items-center justify-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors py-2"
              >
                <Edit3 className="w-4 h-4" />
                <span>Want to make changes? Click here to request edits</span>
              </button>
            )}
          </Card>
        )}

        {isEditing && (
          <div className="flex items-center justify-center gap-3 py-4 text-muted-foreground bg-muted/30 rounded-xl">
            <Loader2 className="w-5 h-5 animate-spin text-primary" />
            <span className="text-sm font-medium">Applying changes...</span>
          </div>
        )}

        <StructuredItinerary data={structuredData} rawItinerary={itinerary} tripPreferences={tripPreferences} />
      </div>
    );
  }

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
    
    // Day headers only (## Day 1, Day 2, etc.) - big font
    const dayMatch = trimmedLine.match(/Day\s+(\d+)/i);
    const dayNumber = dayMatch ? parseInt(dayMatch[1]) : null;
    
    if (dayNumber && (item.type === 'day-header' || trimmedLine.match(/^(#+\s*)?Day\s+\d+/i))) {
      return (
        <div key={item.id} className="mt-8 mb-4 first:mt-0 pl-2">
          <div className="flex items-center gap-3">
            <div className="w-14 h-14 rounded-full bg-primary/10 flex items-center justify-center">
              <span className="text-2xl font-bold text-primary">{dayNumber}</span>
            </div>
            <h3 className="font-display font-bold text-foreground text-xl">
              {parseInlineContent(trimmedLine.replace(/^#+\s*/, ''))}
            </h3>
          </div>
        </div>
      );
    }
    
    // Section headers (Flights, Budget, etc.) - medium font
    if (item.type === 'section-header' || isSectionHeader(trimmedLine)) {
      return (
        <div key={item.id} className="mt-6 mb-3 pl-2">
          <h4 className="text-lg font-semibold text-foreground">
            {parseInlineContent(trimmedLine.replace(/^#+\s*/, ''))}
          </h4>
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
      // Increased multiplier for better visual hierarchy (1.25rem per level)
      const marginLeft = 0.5 + (indentLevel * 1.25);
      
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

          {item.type === 'bullet' && !isNearMissItem && item.indentLevel === 0 && (
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
    
    // Regular paragraph text - render as bulleted item for consistency
    return (
      <div 
        key={item.id}
        className="flex items-start gap-3 py-2 px-3 pl-5"
      >
        <div className="w-2 h-2 rounded-full mt-2 shrink-0 bg-primary/60" />
        <p className="text-foreground/90 leading-relaxed">
          {parseInlineContent(trimmedLine.replace(/^#+\s*/, ''))}
        </p>
      </div>
    );
  };

  // Render items for a section — groups a top-level bullet with its indented children
  // so the whole entity highlights together and feedback appears at the group level.
  const renderSectionItems = (sectionItems: typeof items) => {
    type GroupEntry =
      | { kind: 'header'; item: typeof items[0]; nearMiss: boolean }
      | { kind: 'activity'; parent: typeof items[0]; children: typeof items[0][]; nearMiss: boolean }
      | { kind: 'titled-group'; title: typeof items[0]; children: typeof items[0][]; nearMiss: boolean };

    const groups: GroupEntry[] = [];
    let currentGroup: { parent: typeof items[0]; children: typeof items[0][] } | null = null;
    let currentGroupIndentLevel = Infinity;
    // Titled groups collect bullets under a bold section header (e.g. Transportation, Budget)
    let currentTitledGroupChildren: typeof items | null = null;
    let inNearMiss = false;

    const flushActivity = () => {
      if (currentGroup) {
        groups.push({ kind: 'activity', parent: currentGroup.parent, children: currentGroup.children, nearMiss: inNearMiss });
        currentGroup = null;
        currentGroupIndentLevel = Infinity;
      }
    };

    sectionItems.forEach(item => {
      const line = cleanLine(item.content).trim();
      if (!line) return;
      if (isMainSectionHeader(line)) return;
      if (isNearMissHeader(line)) inNearMiss = true;
      else if (isNewMajorSection(line)) inNearMiss = false;

      const isBullet = line.startsWith('-') || line.startsWith('•');

      if (!isBullet) {
        flushActivity();
        currentTitledGroupChildren = null;

        // Bold (or ##) subheaders that are NOT time-period headers become titled groups
        // that collect their following bullets as sub-items (Transportation, Budget, etc.)
        const isBoldHeader = !!(line.match(/^\*\*([^*]+)\*\*:?$/) || line.match(/^###?\s+/));
        const isPeriodHeader = /^\*?\*?(Morning|Afternoon|Evening|Night)/i.test(line);
        const isDayHdr = /Day\s+\d+/i.test(line);

        if (isBoldHeader && !isPeriodHeader && !isDayHdr) {
          const childrenArr: typeof items = [];
          groups.push({ kind: 'titled-group', title: item, children: childrenArr, nearMiss: inNearMiss });
          currentTitledGroupChildren = childrenArr;
        } else {
          groups.push({ kind: 'header', item, nearMiss: inNearMiss });
        }
        return;
      }

      // Bullets: route into titled group if one is active, else normal activity grouping
      if (currentTitledGroupChildren !== null) {
        currentTitledGroupChildren.push(item);
        return;
      }

      if (!currentGroup || item.indentLevel <= currentGroupIndentLevel) {
        flushActivity();
        currentGroup = { parent: item, children: [] };
        currentGroupIndentLevel = item.indentLevel;
      } else {
        currentGroup.children.push(item);
      }
    });
    flushActivity();

    const renderSubItems = (children: typeof items) =>
      children.map(child => {
        const childLine = cleanLine(child.content).trim().replace(/^[-•]\s*/, '');
        if (!childLine || /^\[source:/i.test(childLine)) return null;
        return (
          <div key={child.id} className="flex items-start gap-2 py-0.5">
            <div className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0 bg-muted-foreground/40" />
            <p className="text-sm text-muted-foreground leading-relaxed">
              {parseInlineContent(childLine)}
            </p>
          </div>
        );
      });

    return groups.map(entry => {
      if (entry.kind === 'header') return renderItem(entry.item, entry.nearMiss);

      // Titled group: bold section header (Transportation, Budget, etc.) + sub-items
      if (entry.kind === 'titled-group') {
        const titleText = cleanLine(entry.title.content).trim()
          .replace(/^\*\*/, '').replace(/\*\*:?$/, '')
          .replace(/^###?\s+/, '');
        return (
          <div key={entry.title.id} className="rounded-xl px-3 py-2 transition-colors hover:bg-muted/30">
            <p className="text-sm font-semibold text-foreground/80 pb-1">
              {parseInlineContent(titleText)}
            </p>
            {entry.children.length > 0 && (
              <div className="ml-2 space-y-0.5 pb-1">
                {renderSubItems(entry.children)}
              </div>
            )}
          </div>
        );
      }

      const { parent, children, nearMiss } = entry;
      const isNearMissItem = nearMiss && parent.type === 'bullet';
      const parentContent = cleanLine(parent.content).trim().replace(/^[-•]\s*/, '');

      return (
        <div
          key={parent.id}
          ref={(el) => { itemRefs.current[parent.id] = el; }}
          className={cn(
            "rounded-xl px-3 py-1 transition-colors group",
            "hover:bg-muted/30",
            parent.isUpdating && "opacity-60",
            isNearMissItem && "bg-amber-500/5 border-l-2 border-amber-500/30"
          )}
        >
          {/* Parent bullet + actions */}
          <div className="flex items-start gap-3 py-1.5">
            <div className="w-2 h-2 rounded-full mt-2.5 shrink-0 bg-primary/60" />
            <div className="flex-1 min-w-0">
              <p className="text-foreground/90 leading-relaxed">
                {parseInlineContent(parentContent)}
              </p>
              {parent.comment && !parent.isUpdating && (
                <div className="mt-2 text-xs text-muted-foreground bg-muted/50 px-2 py-1 rounded">
                  💬 {parent.comment}
                </div>
              )}
            </div>
            {/* Actions — revealed by group-hover on the outer card */}
            <div className="shrink-0 self-start pt-1 flex items-center gap-1">
              {isNearMissItem ? (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 opacity-0 group-hover:opacity-100 transition-opacity bg-amber-500/10 hover:bg-amber-500/20 text-amber-700"
                  onClick={() => handleAddNearMiss(parent)}
                  disabled={addingNearMiss === parent.id}
                >
                  {addingNearMiss === parent.id
                    ? <><Loader2 className="w-3 h-3 mr-1 animate-spin" />Adding...</>
                    : <><Plus className="w-3 h-3 mr-1" />Add to trip</>}
                </Button>
              ) : parent.type === 'bullet' && (
                <ItemFeedbackControls
                  item={parent}
                  canUndo={canUndo(parent.id)}
                  onVote={(vote) => setVote(parent.id, vote)}
                  onComment={(comment) => setComment(parent.id, comment)}
                  onSubmitFeedback={(overrides) => handleSubmitFeedback(parent.id, overrides)}
                  onUndo={() => undoItem(parent.id)}
                />
              )}
            </div>
          </div>

          {/* Sub-bullets — no individual hover/feedback */}
          {children.length > 0 && (
            <div className="ml-5 pb-2 space-y-0.5">
              {renderSubItems(children)}
            </div>
          )}
        </div>
      );
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
                <Button variant="outline" size="sm" onClick={() => !isEditing && setEditMode(false)} disabled={isEditing}>
                  Cancel
                </Button>
                <Button size="sm" onClick={handleSubmitEdit} disabled={!editRequest.trim() || isEditing}>
                  {isEditing ? (
                    <>
                      <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                      Updating...
                    </>
                  ) : (
                    <>
                      <Send className="w-4 h-4 mr-2" />
                      Submit
                    </>
                  )}
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

      {/* Collapsible sections with loading overlay */}
      <div className="relative">
        {isEditing && (
          <div className="absolute inset-0 bg-background/60 backdrop-blur-sm flex items-center justify-center rounded-lg z-10">
            <div className="flex items-center gap-3 text-muted-foreground bg-card px-4 py-3 rounded-lg shadow-medium">
              <Loader2 className="w-5 h-5 animate-spin text-primary" />
              <span className="font-medium">Applying changes...</span>
            </div>
          </div>
        )}
        <div className={cn("space-y-4", isEditing && "pointer-events-none")}>
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
    </div>
  );
}
