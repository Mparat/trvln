import { useState } from "react";
import { Calendar, Clock, Wallet, ChevronDown, ChevronUp, Minus, Plus, Plane, MapPinned } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import { cn } from "@/lib/utils";
import { format, addDays, subDays } from "date-fns";

// Major US metro areas with their airports
const airportGroups = [
  {
    city: "New York",
    code: "NYC",
    airports: [
      { code: "JFK", name: "John F. Kennedy" },
      { code: "LGA", name: "LaGuardia" },
      { code: "EWR", name: "Newark" },
    ],
  },
  {
    city: "Los Angeles",
    code: "LAX",
    airports: [
      { code: "LAX", name: "Los Angeles Intl" },
      { code: "BUR", name: "Burbank" },
      { code: "SNA", name: "Orange County" },
      { code: "ONT", name: "Ontario" },
    ],
  },
  {
    city: "Chicago",
    code: "CHI",
    airports: [
      { code: "ORD", name: "O'Hare" },
      { code: "MDW", name: "Midway" },
    ],
  },
  {
    city: "San Francisco Bay Area",
    code: "SFO",
    airports: [
      { code: "SFO", name: "San Francisco" },
      { code: "OAK", name: "Oakland" },
      { code: "SJC", name: "San Jose" },
    ],
  },
  {
    city: "Washington DC",
    code: "WAS",
    airports: [
      { code: "DCA", name: "Reagan National" },
      { code: "IAD", name: "Dulles" },
      { code: "BWI", name: "Baltimore" },
    ],
  },
  {
    city: "Miami",
    code: "MIA",
    airports: [
      { code: "MIA", name: "Miami Intl" },
      { code: "FLL", name: "Fort Lauderdale" },
      { code: "PBI", name: "Palm Beach" },
    ],
  },
  {
    city: "Dallas",
    code: "DFW",
    airports: [
      { code: "DFW", name: "Dallas/Fort Worth" },
      { code: "DAL", name: "Love Field" },
    ],
  },
  {
    city: "Houston",
    code: "HOU",
    airports: [
      { code: "IAH", name: "George Bush Intercontinental" },
      { code: "HOU", name: "Hobby" },
    ],
  },
  {
    city: "Boston",
    code: "BOS",
    airports: [{ code: "BOS", name: "Logan Intl" }],
  },
  {
    city: "Seattle",
    code: "SEA",
    airports: [{ code: "SEA", name: "Seattle-Tacoma" }],
  },
  {
    city: "Denver",
    code: "DEN",
    airports: [{ code: "DEN", name: "Denver Intl" }],
  },
  {
    city: "Atlanta",
    code: "ATL",
    airports: [{ code: "ATL", name: "Hartsfield-Jackson" }],
  },
  {
    city: "Philadelphia",
    code: "PHL",
    airports: [{ code: "PHL", name: "Philadelphia Intl" }],
  },
  {
    city: "Phoenix",
    code: "PHX",
    airports: [{ code: "PHX", name: "Sky Harbor" }],
  },
  {
    city: "Detroit",
    code: "DTW",
    airports: [{ code: "DTW", name: "Detroit Metro" }],
  },
  {
    city: "Minneapolis",
    code: "MSP",
    airports: [{ code: "MSP", name: "Minneapolis-St. Paul" }],
  },
];

interface TripOptionsFormProps {
  durationRange: [number, number];
  onDurationRangeChange: (value: [number, number]) => void;
  startDate: Date | undefined;
  endDate: Date | undefined;
  onStartDateChange: (date: Date | undefined) => void;
  onEndDateChange: (date: Date | undefined) => void;
  budget: number;
  onBudgetChange: (value: number) => void;
  departureCity: string;
  onDepartureCityChange: (value: string) => void;
  flightPreference: 'nonstop' | 'any';
  onFlightPreferenceChange: (value: 'nonstop' | 'any') => void;
}

