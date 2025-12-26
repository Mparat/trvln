import { useState, useCallback } from "react";
import { Compass, Sparkles, MapPin, Plane } from "lucide-react";
import { TripInputForm, TripPreferences } from "@/components/TripInputForm";
import { ItineraryOutput } from "@/components/ItineraryOutput";
import { TripSummaryCard } from "@/components/TripSummaryCard";
import { ItineraryMap } from "@/components/ItineraryMap";
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
  foodDrink: [],
  interests: [],
  additionalNotes: '',
};

const Index = () => {
  const [preferences, setPreferences] = useState<TripPreferences>(defaultPreferences);
  const [itinerary, setItinerary] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);

  const handleGenerate = useCallback(async () => {
    const hasInspiration = preferences.media.length > 0 || preferences.cities.length > 0 || preferences.additionalNotes.trim();
    
    if (!hasInspiration) {
      toast({
        title: "Add some inspiration",
        description: "Drop some travel photos, add links, or list cities you want to visit",
        variant: "destructive",
      });
      return;
    }

    setIsGenerating(true);
    setItinerary("");

    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-itinerary`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({ preferences }),
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
      let fullItinerary = "";

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
              fullItinerary += content;
              setItinerary(fullItinerary);
            }
          } catch {
            // Incomplete JSON, continue
          }
        }
      }

      toast({
        title: "Itinerary ready!",
        description: "Your personalized travel plan has been crafted",
      });
    } catch (error) {
      console.error("Error generating itinerary:", error);
      toast({
        title: "Something went wrong",
        description: error instanceof Error ? error.message : "Please try again later",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  }, [preferences]);

  const handleEdit = useCallback(async (editRequest: string) => {
    // For now, append edit request to additional notes and regenerate
    setPreferences(prev => ({
      ...prev,
      additionalNotes: prev.additionalNotes + `\n\nEdit request: ${editRequest}`
    }));
    
    toast({
      title: "Processing your changes...",
      description: "Updating the itinerary based on your feedback",
    });
    
    // Trigger regeneration after state updates
    setTimeout(() => handleGenerate(), 100);
  }, [handleGenerate]);

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
          {(itinerary || isGenerating) && (
            <div className="space-y-6 animate-slide-up" style={{ animationDelay: '0.1s' }}>
              {/* Summary Card */}
              {itinerary && !isGenerating && (
                <TripSummaryCard 
                  itinerary={itinerary}
                  departureCity={preferences.departureCity}
                  startDate={preferences.startDate}
                  endDate={preferences.endDate}
                />
              )}

              {/* Map */}
              {itinerary && !isGenerating && (
                <div className="bg-card rounded-2xl shadow-medium p-6 md:p-8">
                  <h3 className="font-display text-lg font-semibold text-foreground mb-4 flex items-center gap-2">
                    <MapPin className="w-5 h-5 text-primary" />
                    Your Journey Map
                  </h3>
                  <ItineraryMap itinerary={itinerary} />
                </div>
              )}

              {/* Detailed Itinerary */}
              <div className="bg-card rounded-2xl shadow-medium p-6 md:p-8">
                <div className="flex items-center gap-3 pb-4 border-b border-border mb-6">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                    <Sparkles className="w-5 h-5 text-primary" />
                  </div>
                  <div>
                    <h2 className="font-display text-xl font-semibold text-foreground">Your Personalized Itinerary</h2>
                    <p className="text-sm text-muted-foreground">
                      Crafted based on your preferences
                    </p>
                  </div>
                </div>
                
                <ItineraryOutput 
                  itinerary={itinerary} 
                  isLoading={isGenerating && !itinerary}
                  onEdit={handleEdit}
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
