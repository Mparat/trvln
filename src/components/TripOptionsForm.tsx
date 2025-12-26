import { useState } from "react";
import { Calendar, Clock, Wallet, ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar as CalendarComponent } from "@/components/ui/calendar";
import { cn } from "@/lib/utils";
import { format } from "date-fns";

interface TripOptionsFormProps {
  duration: number;
  onDurationChange: (value: number) => void;
  startDate: Date | undefined;
  onStartDateChange: (date: Date | undefined) => void;
  budget: number;
  onBudgetChange: (value: number) => void;
}

export function TripOptionsForm({
  duration,
  onDurationChange,
  startDate,
  onStartDateChange,
  budget,
  onBudgetChange,
}: TripOptionsFormProps) {
  const [isExpanded, setIsExpanded] = useState(false);

  const getBudgetLabel = (value: number) => {
    if (value <= 25) return "Budget";
    if (value <= 50) return "Moderate";
    if (value <= 75) return "Comfortable";
    return "Luxury";
  };

  return (
    <div className="space-y-4">
      <button
        onClick={() => setIsExpanded(!isExpanded)}
        className="flex items-center gap-2 text-muted-foreground hover:text-foreground transition-colors duration-200 group"
      >
        <span className="text-sm font-medium">Optional trip details</span>
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
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 pt-2">
            {/* Duration */}
            <div className="space-y-3">
              <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Clock className="w-4 h-4 text-primary" />
                Trip Duration
              </label>
              <div className="space-y-2">
                <Slider
                  value={[duration]}
                  onValueChange={([value]) => onDurationChange(value)}
                  min={1}
                  max={30}
                  step={1}
                  className="w-full"
                />
                <p className="text-sm text-muted-foreground text-center">
                  {duration} {duration === 1 ? "day" : "days"}
                </p>
              </div>
            </div>

            {/* Date Picker */}
            <div className="space-y-3">
              <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Calendar className="w-4 h-4 text-primary" />
                Start Date
              </label>
              <Popover>
                <PopoverTrigger asChild>
                  <Button
                    variant="outline"
                    className={cn(
                      "w-full justify-start text-left font-normal",
                      !startDate && "text-muted-foreground"
                    )}
                  >
                    {startDate ? format(startDate, "PPP") : "Pick a date"}
                  </Button>
                </PopoverTrigger>
                <PopoverContent className="w-auto p-0" align="start">
                  <CalendarComponent
                    mode="single"
                    selected={startDate}
                    onSelect={onStartDateChange}
                    initialFocus
                    className="pointer-events-auto"
                    disabled={(date) => date < new Date()}
                  />
                </PopoverContent>
              </Popover>
            </div>

            {/* Budget */}
            <div className="space-y-3">
              <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Wallet className="w-4 h-4 text-primary" />
                Budget Level
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
                <p className="text-sm text-muted-foreground text-center">
                  {getBudgetLabel(budget)}
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
