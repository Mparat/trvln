import { ExternalLink } from "lucide-react";

interface ItineraryDisplayProps {
  itinerary: string;
  isLoading: boolean;
}

// Parse inline content for links and bold text
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
    <div className="space-y-1 animate-fade-in">
      {lines.map((line, index) => {
        const cleanedLine = cleanLine(line);
        const trimmedLine = cleanedLine.trim();
        
        if (!trimmedLine) return null;

        // Skip main section headers (rendered in collapsible wrappers)
        if (isMainSectionHeader(trimmedLine)) return null;

        // Section headers (Day headers, Flight info, etc.)
        if (isSectionHeader(trimmedLine)) {
          return (
            <div key={index} className="mt-6 mb-3 first:mt-0">
              <h3 className="text-lg font-semibold text-foreground">
                {parseInlineContent(trimmedLine.replace(/^#+\s*/, ''))}
              </h3>
            </div>
          );
        }

        // Sub-headers (Morning, Afternoon, Evening)
        if (isSubHeader(trimmedLine)) {
          return (
            <div key={index} className="mt-5 mb-2">
              <span className="text-sm font-semibold text-muted-foreground uppercase tracking-wider">
                {parseInlineContent(trimmedLine.replace(/^\*\*|\*\*$/g, ''))}
              </span>
            </div>
          );
        }

        // Bullet points - simple clean styling
        if (trimmedLine.startsWith('-') || trimmedLine.startsWith('•') || trimmedLine.startsWith('*')) {
          const content = trimmedLine.replace(/^[-•*]\s*/, '');
          
          return (
            <div key={index} className="flex items-start gap-2 py-1.5 pl-2">
              <span className="text-muted-foreground mt-0.5">•</span>
              <p className="text-foreground leading-relaxed">
                {parseInlineContent(content)}
              </p>
            </div>
          );
        }

        // Regular text
        return (
          <p key={index} className="text-foreground leading-relaxed py-1">
            {parseInlineContent(trimmedLine)}
          </p>
        );
      })}
    </div>
  );
}