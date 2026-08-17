export interface ItineraryActivity {
  name: string;
  description: string;
  duration?: string;
  cost?: string;
  tags?: string[];
  bookingUrl?: string;
}

export interface DiningOption {
  name: string;
  description: string;
  priceRange?: string;
  url?: string;
  isPrimary?: boolean;
}

export interface DayPeriod {
  label: string; // "Morning" | "Afternoon" | "Evening"
  activities: ItineraryActivity[];
  dining?: DiningOption[] | null;
}

export interface ItineraryDay {
  dayNumber: number;
  title: string;
  location: string;
  transitNote?: string;
  periods: DayPeriod[];
  // Days are generated in parallel, one model call per day. When one of those
  // calls fails the rest of the trip is still worth showing, so the day is kept
  // with its planned title and location but no periods, and flagged here so the
  // gap is explained rather than rendering as a blank day.
  generationFailed?: boolean;
  // Preview-tier generations never produce this day's prose: the server ships
  // only its planned title/location and this flag, and the UI renders a locked
  // placeholder. Cleared when the trip is unlocked and the day is generated.
  locked?: boolean;
}

export interface AccommodationOption {
  name: string;
  type?: string;
  pricePerNight: string;
  why?: string;
  url: string;
  isPrimary: boolean;
}

export interface AccommodationLocation {
  location: string;
  nights: number;
  options: AccommodationOption[];
}

export interface FlightOption {
  description: string;
  price: string;
  url: string;
  airlineCode?: string;
  route?: string;
  viaCity?: string;
  airline?: string;
  stops?: string;
  duration?: string;
  departureTime?: string;
  badge?: string;
}

export interface BookingItem {
  item: string;
  leadTime: string;
  estimatedCost: string;
  url: string;
  priority: 'high' | 'medium' | 'low';
}

export interface ItineraryData {
  summary: {
    destination: string;
    duration: string;
    recommendedDates: string;
    totalBudget: string;
    highlights: string[];
    assumptions?: string[];
    bestTimeNote?: string;
    vibeSummary?: string;
  };
  budget: {
    items: { category: string; range: string; description?: string }[];
    total: string;
  };
  flights: {
    skip?: boolean;
    context?: string;
    options: FlightOption[];
  };
  accommodation: AccommodationLocation[];
  bookingChecklist: BookingItem[];
  days: ItineraryDay[];
  alternatives?: { title: string; description: string; url?: string }[];
  // What the live research was grounded in, grouped by the topic it answered.
  // Absent on itineraries generated before sources were returned, and on the
  // single-call fallback path, so every consumer must treat it as optional.
  sources?: ResearchSourceGroup[];
  // Present only on preview-tier (un-entitled) generations. Locked booking
  // items are counted here, never shipped — the UI sizes its placeholder rows
  // from the counts.
  access?: ItineraryAccess;
}

export interface ItineraryAccess {
  tier: 'preview_primary' | 'preview_secondary';
  lockedDayCount: number;
  lockedBookingCounts: { high: number; medium: number; low: number };
}

export interface ResearchSourceGroup {
  topic: string;
  citations: string[];
}
