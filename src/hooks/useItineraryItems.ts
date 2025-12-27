import { useState, useCallback, useMemo } from 'react';

export interface ItineraryItemHistory {
  content: string;
  timestamp: number;
}

export interface ItineraryItem {
  id: string;
  content: string;
  type: 'day-header' | 'section-header' | 'bullet' | 'text' | 'special-section';
  indentLevel: number;
  history: ItineraryItemHistory[];
  vote: 'up' | 'down' | 'neutral' | null;
  comment: string | null;
  isUpdating: boolean;
  context: string; // surrounding context for LLM updates
}

// Generate a stable ID from content
const generateItemId = (content: string, index: number): string => {
  const hash = content.slice(0, 50).replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
  return `item-${index}-${hash}`;
};

// Parse raw itinerary text into structured items
export const parseItineraryToItems = (itinerary: string): ItineraryItem[] => {
  if (!itinerary) return [];

  const lines = itinerary.split('\n');
  const items: ItineraryItem[] = [];
  let currentDayContext = '';
  let currentSectionContext = '';

  lines.forEach((line, index) => {
    const trimmedLine = line.trim();
    if (!trimmedLine) return;

    // Detect indentation level
    const indentMatch = line.match(/^(\s*)/);
    const indentLevel = indentMatch ? Math.floor(indentMatch[1].length / 2) : 0;

    // Determine item type
    let type: ItineraryItem['type'] = 'text';
    
    if (trimmedLine.match(/^(Day\s+\d+|##\s*Day)/i)) {
      type = 'day-header';
      currentDayContext = trimmedLine;
      currentSectionContext = '';
    } else if (trimmedLine.match(/^(##\s*)?(Trip Summary|Book First|Near Misses|Alternative Guided|Assumptions|High-Risk|Flights?|Accommodation|Budget)/i)) {
      type = 'special-section';
      currentSectionContext = trimmedLine;
    } else if (trimmedLine.match(/^\*?\*?(Morning|Afternoon|Evening|Night|Meals|Logistics)\*?\*?:?$/i)) {
      type = 'section-header';
      currentSectionContext = trimmedLine;
    } else if (trimmedLine.startsWith('-') || trimmedLine.startsWith('•')) {
      type = 'bullet';
    }

    const context = [currentDayContext, currentSectionContext].filter(Boolean).join(' > ');

    items.push({
      id: generateItemId(trimmedLine, index),
      content: trimmedLine,
      type,
      indentLevel,
      history: [{ content: trimmedLine, timestamp: Date.now() }],
      vote: null,
      comment: null,
      isUpdating: false,
      context,
    });
  });

  return items;
};

// Convert items back to raw text
export const itemsToItinerary = (items: ItineraryItem[]): string => {
  return items.map(item => {
    const indent = '  '.repeat(item.indentLevel);
    return `${indent}${item.content}`;
  }).join('\n');
};

export function useItineraryItems(initialItinerary: string = '') {
  const [items, setItems] = useState<ItineraryItem[]>(() => 
    parseItineraryToItems(initialItinerary)
  );

  // Update items when itinerary changes (streaming)
  const syncWithItinerary = useCallback((itinerary: string) => {
    const newItems = parseItineraryToItems(itinerary);
    
    // Preserve existing votes/comments/history for matching items
    setItems(prevItems => {
      return newItems.map(newItem => {
        const existingItem = prevItems.find(p => 
          p.content === newItem.content || p.id === newItem.id
        );
        
        if (existingItem) {
          return {
            ...newItem,
            vote: existingItem.vote,
            comment: existingItem.comment,
            history: existingItem.history,
            isUpdating: existingItem.isUpdating,
          };
        }
        return newItem;
      });
    });
  }, []);

  // Set vote for an item
  const setVote = useCallback((itemId: string, vote: 'up' | 'down' | 'neutral') => {
    setItems(prev => prev.map(item => 
      item.id === itemId ? { ...item, vote } : item
    ));
  }, []);

  // Set comment for an item
  const setComment = useCallback((itemId: string, comment: string) => {
    setItems(prev => prev.map(item => 
      item.id === itemId ? { ...item, comment } : item
    ));
  }, []);

  // Update an item's content (after LLM response)
  const updateItemContent = useCallback((itemId: string, newContent: string) => {
    setItems(prev => prev.map(item => {
      if (item.id !== itemId) return item;
      
      return {
        ...item,
        content: newContent,
        history: [...item.history, { content: newContent, timestamp: Date.now() }],
        vote: null, // Reset vote after update
        comment: null, // Reset comment after update
        isUpdating: false,
      };
    }));
  }, []);

  // Undo to previous version
  const undoItem = useCallback((itemId: string) => {
    setItems(prev => prev.map(item => {
      if (item.id !== itemId || item.history.length <= 1) return item;
      
      const newHistory = item.history.slice(0, -1);
      const previousContent = newHistory[newHistory.length - 1].content;
      
      return {
        ...item,
        content: previousContent,
        history: newHistory,
        vote: null,
        comment: null,
      };
    }));
  }, []);

  // Insert a new item after a specific item or at a specific position
  const insertItemAfter = useCallback((afterItemId: string | null, newContent: string, context: string): string => {
    const newId = generateItemId(newContent, Date.now());
    const newItem: ItineraryItem = {
      id: newId,
      content: newContent,
      type: 'bullet',
      indentLevel: 0,
      history: [{ content: newContent, timestamp: Date.now() }],
      vote: null,
      comment: null,
      isUpdating: false,
      context,
    };

    setItems(prev => {
      if (!afterItemId) {
        // Insert at the end
        return [...prev, newItem];
      }
      
      const index = prev.findIndex(item => item.id === afterItemId);
      if (index === -1) {
        return [...prev, newItem];
      }
      
      // Insert after the found item
      return [...prev.slice(0, index + 1), newItem, ...prev.slice(index + 1)];
    });

    return newId;
  }, []);

  // Find item by partial content match
  const findItemByContent = useCallback((searchText: string): ItineraryItem | undefined => {
    return items.find(item => 
      item.content.toLowerCase().includes(searchText.toLowerCase())
    );
  }, [items]);

  // Find items in a specific day/section
  const findItemsInSection = useCallback((dayNumber: number, section: string): ItineraryItem[] => {
    let inTargetDay = false;
    let inTargetSection = false;
    const result: ItineraryItem[] = [];

    for (const item of items) {
      // Check if we're entering the target day
      const dayMatch = item.content.match(/Day\s+(\d+)/i);
      if (dayMatch) {
        inTargetDay = parseInt(dayMatch[1]) === dayNumber;
        inTargetSection = false;
      }

      // Check if we're entering the target section within the day
      if (inTargetDay && item.content.toLowerCase().includes(section.toLowerCase())) {
        inTargetSection = true;
      }

      // Check if we're leaving the section (new section header)
      if (inTargetSection && item.type === 'section-header' && !item.content.toLowerCase().includes(section.toLowerCase())) {
        inTargetSection = false;
      }

      // Check if we're leaving the day
      if (inTargetDay && item.type === 'day-header' && item.content !== items.find(i => i.content.match(new RegExp(`Day\\s+${dayNumber}`, 'i')))?.content) {
        break;
      }

      if (inTargetDay && inTargetSection && item.type === 'bullet') {
        result.push(item);
      }
    }

    return result;
  }, [items]);

  // Set updating state
  const setItemUpdating = useCallback((itemId: string, isUpdating: boolean) => {
    setItems(prev => prev.map(item => 
      item.id === itemId ? { ...item, isUpdating } : item
    ));
  }, []);

  // Get item by ID
  const getItem = useCallback((itemId: string) => {
    return items.find(item => item.id === itemId);
  }, [items]);

  // Check if item can be undone
  const canUndo = useCallback((itemId: string) => {
    const item = items.find(i => i.id === itemId);
    return item ? item.history.length > 1 : false;
  }, [items]);

  // Get current itinerary text
  const itineraryText = useMemo(() => itemsToItinerary(items), [items]);

  return {
    items,
    setItems,
    syncWithItinerary,
    setVote,
    setComment,
    updateItemContent,
    undoItem,
    setItemUpdating,
    getItem,
    canUndo,
    itineraryText,
    insertItemAfter,
    findItemByContent,
    findItemsInSection,
  };
}
