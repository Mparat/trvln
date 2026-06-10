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
}
