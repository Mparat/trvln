import { useState, useCallback } from "react";
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

  const convertImagesToBase64 = async (files: File[]): Promise<string[]> => {
    const promises = files.map((file) => {
      return new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
      });
    });
    return Promise.all(promises);
  };

  const handleGenerate = useCallback(async () => {
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

    try {
      // Convert images to base64
      const imageData = images.length > 0 ? await convertImagesToBase64(images) : [];

      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-itinerary`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
        },
        body: JSON.stringify({
          description,
          images: imageData,
          duration,
          startDate: startDate?.toISOString(),
          budget,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to generate itinerary");
      }

      if (!response.body) {
        throw new Error("No response body");
      }

      // Stream the response
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let textBuffer = "";
      let fullItinerary = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        
        textBuffer += decoder.decode(value, { stream: true });

        // Process line-by-line as data arrives
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
        title: "Itinerary generated!",
        description: "Your personalized travel plan is ready",
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
  }, [description, images, duration, startDate, budget]);

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
              
              <ItineraryDisplay itinerary={itinerary} isLoading={isGenerating && !itinerary} />
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
