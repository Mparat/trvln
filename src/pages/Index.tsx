import { useState } from "react";
import { Compass, Sparkles, MapPin, Plane } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ImageDropZone } from "@/components/ImageDropZone";
import { TripOptionsForm } from "@/components/TripOptionsForm";
import { ItineraryDisplay } from "@/components/ItineraryDisplay";
import { toast } from "@/hooks/use-toast";

const Index = () => {
  const [images, setImages] = useState<File[]>([]);
  const [description, setDescription] = useState("");
  const [duration, setDuration] = useState(7);
  const [startDate, setStartDate] = useState<Date | undefined>();
  const [budget, setBudget] = useState(50);
  const [itinerary, setItinerary] = useState("");
  const [isGenerating, setIsGenerating] = useState(false);

  const handleGenerate = async () => {
    if (!description.trim() && images.length === 0) {
      toast({
        title: "Please add some details",
        description: "Drop some travel photos or describe your dream destination",
        variant: "destructive",
      });
      return;
    }

    setIsGenerating(true);
    setItinerary("");

    // Simulate AI response for now (will be replaced with actual API call)
    try {
      // Mock itinerary generation
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      const mockItinerary = `## Day 1: Arrival & First Impressions

Morning
- Arrive at your destination and check into your accommodation
- Take a leisurely walk around the neighborhood to get oriented
- Enjoy a welcome coffee at a local café

Afternoon
- Visit the main cultural landmark or museum
- Explore the historic city center
- Stop for photos at the most scenic viewpoints

Evening
- Dinner at a highly-rated local restaurant
- Evening stroll along the waterfront or main promenade
- Tip: Book restaurants in advance for popular spots

## Day 2: Deep Dive into Local Culture

Morning
- Early breakfast at a traditional bakery
- Guided walking tour of hidden gems
- Visit the local market for fresh produce and souvenirs

Afternoon
- Lunch at a family-run establishment
- Explore a nearby neighborhood known for art galleries
- Coffee break with panoramic views

Evening
- Sunset viewing from the highest point in the city
- Dinner featuring regional specialties
- Optional: Live music or cultural performance

## Day 3: Day Trip Adventure

Morning
- Early departure for a scenic day trip
- Stop at charming villages along the route
- Hiking or nature walk at a nearby natural attraction

Afternoon
- Picnic lunch with local delicacies
- Visit a historic site or monument
- Photo opportunities at unique landscapes

Evening
- Return to the city as the sun sets
- Relaxed dinner at your favorite spot discovered earlier
- Pack and prepare for departure`;

      setItinerary(mockItinerary);
      
      toast({
        title: "Itinerary generated!",
        description: "Your personalized travel plan is ready",
      });
    } catch (error) {
      toast({
        title: "Something went wrong",
        description: "Please try again later",
        variant: "destructive",
      });
    } finally {
      setIsGenerating(false);
    }
  };

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
            Your Dream Journey,{" "}
            <span className="text-primary">Crafted by AI</span>
          </h1>
          
          <p className="mt-6 text-lg md:text-xl text-muted-foreground text-center max-w-2xl mx-auto text-balance">
            Drop your travel photos, share your destination dreams, and let our AI create the perfect itinerary tailored just for you.
          </p>

          <div className="flex items-center justify-center gap-6 mt-8 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <MapPin className="w-4 h-4" />
              <span>Any destination</span>
            </div>
            <div className="flex items-center gap-2">
              <Plane className="w-4 h-4" />
              <span>Personalized plans</span>
            </div>
            <div className="flex items-center gap-2">
              <Sparkles className="w-4 h-4" />
              <span>AI-powered</span>
            </div>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="container pb-20">
        <div className="max-w-4xl mx-auto">
          {/* Input Card */}
          <div className="bg-card rounded-2xl shadow-medium p-6 md:p-8 space-y-6 animate-slide-up">
            {/* Image Drop Zone */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground flex items-center gap-2">
                <span>📸</span> Drop your inspiration photos
              </label>
              <ImageDropZone images={images} onImagesChange={setImages} />
            </div>

            {/* Text Input */}
            <div className="space-y-2">
              <label htmlFor="description" className="text-sm font-medium text-foreground flex items-center gap-2">
                <span>✨</span> Describe your dream trip
              </label>
              <Textarea
                id="description"
                value={description}
                onChange={(e) => setDescription(e.target.value)}
                placeholder="I want to explore the ancient temples of Kyoto in spring, experience the cherry blossoms, try authentic ramen, and find hidden tea houses..."
                className="min-h-[120px] resize-none bg-background border-input focus:border-primary transition-colors"
              />
            </div>

            {/* Optional Fields */}
            <TripOptionsForm
              duration={duration}
              onDurationChange={setDuration}
              startDate={startDate}
              onStartDateChange={setStartDate}
              budget={budget}
              onBudgetChange={setBudget}
            />

            {/* Generate Button */}
            <Button
              onClick={handleGenerate}
              disabled={isGenerating}
              variant="hero"
              className="w-full"
            >
              {isGenerating ? (
                <>
                  <Sparkles className="w-5 h-5 animate-spin" />
                  Crafting your journey...
                </>
              ) : (
                <>
                  <Sparkles className="w-5 h-5" />
                  Generate My Itinerary
                </>
              )}
            </Button>
          </div>

          {/* Itinerary Display */}
          {(itinerary || isGenerating) && (
            <div className="mt-8 bg-card rounded-2xl shadow-medium p-6 md:p-8 animate-slide-up" style={{ animationDelay: '0.1s' }}>
              <div className="flex items-center gap-3 mb-6 pb-4 border-b border-border">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <MapPin className="w-5 h-5 text-primary" />
                </div>
                <div>
                  <h2 className="font-display text-xl font-semibold text-foreground">Your Personalized Itinerary</h2>
                  <p className="text-sm text-muted-foreground">
                    {duration} days • {startDate ? `Starting ${startDate.toLocaleDateString()}` : 'Flexible dates'}
                  </p>
                </div>
              </div>
              
              <ItineraryDisplay itinerary={itinerary} isLoading={isGenerating} />
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
