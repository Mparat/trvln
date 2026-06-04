import { useState, forwardRef } from "react";
import { 
  Sparkles, Camera, MapPin, Calendar, Clock, Wallet, Plane, 
  Building, Trees, Tent, Heart, Users, Zap, 
  Utensils, Wine, PartyPopper, GraduationCap, Globe,
  ChevronDown, ChevronUp, Plus
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { MediaDropZone, MediaItem } from "./MediaDropZone";
import { AirportSelector } from "./AirportSelector";
import { cn } from "@/lib/utils";
import { format, differenceInDays } from "date-fns";
import type { DateRange } from "react-day-picker";

export interface TripPreferences {
  // Inspiration
  media: MediaItem[];
  cities: string[];
  
  // Logistics
  budgetAccommodation: number;
  budgetFlight: number;
  dateFlexibility: 'strict' | 'flexible-days' | 'month' | 'anytime';
  startDate?: Date;
  endDate?: Date;
  flexibleDays?: number; // ± days for flexible-days option
  targetMonth?: string;
  durationFlexibility: 'strict' | 'flexible-days' | 'weekend' | 'long-weekend' | '1-week' | '2-weeks' | 'flexible';
  durationDays: number;
  noFlight: boolean; // Skip flight-related content
  departureCity: string;
  flightDirectness: 'nonstop' | 'short-layover' | 'long-layover';
  
  // Vibe
  atmosphere: string[];
  adventureLevel: string;
  guidedPreference: 'fully-guided' | 'some-guided' | 'self-guided';
  foodDrink: string[];
  interests: string[];
  
  // Open text
  additionalNotes: string;
}

interface TripInputFormProps {
  preferences: TripPreferences;
  onPreferencesChange: (preferences: TripPreferences) => void;
  onGenerate: (pendingCity?: string) => void;
  isGenerating: boolean;
  onFramesReady?: (frameUrls: string[]) => void;
}

const atmosphereOptions = [
  { id: 'city', label: 'City', icon: Building },
  { id: 'nature', label: 'Nature', icon: Trees },
  { id: 'off-beaten-path', label: 'Off the beaten path', icon: MapPin },
  { id: 'backcountry', label: 'Backcountry', icon: Tent },
];

const adventureOptions = [
  { id: 'none', label: 'Relaxed' },
  { id: 'family', label: 'Family-friendly' },
  { id: 'active', label: 'Active' },
  { id: 'adrenaline', label: 'Adrenaline junky' },
];

const guidedOptions = [
  { id: 'fully-guided', label: 'Prefer guided trips' },
  { id: 'some-guided', label: 'Some guided activities' },
  { id: 'self-guided', label: 'Just self-guided' },
];

const foodDrinkOptions = [
  { id: 'local', label: 'Local bites', icon: Utensils },
  { id: 'casual', label: 'Casual & safe', icon: Utensils },
  { id: 'romantic', label: 'Romantic', icon: Heart },
  { id: 'family', label: 'Family-friendly', icon: Users },
  { id: 'party', label: 'Party & nightlife', icon: PartyPopper },
];

const interestOptions = [
  { id: 'educational', label: 'Educational' },
  { id: 'culture', label: 'Learn the culture' },
  { id: 'food', label: 'Food & drink experience' },
  { id: 'instagram', label: "For the 'gram" },
  { id: 'activities', label: 'Activities & adventures' },
  { id: 'nature', label: 'Natural beauty' },
];

const budgetLabels = [
  { min: 0, max: 25, label: "Budget", range: "$0 - $50" },
  { min: 25, max: 50, label: "Moderate", range: "$50 - $100" },
  { min: 50, max: 75, label: "Comfortable", range: "$100 - $200" },
  { min: 75, max: 100, label: "Luxury", range: "$200+" },
];

const flightBudgetLabels = [
  { min: 0, max: 25, label: "Budget", range: "$100 - $300" },
  { min: 25, max: 50, label: "Moderate", range: "$300 - $600" },
  { min: 50, max: 75, label: "Comfortable", range: "$600 - $1000" },
  { min: 75, max: 100, label: "Premium", range: "$1000+" },
];

interface SectionHeaderProps {
  icon: React.ElementType;
  title: string;
  isExpanded: boolean;
  description: string;
}

const SectionHeader = forwardRef<HTMLButtonElement, SectionHeaderProps & React.ButtonHTMLAttributes<HTMLButtonElement>>(
  ({ icon: Icon, title, isExpanded, description, ...props }, ref) => (
    <button
      ref={ref}
      type="button"
      className="flex items-center justify-between w-full p-4 hover:bg-muted/50 rounded-xl transition-colors"
      {...props}
    >
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
          <Icon className="w-5 h-5 text-primary" />
        </div>
        <div className="text-left">
          <h3 className="font-display font-semibold text-foreground">{title}</h3>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>
      </div>
      {isExpanded ? (
        <ChevronUp className="w-5 h-5 text-muted-foreground" />
      ) : (
        <ChevronDown className="w-5 h-5 text-muted-foreground" />
      )}
    </button>
  )
);

SectionHeader.displayName = 'SectionHeader';

export function TripInputForm({ preferences, onPreferencesChange, onGenerate, isGenerating, onFramesReady }: TripInputFormProps) {
  const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
    inspiration: true,
    logistics: false,
    vibe: false,
    notes: false,
  });
  const [newCity, setNewCity] = useState("");

  const toggleSection = (section: string) => {
    setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
  };

  const updatePreferences = (updates: Partial<TripPreferences>) => {
    onPreferencesChange({ ...preferences, ...updates });
  };

  const addCity = () => {
    if (newCity.trim() && !preferences.cities.includes(newCity.trim())) {
      updatePreferences({ cities: [...preferences.cities, newCity.trim()] });
      setNewCity("");
    }
  };

  // Handle generate - pass pending city text to parent for validation
  const handleGenerate = () => {
    const pendingCity = newCity.trim();
    if (pendingCity) {
      setNewCity("");
    }
    onGenerate(pendingCity || undefined);
  };

  const removeCity = (city: string) => {
    updatePreferences({ cities: preferences.cities.filter(c => c !== city) });
  };

  const toggleArrayItem = (field: 'atmosphere' | 'foodDrink' | 'interests', item: string) => {
    const current = preferences[field];
    if (current.includes(item)) {
      updatePreferences({ [field]: current.filter(i => i !== item) });
    } else {
      updatePreferences({ [field]: [...current, item] });
    }
  };

  const getBudgetLabel = (value: number, labels: typeof budgetLabels) => {
    const label = labels.find(l => value >= l.min && value <= l.max) || labels[labels.length - 1];
    return label;
  };

  return (
    <div className="bg-card rounded-2xl shadow-medium overflow-hidden animate-slide-up">
      {/* Section 1: Inspiration */}
      <Collapsible open={expandedSections.inspiration} onOpenChange={() => toggleSection('inspiration')}>
        <CollapsibleTrigger asChild>
          <SectionHeader 
            icon={Camera} 
            title="Inspiration" 
            isExpanded={expandedSections.inspiration}
            description="Screenshots, links, cities you want to visit"
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-6 pb-6 space-y-5">
            {/* Media Drop Zone */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground flex items-center gap-2">
                📸 Drop screenshots or travel videos
              </label>
              <MediaDropZone
                media={preferences.media}
                onMediaChange={(media) => updatePreferences({ media })}
                onFramesReady={onFramesReady}
              />
              <p className="text-xs text-muted-foreground">Screen recordings, saved Instagram posts, travel photos</p>
            </div>

            {/* Cities */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground flex items-center gap-2">
                <MapPin className="w-4 h-4" /> Cities or places you want to visit
              </label>
              <div className="flex gap-2">
                <Input 
                  value={newCity}
                  onChange={(e) => setNewCity(e.target.value)}
                  placeholder="e.g. Kyoto, Amalfi Coast..."
                  onKeyDown={(e) => e.key === 'Enter' && addCity()}
                />
                <Button type="button" variant="outline" size="icon" onClick={addCity}>
                  <Plus className="w-4 h-4" />
                </Button>
              </div>
              {preferences.cities.length > 0 && (
                <div className="flex flex-wrap gap-2 mt-2">
                  {preferences.cities.map((city) => (
                    <Badge key={city} variant="secondary" className="cursor-pointer" onClick={() => removeCity(city)}>
                      {city} ✕
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

      <div className="border-t border-border" />

      {/* Section 2: Logistics */}
      <Collapsible open={expandedSections.logistics} onOpenChange={() => toggleSection('logistics')}>
        <CollapsibleTrigger asChild>
          <SectionHeader 
            icon={Plane} 
            title="Logistics" 
            isExpanded={expandedSections.logistics}
            description="Budget, dates, duration, flights"
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-6 pb-6 space-y-6">
            {/* Budgets */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Accommodation Budget */}
              <div className="space-y-3">
                <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Wallet className="w-4 h-4 text-primary" />
                  Accommodation Budget (per night)
                </label>
                <Slider
                  value={[preferences.budgetAccommodation]}
                  onValueChange={([value]) => updatePreferences({ budgetAccommodation: value })}
                  min={0}
                  max={100}
                  step={25}
                  className="w-full"
                />
                <div className="flex justify-between text-sm">
                  <span className="font-medium">{getBudgetLabel(preferences.budgetAccommodation, budgetLabels).label}</span>
                  <span className="text-muted-foreground">{getBudgetLabel(preferences.budgetAccommodation, budgetLabels).range}</span>
                </div>
              </div>

              {/* Flight Budget - only show if flights are needed */}
              {!preferences.noFlight && (
                <div className="space-y-3">
                  <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                    <Plane className="w-4 h-4 text-primary" />
                    Flight Budget (round trip)
                  </label>
                  <Slider
                    value={[preferences.budgetFlight]}
                    onValueChange={([value]) => updatePreferences({ budgetFlight: value })}
                    min={0}
                    max={100}
                    step={25}
                    className="w-full"
                  />
                  <div className="flex justify-between text-sm">
                    <span className="font-medium">{getBudgetLabel(preferences.budgetFlight, flightBudgetLabels).label}</span>
                    <span className="text-muted-foreground">{getBudgetLabel(preferences.budgetFlight, flightBudgetLabels).range}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Date Flexibility */}
            <div className="space-y-3">
              <label className="text-sm font-medium text-foreground flex items-center gap-2">
                <Calendar className="w-4 h-4 text-primary" />
                When are you traveling?
              </label>
              <RadioGroup
                value={preferences.dateFlexibility}
                onValueChange={(value) => updatePreferences({ dateFlexibility: value as TripPreferences['dateFlexibility'] })}
                className="grid grid-cols-2 md:grid-cols-4 gap-2"
              >
                {[
                  { value: 'strict', label: 'Exact dates' },
                  { value: 'month', label: 'A certain month' },
                  { value: 'anytime', label: 'Anytime' },
                ].map(opt => (
                  <div key={opt.value}>
                    <RadioGroupItem value={opt.value} id={`date-${opt.value}`} className="peer sr-only" />
                    <Label
                      htmlFor={`date-${opt.value}`}
                      className="flex items-center justify-center px-3 py-2 text-sm border rounded-lg cursor-pointer peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 hover:bg-muted/50 transition-colors"
                    >
                      {opt.label}
                    </Label>
                  </div>
                ))}
              </RadioGroup>

              {preferences.dateFlexibility === 'strict' && (
                <div className="space-y-4 mt-3">
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className={cn("w-full justify-start", !preferences.startDate && "text-muted-foreground")}>
                        {preferences.startDate && preferences.endDate ? (
                          <>
                            {format(preferences.startDate, "MMM d, yyyy")} — {format(preferences.endDate, "MMM d, yyyy")}
                            <span className="ml-auto text-xs text-muted-foreground">
                              {differenceInDays(preferences.endDate, preferences.startDate) + 1} days
                            </span>
                          </>
                        ) : preferences.startDate ? (
                          <>
                            {format(preferences.startDate, "MMM d, yyyy")} — Select end date
                          </>
                        ) : (
                          "Select travel dates"
                        )}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <div className="p-3 border-b border-border">
                        <p className="text-sm text-muted-foreground">
                          {!preferences.startDate ? "Select your start date" : !preferences.endDate ? "Now select your end date" : "Click to change dates"}
                        </p>
                      </div>
                      <CalendarComponent
                        mode="range"
                        selected={{ from: preferences.startDate, to: preferences.endDate } as DateRange}
                        onSelect={(range) => {
                          const from = range?.from;
                          const to = range?.to;

                          // When exact dates are selected, lock duration to the date range
                          if (from && to) {
                            const days = differenceInDays(to, from) + 1;
                            updatePreferences({
                              startDate: from,
                              endDate: to,
                              durationFlexibility: 'strict',
                              durationDays: days,
                            });
                            return;
                          }

                          updatePreferences({
                            startDate: from,
                            endDate: to,
                          });
                        }}
                        disabled={(date) => date < new Date()}
                        numberOfMonths={2}
                        className="pointer-events-auto"
                      />
                      {/* Flexible days option inside date picker */}
                      <div className="p-3 border-t border-border flex items-center gap-3">
                        <Checkbox
                          id="flexible-days"
                          checked={!!preferences.flexibleDays}
                          onCheckedChange={(checked) => updatePreferences({ flexibleDays: checked ? 2 : undefined })}
                        />
                        <Label htmlFor="flexible-days" className="text-sm cursor-pointer">
                          ± a few days is okay
                        </Label>
                        {preferences.flexibleDays && (
                          <select
                            value={preferences.flexibleDays}
                            onChange={(e) => updatePreferences({ flexibleDays: parseInt(e.target.value) })}
                            className="ml-auto text-sm border rounded px-2 py-1 bg-background"
                          >
                            <option value={1}>± 1 day</option>
                            <option value={2}>± 2 days</option>
                            <option value={3}>± 3 days</option>
                            <option value={5}>± 5 days</option>
                            <option value={7}>± 1 week</option>
                          </select>
                        )}
                      </div>
                    </PopoverContent>
                  </Popover>
                </div>
              )}

              {preferences.dateFlexibility === 'month' && (
                <Input 
                  placeholder="e.g. April 2025, Spring, Fall..."
                  value={preferences.targetMonth || ''}
                  onChange={(e) => updatePreferences({ targetMonth: e.target.value })}
                  className="mt-3"
                />
              )}
            </div>

            {/* Duration - only show when NOT using exact dates */}
            {preferences.dateFlexibility !== 'strict' && (
              <div className="space-y-3">
                <label className="text-sm font-medium text-foreground flex items-center gap-2">
                  <Clock className="w-4 h-4 text-primary" />
                  Trip duration
                </label>
                <RadioGroup
                  value={preferences.durationFlexibility}
                  onValueChange={(value) => updatePreferences({ durationFlexibility: value as TripPreferences['durationFlexibility'] })}
                  className="grid grid-cols-2 md:grid-cols-4 gap-2"
                >
                  {[
                    { value: 'weekend', label: 'Weekend' },
                    { value: 'long-weekend', label: 'Long weekend' },
                    { value: '1-week', label: '1 week' },
                    { value: '2-weeks', label: '2 weeks' },
                    { value: 'strict', label: 'Exact days' },
                    { value: 'flexible', label: 'Flexible' },
                  ].map(opt => (
                    <div key={opt.value}>
                      <RadioGroupItem value={opt.value} id={`dur-${opt.value}`} className="peer sr-only" />
                      <Label
                        htmlFor={`dur-${opt.value}`}
                        className="flex items-center justify-center px-3 py-2 text-sm border rounded-lg cursor-pointer peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 hover:bg-muted/50 transition-colors"
                      >
                        {opt.label}
                      </Label>
                    </div>
                  ))}
                </RadioGroup>

                {(preferences.durationFlexibility === 'strict' || preferences.durationFlexibility === 'flexible-days') && (
                  <div className="flex items-center gap-3 mt-3">
                    <Input 
                      type="number"
                      min={1}
                      max={60}
                      value={preferences.durationDays}
                      onChange={(e) => updatePreferences({ durationDays: parseInt(e.target.value) || 7 })}
                      className="w-24"
                    />
                    <span className="text-sm text-muted-foreground">days</span>
                  </div>
                )}
              </div>
            )}

            {/* Flight Preferences */}
            <div className="p-4 bg-muted/50 rounded-xl space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="flex items-center gap-2 text-sm font-medium text-foreground">
                  <Plane className="w-4 h-4 text-primary" />
                  Flight Preferences
                </h4>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="no-flight"
                    checked={preferences.noFlight}
                    onCheckedChange={(checked) => updatePreferences({ noFlight: !!checked })}
                  />
                  <Label htmlFor="no-flight" className="text-sm cursor-pointer text-muted-foreground">
                    No flight needed
                  </Label>
                </div>
              </div>
              
              {!preferences.noFlight ? (
                <>
                  <div className="space-y-2">
                    <Label className="text-sm text-muted-foreground">Departing from</Label>
                    <AirportSelector 
                      value={preferences.departureCity} 
                      onChange={(value) => updatePreferences({ departureCity: value })} 
                    />
                  </div>

                  <div className="space-y-2">
                    <Label className="text-sm text-muted-foreground">Flight directness</Label>
                    <RadioGroup
                      value={preferences.flightDirectness}
                      onValueChange={(value) => updatePreferences({ flightDirectness: value as TripPreferences['flightDirectness'] })}
                      className="flex flex-wrap gap-4"
                    >
                      {[
                        { value: 'nonstop', label: 'Nonstop only' },
                        { value: 'short-layover', label: 'Short layovers OK' },
                        { value: 'long-layover', label: 'Any layovers' },
                      ].map(opt => (
                        <div key={opt.value} className="flex items-center space-x-2">
                          <RadioGroupItem value={opt.value} id={`flight-${opt.value}`} />
                          <Label htmlFor={`flight-${opt.value}`} className="text-sm cursor-pointer">{opt.label}</Label>
                        </div>
                      ))}
                    </RadioGroup>
                  </div>
                </>
              ) : (
                <p className="text-sm text-muted-foreground">
                  The itinerary will skip all flight-related content (e.g., road trip, train, local trip).
                </p>
              )}
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

      <div className="border-t border-border" />

      {/* Section 3: Vibe */}
      <Collapsible open={expandedSections.vibe} onOpenChange={() => toggleSection('vibe')}>
        <CollapsibleTrigger asChild>
          <SectionHeader 
            icon={Heart} 
            title="Vibe" 
            isExpanded={expandedSections.vibe}
            description="Atmosphere, adventure, food preferences"
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-6 pb-6 space-y-6">
            {/* Atmosphere */}
            <div className="space-y-3">
              <label className="text-sm font-medium text-foreground">Atmosphere (select all that apply)</label>
              <div className="flex flex-wrap gap-2">
                {atmosphereOptions.map(opt => (
                  <Button
                    key={opt.id}
                    type="button"
                    variant={preferences.atmosphere.includes(opt.id) ? "default" : "outline"}
                    size="sm"
                    onClick={() => toggleArrayItem('atmosphere', opt.id)}
                    className="gap-2"
                  >
                    <opt.icon className="w-4 h-4" />
                    {opt.label}
                  </Button>
                ))}
              </div>
            </div>

            {/* Adventure Level */}
            <div className="space-y-3">
              <label className="text-sm font-medium text-foreground flex items-center gap-2">
                <Zap className="w-4 h-4 text-primary" />
                Adventure level
              </label>
              <RadioGroup
                value={preferences.adventureLevel}
                onValueChange={(value) => updatePreferences({ adventureLevel: value })}
                className="flex flex-wrap gap-2"
              >
                {adventureOptions.map(opt => (
                  <div key={opt.id}>
                    <RadioGroupItem value={opt.id} id={`adv-${opt.id}`} className="peer sr-only" />
                    <Label
                      htmlFor={`adv-${opt.id}`}
                      className="flex items-center px-4 py-2 text-sm border rounded-lg cursor-pointer peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 hover:bg-muted/50 transition-colors"
                    >
                      {opt.label}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </div>

            {/* Guided vs Self-serve */}
            <div className="space-y-3">
              <label className="text-sm font-medium text-foreground flex items-center gap-2">
                <Users className="w-4 h-4 text-primary" />
                Guided vs. self-serve activities
              </label>
              <RadioGroup
                value={preferences.guidedPreference}
                onValueChange={(value) => updatePreferences({ guidedPreference: value as TripPreferences['guidedPreference'] })}
                className="flex flex-wrap gap-2"
              >
                {guidedOptions.map(opt => (
                  <div key={opt.id}>
                    <RadioGroupItem value={opt.id} id={`guided-${opt.id}`} className="peer sr-only" />
                    <Label
                      htmlFor={`guided-${opt.id}`}
                      className="flex items-center px-4 py-2 text-sm border rounded-lg cursor-pointer peer-data-[state=checked]:border-primary peer-data-[state=checked]:bg-primary/5 hover:bg-muted/50 transition-colors"
                    >
                      {opt.label}
                    </Label>
                  </div>
                ))}
              </RadioGroup>
            </div>

            {/* Food & Drink */}
            <div className="space-y-3">
              <label className="text-sm font-medium text-foreground flex items-center gap-2">
                <Utensils className="w-4 h-4 text-primary" />
                Food & drink preferences
              </label>
              <div className="flex flex-wrap gap-2">
                {foodDrinkOptions.map(opt => (
                  <Button
                    key={opt.id}
                    type="button"
                    variant={preferences.foodDrink.includes(opt.id) ? "default" : "outline"}
                    size="sm"
                    onClick={() => toggleArrayItem('foodDrink', opt.id)}
                    className="gap-2"
                  >
                    <opt.icon className="w-4 h-4" />
                    {opt.label}
                  </Button>
                ))}
              </div>
            </div>

            {/* Interests */}
            <div className="space-y-3">
              <label className="text-sm font-medium text-foreground flex items-center gap-2">
                <Globe className="w-4 h-4 text-primary" />
                What matters most? (select & drag to rank)
              </label>
              <div className="flex flex-wrap gap-2">
                {interestOptions.map(opt => (
                  <Button
                    key={opt.id}
                    type="button"
                    variant={preferences.interests.includes(opt.id) ? "default" : "outline"}
                    size="sm"
                    onClick={() => toggleArrayItem('interests', opt.id)}
                  >
                    {opt.label}
                    {preferences.interests.includes(opt.id) && (
                      <span className="ml-2 text-xs opacity-70">
                        #{preferences.interests.indexOf(opt.id) + 1}
                      </span>
                    )}
                  </Button>
                ))}
              </div>
            </div>
          </div>
        </CollapsibleContent>
      </Collapsible>

      <div className="border-t border-border" />

      {/* Section 4: Additional Notes */}
      <Collapsible open={expandedSections.notes} onOpenChange={() => toggleSection('notes')}>
        <CollapsibleTrigger asChild>
          <SectionHeader 
            icon={Sparkles} 
            title="Additional Notes" 
            isExpanded={expandedSections.notes}
            description="Anything else we should know"
          />
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="px-6 pb-6">
            <Textarea
              value={preferences.additionalNotes}
              onChange={(e) => updatePreferences({ additionalNotes: e.target.value })}
              placeholder="Tell us more... dietary restrictions, mobility needs, specific places you've heard about, things you want to avoid, travel companions, etc."
              className="min-h-[120px] resize-none"
            />
          </div>
        </CollapsibleContent>
      </Collapsible>

      {/* Generate Button */}
      <div className="p-6 bg-muted/30 border-t border-border">
        <Button
          onClick={handleGenerate}
          disabled={isGenerating}
          variant="hero"
          className="w-full"
          size="lg"
        >
          {isGenerating ? (
            <>
              <Sparkles className="w-5 h-5 animate-spin" />
              Crafting your perfect trip...
            </>
          ) : (
            <>
              <Sparkles className="w-5 h-5" />
              Plan My Trip
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
