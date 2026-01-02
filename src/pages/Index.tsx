import { useState, useCallback } from "react";
import { Compass, Sparkles, MapPin, Plane } from "lucide-react";
import { TripInputForm, TripPreferences } from "@/components/TripInputForm";
import { ItineraryOutput } from "@/components/ItineraryOutput";
import { TripSummaryCard } from "@/components/TripSummaryCard";
import { ItinerarySwitcher } from "@/components/ItinerarySwitcher";
import { toast } from "@/hooks/use-toast";

const defaultPreferences: TripPreferences = {
  media: [],
  cities: [],
  budgetAccommodation: 50,
  budgetFlight: 50,
  dateFlexibility: 'anytime',
  startDate: undefined,
  endDate: undefined,
  targetMonth: '',
  durationFlexibility: '1-week',
  durationDays: 7,
  departureCity: '',
  flightDirectness: 'short-layover',
  atmosphere: [],
  adventureLevel: 'active',
  guidedPreference: 'some-guided',
  foodDrink: [],
  interests: [],
  additionalNotes: '',
};

export type ItineraryVariant = {
  id: string;
  name: string;
  emoji: string;
  content: string;
};

// Strip the <itinerary_planning> thinking section from LLM output
const stripPlanningSection = (content: string): string => {
  // Remove everything from start up to and including </itinerary_planning>
  const closingTag = '</itinerary_planning>';
  const closingIndex = content.indexOf(closingTag);
  if (closingIndex !== -1) {
    return content.slice(closingIndex + closingTag.length).trimStart();
  }
  // If we haven't seen the closing tag yet, check if we're still in planning
  const openingTag = '<itinerary_planning>';
  if (content.includes(openingTag)) {
    // Still streaming planning section, return empty or minimal indicator
    return '';
  }
  return content;
};

