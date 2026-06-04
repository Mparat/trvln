import { useState } from "react";
import { ItineraryData } from "@/types/itinerary";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  ExternalLink, Plane, Hotel, MapPin, Clock, DollarSign,
  Sunrise, Sun, Moon, Utensils, Calendar, ChevronRight, Info
} from "lucide-react";

type Tab = 'overview' | 'days' | 'bookings';

const TAG_COLORS: Record<string, string> = {
  transit: 'bg-gray-100 text-gray-600',
  cultural: 'bg-purple-100 text-purple-700',
  nature: 'bg-green-100 text-green-700',
  hiking: 'bg-emerald-100 text-emerald-700',
  beach: 'bg-sky-100 text-sky-700',
  food: 'bg-orange-100 text-orange-700',
  'photo-worthy': 'bg-pink-100 text-pink-700',
  walking: 'bg-teal-100 text-teal-700',
  adventure: 'bg-red-100 text-red-700',
  relaxation: 'bg-blue-100 text-blue-700',
  shopping: 'bg-amber-100 text-amber-700',
  nightlife: 'bg-violet-100 text-violet-700',
};

const PERIOD_ICONS = { Morning: Sunrise, Afternoon: Sun, Evening: Moon };

interface Props {
  data: ItineraryData;
}

export function StructuredItinerary({ data }: Props) {
  const [activeTab, setActiveTab] = useState<Tab>('overview');
  const [activeDayIdx, setActiveDayIdx] = useState(0);
  const [activePeriodIdx, setActivePeriodIdx] = useState(0);

  const activeDay = data.days[activeDayIdx];
  const activePeriod = activeDay?.periods[activePeriodIdx];

  return (
    <div className="space-y-5">
      {/* Tab navigation */}
      <div className="flex gap-1 bg-muted/50 rounded-xl p-1">
        {(['overview', 'days', 'bookings'] as Tab[]).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={cn(
              "flex-1 py-2 px-3 text-sm font-medium rounded-lg transition-all",
              activeTab === tab
                ? "bg-background text-foreground shadow-sm"
                : "text-muted-foreground hover:text-foreground"
            )}
          >
            {tab === 'overview' ? 'Overview' : tab === 'days' ? `Days (${data.days.length})` : 'Bookings'}
          </button>
        ))}
      </div>

      {/* ── Overview ── */}
      {activeTab === 'overview' && (
        <div className="space-y-6">
          {/* Hero summary */}
          <div className="bg-gradient-to-br from-primary/10 to-primary/5 rounded-2xl p-5">
            <div className="flex flex-wrap gap-2 mb-3">
              <span className="text-xs font-medium text-primary bg-primary/15 px-2.5 py-1 rounded-full">
                {data.summary.duration}
              </span>
              <span className="text-xs text-muted-foreground bg-background/70 px-2.5 py-1 rounded-full flex items-center gap-1">
                <Calendar className="w-3 h-3" /> {data.summary.recommendedDates}
              </span>
              <span className="text-xs font-semibold text-foreground bg-background/70 px-2.5 py-1 rounded-full">
                {data.summary.totalBudget}
              </span>
            </div>
            <h3 className="text-xl font-display font-bold text-foreground mb-3">
              {data.summary.destination}
            </h3>
            <div className="flex flex-wrap gap-2">
              {data.summary.highlights.map((h, i) => (
                <span key={i} className="text-sm bg-background/70 px-2.5 py-1.5 rounded-lg text-foreground/80">
                  ✦ {h}
                </span>
              ))}
            </div>
          </div>

          {/* Budget breakdown */}
          <div>
            <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
              <DollarSign className="w-4 h-4 text-primary" />
              Budget Breakdown
            </h4>
            <div className="rounded-xl border border-border/60 overflow-hidden">
              {data.budget.items.map((item, i) => (
                <div
                  key={i}
                  className={cn(
                    "flex items-center justify-between px-4 py-2.5 text-sm",
                    i % 2 === 0 ? "bg-muted/20" : "bg-transparent"
                  )}
                >
                  <span className="text-muted-foreground">{item.category}</span>
                  <span className="font-medium text-foreground">{item.range}</span>
                </div>
              ))}
              <div className="flex items-center justify-between px-4 py-3 bg-primary/5 border-t border-border/60">
                <span className="text-sm font-semibold text-foreground">Total estimate</span>
                <span className="text-sm font-bold text-primary">{data.budget.total}</span>
              </div>
            </div>
          </div>

          {/* Flights */}
          {!data.flights.skip && data.flights.options.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                <Plane className="w-4 h-4 text-primary" />
                Flights
              </h4>
              <div className="space-y-2">
                {data.flights.options.map((f, i) => (
                  <a
                    key={i}
                    href={f.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between p-3.5 bg-muted/30 rounded-xl hover:bg-muted/60 transition-colors group border border-transparent hover:border-border/50"
                  >
                    <div>
                      <p className="text-sm font-medium text-foreground">{f.description}</p>
                      <p className="text-sm text-primary font-semibold mt-0.5">{f.price}</p>
                    </div>
                    <ExternalLink className="w-4 h-4 text-muted-foreground group-hover:text-primary transition-colors shrink-0" />
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Accommodation */}
          {data.accommodation.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-foreground mb-3 flex items-center gap-2">
                <Hotel className="w-4 h-4 text-primary" />
                Accommodation
              </h4>
              <div className="space-y-4">
                {data.accommodation.map((loc, i) => (
                  <div key={i}>
                    <div className="flex items-center gap-1.5 mb-2">
                      <MapPin className="w-3.5 h-3.5 text-muted-foreground" />
                      <span className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                        {loc.location} · {loc.nights} night{loc.nights !== 1 ? 's' : ''}
                      </span>
                    </div>
                    <div className="space-y-2">
                      {loc.options.map((opt, j) => (
                        <a
                          key={j}
                          href={opt.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={cn(
                            "block p-3.5 rounded-xl transition-colors group border",
                            opt.isPrimary
                              ? "bg-primary/5 border-primary/20 hover:bg-primary/10"
                              : "bg-muted/30 border-transparent hover:bg-muted/60"
                          )}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="flex-1 min-w-0">
                              <div className="flex items-center gap-2 flex-wrap">
                                <p className="text-sm font-medium text-foreground">{opt.name}</p>
                                {opt.isPrimary && (
                                  <span className="text-[10px] bg-primary/20 text-primary px-1.5 py-0.5 rounded-full font-medium">
                                    Recommended
                                  </span>
                                )}
                                {opt.type && (
                                  <span className="text-[10px] text-muted-foreground bg-muted px-1.5 py-0.5 rounded-full">
                                    {opt.type}
                                  </span>
                                )}
                              </div>
                              {opt.why && (
                                <p className="text-xs text-muted-foreground mt-1">{opt.why}</p>
                              )}
                            </div>
                            <div className="flex items-center gap-2 shrink-0">
                              <span className="text-sm font-semibold text-primary whitespace-nowrap">
                                {opt.pricePerNight}<span className="text-xs font-normal text-muted-foreground">/night</span>
                              </span>
                              <ExternalLink className="w-3.5 h-3.5 text-muted-foreground group-hover:text-primary transition-colors" />
                            </div>
                          </div>
                        </a>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Alternatives */}
          {data.alternatives && data.alternatives.length > 0 && (
            <div>
              <h4 className="text-sm font-semibold text-foreground mb-3">Also Consider</h4>
              <div className="space-y-2">
                {data.alternatives.map((alt, i) => (
                  <div key={i} className="p-3.5 bg-muted/30 rounded-xl border border-border/40">
                    <p className="text-sm font-medium text-foreground">{alt.title}</p>
                    <p className="text-sm text-muted-foreground mt-0.5">{alt.description}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Assumptions */}
          {data.summary.assumptions && data.summary.assumptions.length > 0 && (
            <div className="bg-amber-50/60 dark:bg-amber-950/20 border border-amber-200/60 rounded-xl p-4">
              <div className="flex items-center gap-2 mb-2">
                <Info className="w-3.5 h-3.5 text-amber-600" />
                <span className="text-xs font-semibold text-amber-800 dark:text-amber-400 uppercase tracking-wide">Assumptions</span>
              </div>
              <ul className="space-y-1">
                {data.summary.assumptions.map((a, i) => (
                  <li key={i} className="text-sm text-amber-700 dark:text-amber-400">• {a}</li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* ── Days ── */}
      {activeTab === 'days' && (
        <div className="space-y-4">
          {/* Day selector pills */}
          <div className="flex gap-1.5 overflow-x-auto pb-1" style={{ scrollbarWidth: 'none' }}>
            {data.days.map((day, i) => (
              <button
                key={i}
                onClick={() => { setActiveDayIdx(i); setActivePeriodIdx(0); }}
                className={cn(
                  "flex flex-col items-center px-3.5 py-2 rounded-xl text-xs font-medium transition-all shrink-0 border",
                  activeDayIdx === i
                    ? "bg-primary text-primary-foreground border-primary shadow-sm"
                    : "bg-muted/50 text-muted-foreground hover:bg-muted border-transparent"
                )}
              >
                <span className="text-[9px] uppercase tracking-wider opacity-70 mb-0.5">Day</span>
                <span className="text-base font-bold leading-none">{day.dayNumber}</span>
              </button>
            ))}
          </div>

          {/* Day header card */}
          {activeDay && (
            <div className="bg-gradient-to-br from-primary/10 to-transparent rounded-2xl p-4">
              <p className="text-xs text-muted-foreground uppercase tracking-widest mb-1">
                Day {activeDay.dayNumber}
              </p>
              <h3 className="text-lg font-display font-bold text-foreground">{activeDay.title}</h3>
              <div className="flex items-center gap-1.5 mt-1">
                <MapPin className="w-3.5 h-3.5 text-muted-foreground" />
                <span className="text-sm text-muted-foreground">{activeDay.location}</span>
              </div>
              {activeDay.transitNote && (
                <div className="mt-2 flex items-center gap-1.5 text-xs text-primary font-medium">
                  <ChevronRight className="w-3.5 h-3.5" />
                  {activeDay.transitNote}
                </div>
              )}
            </div>
          )}

          {/* Period selector */}
          {activeDay && (
            <div className="flex gap-2">
              {activeDay.periods.map((period, i) => {
                const Icon = PERIOD_ICONS[period.label as keyof typeof PERIOD_ICONS] || Sun;
                return (
                  <button
                    key={i}
                    onClick={() => setActivePeriodIdx(i)}
                    className={cn(
                      "flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-medium transition-all border",
                      activePeriodIdx === i
                        ? "bg-foreground text-background border-foreground"
                        : "bg-muted/40 text-muted-foreground hover:text-foreground border-transparent"
                    )}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    {period.label}
                  </button>
                );
              })}
            </div>
          )}

          {/* Activities */}
          {activePeriod && (
            <div className="space-y-3">
              {activePeriod.activities.map((activity, i) => (
                <div key={i} className="bg-card border border-border/60 rounded-2xl p-4">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <h4 className="font-semibold text-foreground leading-snug">{activity.name}</h4>
                    {activity.bookingUrl && (
                      <a
                        href={activity.bookingUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="shrink-0 p-1 rounded-lg bg-primary/10 text-primary hover:bg-primary/20 transition-colors"
                      >
                        <ExternalLink className="w-3.5 h-3.5" />
                      </a>
                    )}
                  </div>
                  <p className="text-sm text-muted-foreground leading-relaxed">{activity.description}</p>
                  <div className="flex flex-wrap items-center gap-2 mt-2.5">
                    {activity.duration && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground bg-muted/60 px-2 py-0.5 rounded-full">
                        <Clock className="w-3 h-3" />
                        {activity.duration}
                      </span>
                    )}
                    {activity.cost && activity.cost !== 'Free' && (
                      <span className="flex items-center gap-1 text-xs text-muted-foreground bg-muted/60 px-2 py-0.5 rounded-full">
                        <DollarSign className="w-3 h-3" />
                        {activity.cost}
                      </span>
                    )}
                    {activity.cost === 'Free' && (
                      <span className="text-xs text-green-700 bg-green-100 px-2 py-0.5 rounded-full font-medium">Free</span>
                    )}
                    {activity.tags?.map(tag => (
                      <span
                        key={tag}
                        className={cn("text-xs px-2 py-0.5 rounded-full", TAG_COLORS[tag] || 'bg-gray-100 text-gray-600')}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                  {activity.bookingUrl && (
                    <a
                      href={activity.bookingUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1 text-xs font-medium text-primary hover:underline mt-2"
                    >
                      Book this <ExternalLink className="w-3 h-3" />
                    </a>
                  )}
                </div>
              ))}

              {/* Dining suggestions */}
              {activePeriod.dining && activePeriod.dining.length > 0 && (
                <div className="mt-2">
                  <div className="flex items-center gap-2 mb-2 px-1">
                    <Utensils className="w-3.5 h-3.5 text-orange-500" />
                    <span className="text-xs font-semibold text-foreground uppercase tracking-wide">Dining nearby</span>
                  </div>
                  <div className="space-y-2">
                    {activePeriod.dining.map((dining, i) => (
                      <a
                        key={i}
                        href={dining.url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-3 p-3 bg-orange-50/60 dark:bg-orange-950/20 border border-orange-100 dark:border-orange-900/30 rounded-xl hover:bg-orange-50 transition-colors group"
                      >
                        <div className="flex-1 min-w-0">
                          <p className="text-sm font-medium text-foreground">{dining.name}</p>
                          <p className="text-xs text-muted-foreground mt-0.5 leading-snug">{dining.description}</p>
                          {dining.priceRange && (
                            <p className="text-xs text-orange-600 font-medium mt-0.5">{dining.priceRange}</p>
                          )}
                        </div>
                        <ExternalLink className="w-3.5 h-3.5 text-muted-foreground group-hover:text-orange-600 shrink-0 transition-colors" />
                      </a>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ── Bookings ── */}
      {activeTab === 'bookings' && (
        <div className="space-y-2">
          {data.bookingChecklist.length === 0 && (
            <p className="text-sm text-muted-foreground text-center py-6">No booking items generated.</p>
          )}
          {data.bookingChecklist.map((item, i) => (
            <div
              key={i}
              className={cn(
                "flex items-start gap-3 p-4 rounded-xl border-l-[3px]",
                item.priority === 'high' && "bg-red-50/50 dark:bg-red-950/20 border-red-400",
                item.priority === 'medium' && "bg-amber-50/50 dark:bg-amber-950/20 border-amber-400",
                item.priority === 'low' && "bg-green-50/50 dark:bg-green-950/20 border-green-400"
              )}
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center flex-wrap gap-2 mb-1">
                  <span className="text-sm font-semibold text-foreground">{item.item}</span>
                  <span className={cn(
                    "text-[10px] px-1.5 py-0.5 rounded-full font-semibold uppercase tracking-wide",
                    item.priority === 'high' && "bg-red-100 text-red-700",
                    item.priority === 'medium' && "bg-amber-100 text-amber-700",
                    item.priority === 'low' && "bg-green-100 text-green-700"
                  )}>
                    {item.priority}
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1">
                    <Clock className="w-3 h-3" />
                    {item.leadTime}
                  </span>
                  <span className="flex items-center gap-1">
                    <DollarSign className="w-3 h-3" />
                    {item.estimatedCost}
                  </span>
                </div>
              </div>
              {item.url && (
                <a
                  href={item.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={cn(
                    "shrink-0 flex items-center gap-1 text-xs font-semibold px-3 py-1.5 rounded-lg transition-colors",
                    item.priority === 'high' && "bg-red-100 text-red-700 hover:bg-red-200",
                    item.priority === 'medium' && "bg-amber-100 text-amber-700 hover:bg-amber-200",
                    item.priority === 'low' && "bg-green-100 text-green-700 hover:bg-green-200"
                  )}
                >
                  Book <ExternalLink className="w-3 h-3" />
                </a>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
