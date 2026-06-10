import { useState, useRef } from "react";
import {
  Sparkles, Camera, MapPin, Calendar, Clock, Wallet, Plane,
  Building, Trees, Tent, Heart, Users, Zap,
  Utensils, PartyPopper, Globe, GraduationCap, Landmark, Mountain,
  Plus, Check, Link as LinkIcon, Loader2
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Slider } from "@/components/ui/slider";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { MediaDropZone, MediaItem, MediaDropZoneHandle } from "./MediaDropZone";
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
  isIdentifyingLocations?: boolean;
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
  { id: 'educational', label: 'Educational', icon: GraduationCap },
  { id: 'culture', label: 'Culture', icon: Landmark },
  { id: 'food', label: 'Food & drink', icon: Utensils },
  { id: 'instagram', label: "For the 'gram", icon: Camera },
  { id: 'activities', label: 'Adventures', icon: Mountain },
  { id: 'nature', label: 'Nature', icon: Trees },
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

const suggestionChips = [
  "A relaxed week somewhere warm",
  "Hidden gems in Japan",
  "Romantic coastal Europe",
  "Off-grid nature, big hikes",
];

const stepIcons = [Camera, Plane, Heart];
const stepLabels = ["Inspiration", "Logistics", "Vibe"];

export function TripInputForm({ preferences, onPreferencesChange, onGenerate, isGenerating, onFramesReady, isIdentifyingLocations }: TripInputFormProps) {
  const [currentStep, setCurrentStep] = useState(0);
  const [isDragging, setIsDragging] = useState(false);
  const [newCity, setNewCity] = useState("");
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaRef = useRef<MediaDropZoneHandle>(null);

  const updatePreferences = (updates: Partial<TripPreferences>) => {
    onPreferencesChange({ ...preferences, ...updates });
  };

  const addCity = () => {
    if (newCity.trim() && !preferences.cities.includes(newCity.trim())) {
      updatePreferences({ cities: [...preferences.cities, newCity.trim()] });
      setNewCity("");
    }
  };

  const removeCity = (city: string) => {
    updatePreferences({ cities: preferences.cities.filter(c => c !== city) });
  };

  const handleGenerate = () => {
    onGenerate(undefined);
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

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files).filter(f =>
      f.type.startsWith('image/') || f.type.startsWith('video/')
    );
    if (files.length > 0) mediaRef.current?.processFiles(files);
  };

  const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const text = e.clipboardData.getData('text');
    if (text && (text.includes('tiktok.com') || text.includes('instagram.com'))) {
      e.preventDefault();
      mediaRef.current?.addUrl(text.trim());
    }
  };

  // Step indicator
  const StepIndicator = () => (
    <div className="px-6 pt-5 pb-4">
      {/* Progress bar */}
      <div className="flex gap-1.5 mb-4">
        {[0, 1, 2].map(i => (
          <div
            key={i}
            className={cn(
              "h-[3px] flex-1 rounded-full transition-colors duration-300",
              i <= currentStep ? "bg-primary" : "bg-muted"
            )}
          />
        ))}
      </div>
      {/* Step labels */}
      <div className="grid grid-cols-3 gap-1.5">
        {stepLabels.map((label, i) => {
          const Icon = stepIcons[i];
          const isActive = i === currentStep;
          const isDone = i < currentStep;
          return (
            <button
              key={i}
              type="button"
              onClick={() => i < currentStep && setCurrentStep(i)}
              className={cn(
                "flex items-center gap-2 text-sm transition-colors justify-start",
                isActive ? "text-foreground font-semibold" : isDone ? "text-primary cursor-pointer" : "text-muted-foreground"
              )}
            >
              <span className={cn(
                "w-6 h-6 rounded-full flex items-center justify-center text-xs font-bold shrink-0",
                isActive ? "bg-foreground text-background" : isDone ? "bg-primary text-primary-foreground" : "border-2 border-muted-foreground/30 text-muted-foreground"
              )}>
                {isDone ? <Check className="w-3 h-3" /> : i + 1}
              </span>
              <Icon className="w-3.5 h-3.5" />
              {label}
            </button>
          );
        })}
      </div>
    </div>
  );

  // Compact media card for step 0
  const CompactMediaCard = ({ item, index }: { item: MediaItem; index: number }) => {
    const isImage = item.type === 'image' && item.preview;
    const rawLabel = item.file?.name || (item.url ? item.url.replace(/^https?:\/\//, '') : 'Media');
    const label = rawLabel.length > 10 ? rawLabel.slice(0, 10) + '…' : rawLabel;
    return (
      <div className="relative w-[90px] flex-shrink-0 rounded-2xl border border-primary/20 bg-primary/10 flex flex-col items-center justify-center pt-5 pb-2.5 px-2 gap-2.5">
        {/* Icon or thumbnail */}
        {item.uploading ? (
          <Loader2 className="w-8 h-8 animate-spin text-primary/60" />
        ) : isImage ? (
          <img src={item.preview} alt="" className="w-10 h-10 rounded-lg object-cover" />
        ) : (
          <LinkIcon className="w-8 h-8 text-primary/70" />
        )}
        {/* Label */}
        <span className="text-[11px] font-semibold text-foreground/80 bg-background rounded-md px-2 py-1 truncate max-w-full">
          {label}
        </span>
        {/* Remove button */}
        <button
          type="button"
          onClick={() => updatePreferences({ media: preferences.media.filter((_, j) => j !== index) })}
          className="absolute top-1.5 right-1.5 w-5 h-5 flex items-center justify-center rounded-full bg-foreground text-background text-xs font-bold leading-none hover:bg-foreground/80"
        >
          ×
        </button>
      </div>
    );
  };

  // Radio button row item
  const RadioOption = ({
    isSelected,
    onClick,
    children,
  }: {
    isSelected: boolean;
    onClick: () => void;
    children: React.ReactNode;
  }) => (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "border rounded-full px-4 py-2 text-sm flex items-center gap-2 transition-colors",
        isSelected
          ? "border-primary bg-primary/5"
          : "border-border hover:bg-muted/40"
      )}
    >
      <span className={cn(
        "w-4 h-4 rounded-full border-2 flex items-center justify-center shrink-0",
        isSelected ? "border-primary" : "border-muted-foreground/30"
      )}>
        {isSelected && <span className="w-1.5 h-1.5 rounded-full bg-primary" />}
      </span>
      {children}
    </button>
  );

  // Toggle button for multi-select
  const ToggleOption = ({
    isSelected,
    onClick,
    icon: Icon,
    label,
    compact,
  }: {
    isSelected: boolean;
    onClick: () => void;
    icon?: React.ElementType;
    label: string;
    compact?: boolean;
  }) => (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "border rounded-full flex items-center transition-colors whitespace-nowrap",
        compact ? "px-3 py-1.5 text-[13px] gap-1.5" : "px-4 py-2 text-sm gap-2",
        isSelected
          ? "border-primary bg-primary/5"
          : "border-border hover:bg-muted/40"
      )}
    >
      {Icon && <Icon className={cn("shrink-0", compact ? "w-3.5 h-3.5" : "w-4 h-4")} />}
      {label}
      {isSelected && <Check className={cn("ml-0.5", compact ? "w-3 h-3" : "w-3 h-3 ml-1")} />}
    </button>
  );

  const renderStep0 = () => (
    <div
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
      className={cn(isDragging && "bg-primary/5 transition-colors")}
    >
      {/* Media cards */}
      {preferences.media.length > 0 && (
        <div className="px-6 pt-2 pb-3 flex flex-wrap gap-2">
          {preferences.media.map((item, i) => (
            <CompactMediaCard key={i} item={item} index={i} />
          ))}
        </div>
      )}

      {/* Textarea */}
      <div className="relative">
        <textarea
          value={preferences.additionalNotes}
          onChange={(e) => updatePreferences({ additionalNotes: e.target.value })}
          onPaste={handlePaste}
          placeholder={isIdentifyingLocations ? "" : "Describe your dream trip, paste a TikTok / Reel / listing link, or drop in a screenshot..."}
          className="w-full h-[120px] px-6 py-4 bg-transparent text-base text-foreground placeholder:text-muted-foreground/60 resize-none focus:outline-none"
        />
        {isIdentifyingLocations && !preferences.additionalNotes && (
          <div className="absolute top-4 left-6 flex items-center gap-2 text-primary pointer-events-none">
            <svg className="animate-spin w-4 h-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8z"/>
            </svg>
            <span className="text-lg">Identifying locations…</span>
          </div>
        )}
      </div>

      {/* City pills */}
      {preferences.cities.length > 0 && (
        <div className="px-6 pb-3 flex flex-wrap gap-2 items-center">
          {preferences.cities.map((city) => (
            <span key={city} className="flex items-center gap-1.5 bg-primary/10 text-primary text-[12px] rounded-full px-3 py-1.5 font-medium">
              <MapPin className="w-3.5 h-3.5 shrink-0" />
              {city}
              <button type="button" onClick={() => removeCity(city)} className="ml-1 opacity-60 hover:opacity-100">×</button>
            </span>
          ))}
        </div>
      )}

      {/* Separator */}
      <div className="border-t border-border mx-5" />

      {/* Bottom action row */}
      <div className="flex items-center justify-between px-5 py-3">
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="flex items-center gap-2.5 text-sm text-muted-foreground hover:text-foreground transition-colors"
        >
          <span className="w-9 h-9 rounded-full border border-border flex items-center justify-center shrink-0">
            <LinkIcon className="w-4 h-4" />
          </span>
          Attach or drop media
        </button>
        <Button
          type="button"
          variant="default"
          size="default"
          className="rounded-xl px-6 font-semibold"
          onClick={() => setCurrentStep(1)}
        >
          Continue ›
        </Button>
      </div>

      {/* Hidden inputs */}
      <MediaDropZone
        ref={mediaRef}
        compact
        media={preferences.media}
        onMediaChange={(media) => updatePreferences({ media })}
        onFramesReady={onFramesReady}
      />
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*,video/*"
        multiple
        className="sr-only"
        onChange={(e) => {
          const files = Array.from(e.target.files || []).filter(f =>
            f.type.startsWith('image/') || f.type.startsWith('video/')
          );
          if (files.length > 0) mediaRef.current?.processFiles(files);
          e.target.value = '';
        }}
      />
    </div>
  );

  const renderStep1 = () => (
    <div className="px-6 pb-6 space-y-6">
      <div>
        <h3 className="font-display font-semibold text-lg text-foreground">The practical bits</h3>
        <p className="text-sm text-muted-foreground mt-0.5">Rough is fine — you can change anything later.</p>
      </div>

      {/* Budgets */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Accommodation Budget */}
        <div className="space-y-3">
          <label className="flex items-center gap-2 text-sm font-medium text-foreground">
            <Wallet className="w-4 h-4 text-primary" />
            Accommodation (per night)
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

        {/* Flight Budget */}
        {!preferences.noFlight && (
          <div className="space-y-3">
            <label className="flex items-center gap-2 text-sm font-medium text-foreground">
              <Plane className="w-4 h-4 text-primary" />
              Flight budget (round trip)
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
        <div className="flex flex-wrap gap-2">
          {[
            { value: 'strict', label: 'Exact dates' },
            { value: 'month', label: 'A certain month' },
            { value: 'anytime', label: 'Anytime' },
          ].map(opt => (
            <RadioOption
              key={opt.value}
              isSelected={preferences.dateFlexibility === opt.value}
              onClick={() => updatePreferences({ dateFlexibility: opt.value as TripPreferences['dateFlexibility'] })}
            >
              {opt.label}
            </RadioOption>
          ))}
        </div>

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
                    <>{format(preferences.startDate, "MMM d, yyyy")} — Select end date</>
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
                    if (from && to) {
                      const days = differenceInDays(to, from) + 1;
                      updatePreferences({ startDate: from, endDate: to, durationFlexibility: 'strict', durationDays: days });
                      return;
                    }
                    updatePreferences({ startDate: from, endDate: to });
                  }}
                  disabled={(date) => date < new Date()}
                  numberOfMonths={2}
                  className="pointer-events-auto"
                />
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

      {/* Duration — only when not using exact dates */}
      {preferences.dateFlexibility !== 'strict' && (
        <div className="space-y-3">
          <label className="text-sm font-medium text-foreground flex items-center gap-2">
            <Clock className="w-4 h-4 text-primary" />
            Trip duration
          </label>
          <div className="flex flex-wrap gap-2">
            {[
              { value: 'weekend', label: 'Weekend' },
              { value: 'long-weekend', label: 'Long weekend' },
              { value: '1-week', label: '1 week' },
              { value: '2-weeks', label: '2 weeks' },
              { value: 'strict', label: 'Exact days' },
              { value: 'flexible', label: 'Flexible' },
            ].map(opt => (
              <RadioOption
                key={opt.value}
                isSelected={preferences.durationFlexibility === opt.value}
                onClick={() => updatePreferences({ durationFlexibility: opt.value as TripPreferences['durationFlexibility'] })}
              >
                {opt.label}
              </RadioOption>
            ))}
          </div>

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
              <div className="flex flex-wrap gap-2">
                {[
                  { value: 'nonstop', label: 'Nonstop only' },
                  { value: 'short-layover', label: 'Short layovers OK' },
                  { value: 'long-layover', label: 'Any layovers' },
                ].map(opt => (
                  <RadioOption
                    key={opt.value}
                    isSelected={preferences.flightDirectness === opt.value}
                    onClick={() => updatePreferences({ flightDirectness: opt.value as TripPreferences['flightDirectness'] })}
                  >
                    {opt.label}
                  </RadioOption>
                ))}
              </div>
            </div>
          </>
        ) : (
          <p className="text-sm text-muted-foreground">
            The itinerary will skip all flight-related content (e.g., road trip, train, local trip).
          </p>
        )}
      </div>

      {/* Bottom action row */}
      <div className="flex items-center justify-between pt-2">
        <Button type="button" variant="ghost" onClick={() => setCurrentStep(0)}>
          &lsaquo; Back
        </Button>
        <Button type="button" variant="default" onClick={() => setCurrentStep(2)}>
          Continue &rsaquo;
        </Button>
      </div>
    </div>
  );

  const renderStep2 = () => (
    <div className="px-6 pb-6 space-y-6">
      <div>
        <h3 className="font-display font-semibold text-lg text-foreground">Set the vibe</h3>
        <p className="text-sm text-muted-foreground mt-0.5">This is where the itinerary gets personal.</p>
      </div>

      {/* Atmosphere */}
      <div className="space-y-3">
        <label className="text-sm font-medium text-foreground flex items-center gap-2">
          Atmosphere
        </label>
        <div className="flex flex-wrap gap-2">
          {atmosphereOptions.map(opt => (
            <ToggleOption
              key={opt.id}
              isSelected={preferences.atmosphere.includes(opt.id)}
              onClick={() => toggleArrayItem('atmosphere', opt.id)}
              icon={opt.icon}
              label={opt.label}
            />
          ))}
        </div>
      </div>

      {/* Adventure Level */}
      <div className="space-y-3">
        <label className="text-sm font-medium text-foreground flex items-center gap-2">
          <Zap className="w-4 h-4 text-primary" />
          Adventure level
        </label>
        <div className="flex flex-wrap gap-2">
          {adventureOptions.map(opt => (
            <RadioOption
              key={opt.id}
              isSelected={preferences.adventureLevel === opt.id}
              onClick={() => updatePreferences({ adventureLevel: opt.id })}
            >
              {opt.label}
            </RadioOption>
          ))}
        </div>
      </div>

      {/* Guided vs Self-serve */}
      <div className="space-y-3">
        <label className="text-sm font-medium text-foreground flex items-center gap-2">
          <Users className="w-4 h-4 text-primary" />
          Guided vs. self-serve activities
        </label>
        <div className="flex flex-wrap gap-2">
          {guidedOptions.map(opt => (
            <RadioOption
              key={opt.id}
              isSelected={preferences.guidedPreference === opt.id}
              onClick={() => updatePreferences({ guidedPreference: opt.id as TripPreferences['guidedPreference'] })}
            >
              {opt.label}
            </RadioOption>
          ))}
        </div>
      </div>

      {/* Food & Drink */}
      <div className="space-y-3">
        <label className="text-sm font-medium text-foreground flex items-center gap-2">
          <Utensils className="w-4 h-4 text-primary" />
          Food & drink preferences
        </label>
        <div className="flex flex-wrap gap-2">
          {foodDrinkOptions.map(opt => (
            <ToggleOption
              key={opt.id}
              isSelected={preferences.foodDrink.includes(opt.id)}
              onClick={() => toggleArrayItem('foodDrink', opt.id)}
              icon={opt.icon}
              label={opt.label}
            />
          ))}
        </div>
      </div>

      {/* Interests */}
      <div className="space-y-3">
        <label className="text-sm font-medium text-foreground flex items-center gap-2">
          <Globe className="w-4 h-4 text-primary" />
          What matters most?
        </label>
        <div className="flex flex-nowrap gap-2 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
          {interestOptions.map(opt => (
            <ToggleOption
              key={opt.id}
              isSelected={preferences.interests.includes(opt.id)}
              onClick={() => toggleArrayItem('interests', opt.id)}
              icon={opt.icon}
              label={opt.label}
              compact
            />
          ))}
        </div>
      </div>

      {/* Additional Notes */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-foreground flex items-center gap-2">
          Anything else we should know?
          <span className="text-xs text-muted-foreground font-normal">OPTIONAL</span>
        </label>
        <Textarea
          value={preferences.additionalNotes}
          onChange={(e) => updatePreferences({ additionalNotes: e.target.value })}
          placeholder="Dietary restrictions, mobility needs, places you've heard about, things to avoid, who you're traveling with..."
          className="min-h-[100px] resize-none"
        />
      </div>

      {/* Bottom action row */}
      <div className="flex items-center justify-between pt-2">
        <Button type="button" variant="ghost" onClick={() => setCurrentStep(1)}>
          &lsaquo; Back
        </Button>
        <Button
          type="button"
          variant="hero"
          size="lg"
          onClick={handleGenerate}
          disabled={isGenerating}
        >
          {isGenerating ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin mr-2" />
              Crafting your trip...
            </>
          ) : (
            <>Plan My Trip ✦</>
          )}
        </Button>
      </div>
    </div>
  );

  return (
    <div className="space-y-3">
      <div className="bg-card rounded-2xl shadow-medium overflow-hidden animate-slide-up">
        <StepIndicator />
        {currentStep === 0 && renderStep0()}
        {currentStep === 1 && renderStep1()}
        {currentStep === 2 && renderStep2()}
      </div>

      {/* Suggestion chips — only shown on step 0 */}
      {currentStep === 0 && (
        <div className="flex flex-wrap gap-2 px-1">
          {suggestionChips.map((chip) => (
            <button
              key={chip}
              type="button"
              onClick={() => updatePreferences({ additionalNotes: chip })}
              className="border border-border rounded-full px-4 py-2 text-sm hover:bg-muted/40 transition-colors"
            >
              {chip}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