const Index = () => {
  const [preferences, setPreferences] = useState<TripPreferences>(defaultPreferences);
  const [itineraries, setItineraries] = useState<ItineraryVariant[]>([]);
  const [activeVariant, setActiveVariant] = useState(0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [loadingVariants, setLoadingVariants] = useState<Record<string, boolean>>({});
  const [isSuggestingThemes, setIsSuggestingThemes] = useState(false);

  // Get headers for API calls
  const getHeaders = useCallback(() => {
    return {
      "Content-Type": "application/json",
    };
  }, []);

  const suggestThemes = useCallback(async (prefs: TripPreferences): Promise<{ id: string; name: string; emoji: string }[]> => {
    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/suggest-themes`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ preferences: prefs }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || "Failed to suggest themes");
    }

    const data = await response.json();
    return data.themes;
  }, [getHeaders]);

  const generateSingleItinerary = useCallback(async (
    prefs: TripPreferences,
    themeVariant: { id: string; name: string; emoji: string },
    onUpdate: (content: string) => void
  ) => {
    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-itinerary`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ preferences: prefs, themeVariant }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || "Failed to generate itinerary");
    }

    if (!response.body) {
      throw new Error("No response body");
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let textBuffer = "";
    let fullContent = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      
      textBuffer += decoder.decode(value, { stream: true });

      let newlineIndex: number;
      while ((newlineIndex = textBuffer.indexOf("\n")) !== -1) {
        let line = textBuffer.slice(0, newlineIndex);
        textBuffer = textBuffer.slice(newlineIndex + 1);

        if (line.endsWith("\r")) line = line.slice(0, -1);
        if (line.startsWith(":") || line.trim() === "") continue;
        if (!line.startsWith("data: ")) continue;

        const jsonStr = line.slice(6).trim();
        if (jsonStr === "[DONE]") break;

        try {
          const parsed = JSON.parse(jsonStr);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) {
            fullContent += content;
            onUpdate(fullContent);
          }
        } catch {
          // Incomplete JSON, continue
        }
      }
    }

    return fullContent;
  }, [getHeaders]);

  const handleGenerate = useCallback(async (pendingCity?: string) => {
    // Include pending city text in the inspiration check
    const effectiveCities = pendingCity && !preferences.cities.includes(pendingCity)
      ? [...preferences.cities, pendingCity]
      : preferences.cities;
    
    // Build the effective preferences with pending city included
    const effectivePreferences: TripPreferences = {
      ...preferences,
      cities: effectiveCities,
    };
    
    // Update state with pending city if provided (for UI display)
    if (pendingCity && !preferences.cities.includes(pendingCity)) {
      setPreferences(effectivePreferences);
    }
    
    const hasInspiration = effectivePreferences.media.length > 0 || effectiveCities.length > 0 || effectivePreferences.additionalNotes.trim();
    
    if (!hasInspiration) {
      toast({
        title: "Add some inspiration",
        description: "Drop some travel photos, add links, or list cities you want to visit",
        variant: "destructive",
      });
      return;
    }

    setIsGenerating(true);
    setIsSuggestingThemes(true);
    setItineraries([]);
    setActiveVariant(0);

    try {
      // First, get dynamic themes based on user inputs (using effectivePreferences!)
      const themes = await suggestThemes(effectivePreferences);
      
      setIsSuggestingThemes(false);
      setItineraries(themes.map(t => ({ ...t, content: "" })));
      setLoadingVariants(Object.fromEntries(themes.map(t => [t.id, true])));

      // Generate all 3 variants in parallel (using effectivePreferences!)
      // Use a ref-like pattern to avoid stale state in concurrent updates
      const contentMap: Record<string, string> = {};
      
      const promises = themes.map(async (theme) => {
        try {
          const content = await generateSingleItinerary(
            effectivePreferences,
            theme,
            (updatedContent) => {
              // Strip the planning section before displaying
              const displayContent = stripPlanningSection(updatedContent);
              contentMap[theme.id] = displayContent;
              
              // Use functional update to ensure we're working with latest state
              setItineraries(prev => {
                const newState = prev.map(it => 
                  contentMap[it.id] !== undefined 
                    ? { ...it, content: contentMap[it.id] } 
                    : it
                );
                return newState;
              });
            }
          );
          setLoadingVariants(prev => ({ ...prev, [theme.id]: false }));
          return { id: theme.id, success: true, content };
        } catch (error) {
          console.error(`Error generating ${theme.id}:`, error);
          setLoadingVariants(prev => ({ ...prev, [theme.id]: false }));
          return { id: theme.id, success: false, error };
        }
      });

      await Promise.all(promises);

      toast({
        title: "3 itineraries ready!",
        description: "Explore different themed versions of your trip",
      });
    } catch (error) {
      console.error("Error in generation flow:", error);
      toast({
        title: "Something went wrong",
        description: error instanceof Error ? error.message : "Please try again later",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
      setIsSuggestingThemes(false);
    }
  }, [preferences, suggestThemes, generateSingleItinerary]);

  const handleEdit = useCallback(async (editRequest: string) => {
    setPreferences(prev => ({
      ...prev,
      additionalNotes: prev.additionalNotes + `\n\nEdit request: ${editRequest}`
    }));
    
    toast({
      title: "Processing your changes...",
      description: "Updating all 3 itineraries based on your feedback",
    });
    
    setTimeout(() => handleGenerate(), 100);
  }, [handleGenerate]);

  const currentItinerary = itineraries[activeVariant];

  return (
    <div className="min-h-screen gradient-hero">
      {/* Hero Section */}
      <header className="relative overflow-hidden">
        <div className="absolute inset-0 overflow-hidden pointer-events-none">
          <div className="absolute top-20 left-10 w-72 h-72 bg-primary/5 rounded-full blur-3xl animate-float" />
          <div className="absolute bottom-10 right-20 w-96 h-96 bg-olive/5 rounded-full blur-3xl animate-float" style={{ animationDelay: '-3s' }} />
        </div>

        <div className="container relative pt-12 pb-8 md:pt-20 md:pb-12">
          <div className="flex items-center justify-center gap-2 mb-6">
            <Compass className="w-8 h-8 text-primary animate-pulse-soft" />
            <span className="font-display text-lg text-primary">Wanderlust AI</span>
          </div>
          
          <h1 className="text-4xl md:text-6xl lg:text-7xl font-display font-bold text-center text-foreground leading-tight text-balance max-w-4xl mx-auto">
            Stop Planning,{" "}
            <span className="text-primary">Start Wandering</span>
          </h1>
          
          <p className="mt-6 text-lg md:text-xl text-muted-foreground text-center max-w-2xl mx-auto text-balance">
            Drop your saved TikToks, tell us your vibe, and let AI craft the perfect itinerary — complete with flights, hidden gems, and local favorites.
          </p>

          <div className="flex items-center justify-center gap-6 mt-8 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4" />
              <span>Hidden gems included</span>
            </div>
            <div className="flex items-center gap-2">
              <Plane className="w-4 h-4" />
              <span>Flight suggestions</span>
            </div>
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4" />
              <span>Local knowledge</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container pb-20">
        <div className="max-w-4xl mx-auto space-y-8">
          {/* Input Form */}
          <TripInputForm
            preferences={preferences}
            onPreferencesChange={setPreferences}
            onGenerate={handleGenerate}
            isGenerating={isGenerating}
          />

          {/* Results */}
          {(itineraries.length > 0 || isGenerating) && (
            <div className="space-y-6 animate-slide-up" style={{ animationDelay: '0.1s' }}>
              {/* Itinerary Switcher */}
              {itineraries.length > 0 && (
                <ItinerarySwitcher
                  variants={itineraries}
                  activeIndex={activeVariant}
                  onSelect={setActiveVariant}
                  loadingVariants={loadingVariants}
                />
              )}

              {/* Summary Card */}
              {currentItinerary?.content && !loadingVariants[currentItinerary.id] && (
                <TripSummaryCard 
                  itinerary={currentItinerary.content}
                  departureCity={preferences.departureCity}
                  startDate={preferences.startDate}
                  endDate={preferences.endDate}
                  durationDays={preferences.durationDays}
                />
              )}


              {/* Detailed Itinerary */}
              <div className="bg-card rounded-2xl shadow-medium p-6 md:p-8">
                <div className="flex items-center gap-3 pb-4 border-b border-border mb-6">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <Sparkles className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <h2 className="font-display text-xl font-semibold text-foreground">
                      {currentItinerary ? `${currentItinerary.emoji} ${currentItinerary.name}` : "Your Personalized Itinerary"}
                    </h2>
                    <p className="text-sm text-muted-foreground">
                      {currentItinerary ? "Swipe between themes above" : "Crafted based on your preferences"}
                    </p>
                  </div>
                </div>
                
                <ItineraryOutput 
                  itinerary={currentItinerary?.content || ""} 
                  isLoading={isGenerating && !currentItinerary?.content}
                  onEdit={handleEdit}
                  tripPreferences={preferences}
                />
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border py-8">
        <div className="container text-center text-sm text-muted-foreground">
          <p>Powered by AI • Made for wanderers everywhere</p>
        </div>
      </footer>
    </div>
  );
};

export default Index;