const budgetRanges = [
  { min: 0, max: 50, label: "Budget", range: "$0 - $50" },
  { min: 50, max: 100, label: "Moderate", range: "$50 - $100" },
  { min: 100, max: 200, label: "Comfortable", range: "$100 - $200" },
  { min: 200, max: 500, label: "Luxury", range: "$200 - $500+" },
];

export function TripOptionsForm({
  durationRange,
  onDurationRangeChange,
  startDate,
  endDate,
  onStartDateChange,
  onEndDateChange,
  budget,
  onBudgetChange,
  departureCity,
  onDepartureCityChange,
  flightPreference,
  onFlightPreferenceChange,
}: TripOptionsFormProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const getBudgetInfo = (value: number) => {
    if (value <= 25) return budgetRanges[0];
    if (value <= 50) return budgetRanges[1];
    if (value <= 75) return budgetRanges[2];
    return budgetRanges[3];
  };

  const adjustDate = (type: 'start' | 'end', direction: 'add' | 'subtract') => {
    const date = type === 'start' ? startDate : endDate;
    if (!date) return;
    
    const newDate = direction === 'add' ? addDays(date, 1) : subDays(date, 1);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    if (type === 'start') {
      if (newDate >= today && (!endDate || newDate <= endDate)) {
        onStartDateChange(newDate);
      }
    } else {
      if (!startDate || newDate >= startDate) {
        onEndDateChange(newDate);
      }
    }
  };

  const budgetInfo = getBudgetInfo(budget);

  return (
    <div className="space-y-4">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors duration-200 group"
      >
        <span className="text-sm font-medium">Trip details & flight preferences</span>
        {isExpanded ? (
          <ChevronUp className="w-4 h-4 group-hover:-translate-y-0.5 transition-transform" />
        ) : (
          <ChevronDown className="w-4 h-4 group-hover:translate-y-0.5 transition-transform" />
        )}
      </button>

      <div className={cn(
        "grid gap-6 overflow-hidden transition-all duration-500",
        isExpanded ? "grid-rows-[1fr] opacity-100" : "grid-rows-[0fr] opacity-0"
      )}>
        <div className="overflow-hidden">
          <div className="grid grid-cols-1 gap-6 pt-2">
            {/* Flight Preferences Section */}
            <div className="p-4 bg-muted/50 rounded-lg space-y-4">
              <h4 className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Plane className="w-4 h-4 text-primary" />
                Flight Preferences
              </h4>
              
              {/* Departure Airport */}
              <div className="space-y-2">
                <Label className="flex items-center gap-2 text-sm text-muted-foreground">
                  <MapPinned className="w-3 h-3" />
                  Departing from
                </Label>
                <Select value={departureCity} onValueChange={onDepartureCityChange}>
                  <SelectTrigger className="bg-background">
                    <SelectValue placeholder="Select departure airport..." />
                  </SelectTrigger>
                  <SelectContent className="max-h-[300px]">
                    {airportGroups.map((group) => (
                      <SelectGroup key={group.code}>
                        <SelectLabel className="text-xs text-muted-foreground font-semibold">
                          {group.city}
                        </SelectLabel>
                        {group.airports.length > 1 && (
                          <SelectItem value={`${group.code}-ALL`} className="pl-4">
                            <span className="font-medium">{group.code}</span>
                            <span className="text-muted-foreground ml-2">All {group.city} Airports</span>
                          </SelectItem>
                        )}
                        {group.airports.map((airport) => (
                          <SelectItem key={airport.code} value={airport.code} className="pl-4">
                            <span className="font-medium">{airport.code}</span>
                            <span className="text-muted-foreground ml-2">{airport.name}</span>
                          </SelectItem>
                        ))}
                      </SelectGroup>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Flight Type */}
              <div className="space-y-2">
                <Label className="text-sm text-muted-foreground">Flight type</Label>
                <RadioGroup
                  value={flightPreference}
                  onValueChange={(value) => onFlightPreferenceChange(value as 'nonstop' | 'any')}
                  className="flex gap-4"
                >
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="nonstop" id="nonstop" />
                    <Label htmlFor="nonstop" className="text-sm cursor-pointer">Nonstop only</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="any" id="any" />
                    <Label htmlFor="any" className="text-sm cursor-pointer">Any (including layovers)</Label>
                  </div>
                </RadioGroup>
              </div>
            </div>

            {/* Duration Range */}
            <div className="space-y-3">
              <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Clock className="w-4 h-4 text-primary" />
                Trip Duration Range
              </label>
              <div className="space-y-2">
                <Slider
                  value={durationRange}
                  onValueChange={(value) => onDurationRangeChange(value as [number, number])}
                  min={1}
                  max={30}
                  step={1}
                  className="w-full"
                />
                <p className="text-sm text-muted-foreground text-center">
                  {durationRange[0]} - {durationRange[1]} days
                </p>
              </div>
            </div>

            {/* Date Pickers */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              {/* Start Date */}
              <div className="space-y-3">
                <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Calendar className="w-4 h-4 text-primary" />
                  Start Date
                </label>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="shrink-0"
                    onClick={() => adjustDate('start', 'subtract')}
                    disabled={!startDate || startDate <= new Date()}
                  >
                    <Minus className="w-4 h-4" />
                  </Button>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "flex-1 justify-start text-left font-normal",
                          !startDate && "text-muted-foreground"
                        )}
                      >
                        {startDate ? format(startDate, "PPP") : "Pick start date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <CalendarComponent
                        mode="single"
                        selected={startDate}
                        onSelect={onStartDateChange}
                        initialFocus
                        className="pointer-events-auto"
                        disabled={(date) => {
                          const today = new Date();
                          today.setHours(0, 0, 0, 0);
                          return date < today || (endDate ? date > endDate : false);
                        }}
                      />
                    </PopoverContent>
                  </Popover>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="shrink-0"
                    onClick={() => adjustDate('start', 'add')}
                    disabled={!startDate || (endDate && startDate >= endDate)}
                  >
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              {/* End Date */}
              <div className="space-y-3">
                <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Calendar className="w-4 h-4 text-primary" />
                  End Date
                </label>
                <div className="flex items-center gap-2">
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="shrink-0"
                    onClick={() => adjustDate('end', 'subtract')}
                    disabled={!endDate || (startDate && endDate <= startDate)}
                  >
                    <Minus className="w-4 h-4" />
                  </Button>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button
                        variant="outline"
                        className={cn(
                          "flex-1 justify-start text-left font-normal",
                          !endDate && "text-muted-foreground"
                        )}
                      >
                        {endDate ? format(endDate, "PPP") : "Pick end date"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <CalendarComponent
                        mode="single"
                        selected={endDate}
                        onSelect={onEndDateChange}
                        initialFocus
                        className="pointer-events-auto"
                        disabled={(date) => {
                          const today = new Date();
                          today.setHours(0, 0, 0, 0);
                          return date < today || (startDate ? date < startDate : false);
                        }}
                      />
                    </PopoverContent>
                  </Popover>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    className="shrink-0"
                    onClick={() => adjustDate('end', 'add')}
                    disabled={!endDate}
                  >
                    <Plus className="w-4 h-4" />
                  </Button>
                </div>
              </div>
            </div>

            {/* Budget */}
            <div className="space-y-3">
              <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Wallet className="w-4 h-4 text-primary" />
                Accommodation Budget (per night)
              </label>
              <div className="space-y-2">
                <Slider
                  value={[budget]}
                  onValueChange={([value]) => onBudgetChange(value)}
                  min={0}
                  max={100}
                  step={25}
                  className="w-full"
                />
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-foreground">
                    {budgetInfo.label}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {budgetInfo.range} / night
                  </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
