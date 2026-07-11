import { useState, useCallback, useEffect } from "react";
import { Sparkles, MapPin, Plane, ScanSearch } from "lucide-react";
import { TripInputForm, TripPreferences } from "@/components/TripInputForm";
import { ItineraryOutput } from "@/components/ItineraryOutput";
import { TripSummaryCard } from "@/components/TripSummaryCard";
import { ItinerarySwitcher } from "@/components/ItinerarySwitcher";
import { toast } from "@/hooks/use-toast";
import { ItineraryData } from "@/types/itinerary";

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
  noFlight: false,
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
  structuredData?: ItineraryData;
};

type IdentifiedDestination = {
  location: string;
  confidence: 'high' | 'medium' | 'low';
  reasoning: string;
};

// Persist the in-progress session so a backgrounded/reloaded tab (common on
// mobile browsers, which discard inactive tabs) restores instead of clearing.
const SESSION_STORAGE_KEY = 'trvln:session:v1';

type PersistedSession = {
  preferences: TripPreferences;
  itineraries: ItineraryVariant[];
  activeVariant: number;
};

const loadPersistedSession = (): PersistedSession | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedSession;
    if (!parsed || typeof parsed !== 'object' || !parsed.preferences) return null;
    // Date fields serialize to ISO strings — reconstruct them.
    if (parsed.preferences.startDate) {
      parsed.preferences.startDate = new Date(parsed.preferences.startDate);
    }
    if (parsed.preferences.endDate) {
      parsed.preferences.endDate = new Date(parsed.preferences.endDate);
    }
    return parsed;
  } catch {
    return null;
  }
};

// Build a snapshot safe to JSON-serialize: drop File objects and blob: previews
// (both invalid after a reload) while keeping durable public storage URLs.
const buildSessionSnapshot = (
  preferences: TripPreferences,
  itineraries: ItineraryVariant[],
  activeVariant: number,
): PersistedSession => {
  const media = preferences.media
    .filter(m => m.url) // only fully-uploaded media survives a reload
    .map(({ file, preview, ...rest }) => ({
      ...rest,
      preview: preview && !preview.startsWith('blob:') ? preview : rest.url,
    }));

  return {
    preferences: { ...preferences, media },
    itineraries,
    activeVariant,
  };
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
  const [preferences, setPreferences] = useState<TripPreferences>(
    () => loadPersistedSession()?.preferences ?? defaultPreferences
  );
  const [itineraries, setItineraries] = useState<ItineraryVariant[]>(
    () => loadPersistedSession()?.itineraries ?? []
  );
  const [activeVariant, setActiveVariant] = useState(
    () => loadPersistedSession()?.activeVariant ?? 0
  );
  const [isGenerating, setIsGenerating] = useState(false);
  const [loadingVariants, setLoadingVariants] = useState<Record<string, boolean>>({});
  const [isSuggestingThemes, setIsSuggestingThemes] = useState(false);
  const [isAnalyzingMedia, setIsAnalyzingMedia] = useState(false);
  const [isIdentifyingLocations, setIsIdentifyingLocations] = useState(false);

  // Persist the session (preferences + itineraries) so returning to a
  // reloaded tab restores it. Debounced because itineraries update rapidly
  // while streaming. Transient loading flags are intentionally NOT persisted:
  // the in-flight request dies on reload, so any partial itinerary is
  // restored as-is rather than left spinning forever.
  useEffect(() => {
    const handle = window.setTimeout(() => {
      try {
        const snapshot = buildSessionSnapshot(preferences, itineraries, activeVariant);
        window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(snapshot));
      } catch (error) {
        // Storage may be full or unavailable (private mode) — non-fatal.
        console.warn('Failed to persist session:', error);
      }
    }, 400);
    return () => window.clearTimeout(handle);
  }, [preferences, itineraries, activeVariant]);

  // Get headers for API calls
  const getHeaders = useCallback(() => {
    return {
      "Content-Type": "application/json",
      "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
    };
  }, []);

  // Analyze inspiration media for location recognition
  const analyzeInspiration = useCallback(async (mediaUrls: string[]): Promise<IdentifiedDestination[]> => {
    if (mediaUrls.length === 0) return [];
    
    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-inspiration`, {
      method: "POST",
      headers: getHeaders(),
      body: JSON.stringify({ mediaUrls }),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error("Analyze inspiration error:", errorData);
      return []; // Don't fail the whole flow if analysis fails
    }

    const data = await response.json();
    return data.destinations || [];
  }, [getHeaders]);

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
    let effectivePreferences: TripPreferences = {
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
    setItineraries([]);
    setActiveVariant(0);

    try {
      // Step 1: Analyze media for location recognition (if media exists)
      const mediaWithUrls = effectivePreferences.media.filter(m => m.url);
      if (mediaWithUrls.length > 0) {
        setIsAnalyzingMedia(true);
        
        // Collect all image URLs (including video frames)
        const allImageUrls: string[] = [];
        for (const item of mediaWithUrls) {
          if (item.type === 'image' && item.url) {
            allImageUrls.push(item.url);
          } else if (item.type === 'video' && item.frameUrls && item.frameUrls.length > 0) {
            allImageUrls.push(...item.frameUrls);
          }
        }
        
        if (allImageUrls.length > 0) {
          console.log(`Analyzing ${allImageUrls.length} images for location recognition...`);
          const identified = await analyzeInspiration(allImageUrls);
          
          // Merge high/medium confidence locations with user-specified cities
          const newLocations = identified
            .filter(d => d.confidence === 'high' || d.confidence === 'medium')
            .map(d => d.location)
            .filter(loc => !effectivePreferences.cities.some(c => 
              c.toLowerCase().includes(loc.toLowerCase()) || loc.toLowerCase().includes(c.toLowerCase())
            ));
          
          if (newLocations.length > 0) {
            console.log('AI identified new destinations:', newLocations);
            effectivePreferences = {
              ...effectivePreferences,
              cities: [...effectivePreferences.cities, ...newLocations],
            };
            setPreferences(effectivePreferences);
            
            toast({
              title: `📍 Found ${newLocations.length} destination${newLocations.length > 1 ? 's' : ''} in your photos!`,
              description: newLocations.join(', '),
            });
          }
        }
        
        setIsAnalyzingMedia(false);
      }
      
      // Step 2: Get dynamic themes based on user inputs
      setIsSuggestingThemes(true);
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
              const displayContent = stripPlanningSection(updatedContent);
              contentMap[theme.id] = displayContent;
              setItineraries(prev => {
                return prev.map(it =>
                  contentMap[it.id] !== undefined
                    ? { ...it, content: contentMap[it.id] }
                    : it
                );
              });
            }
          );

          // Parse the completed JSON response into structured data.
          // If truncated, attempt to salvage by tracking open bracket stack.
          let structuredData: ItineraryData | undefined;
          try {
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              let raw = jsonMatch[0];
              try {
                structuredData = JSON.parse(raw) as ItineraryData;
              } catch {
                // Repair truncated JSON using a proper bracket stack
                const repairJson = (s: string): string => {
                  let t = s.trimEnd().replace(/,\s*$/, '');
                  const stack: string[] = [];
                  let inStr = false;
                  let esc = false;
                  for (const ch of t) {
                    if (esc) { esc = false; continue; }
                    if (ch === '\\' && inStr) { esc = true; continue; }
                    if (ch === '"') { inStr = !inStr; continue; }
                    if (inStr) continue;
                    if (ch === '{') stack.push('}');
                    else if (ch === '[') stack.push(']');
                    else if (ch === '}' || ch === ']') stack.pop();
                  }
                  if (inStr) t += '"';
                  while (stack.length > 0) t += stack.pop()!;
                  return t;
                };
                structuredData = JSON.parse(repairJson(raw)) as ItineraryData;
              }
            }
          } catch (e) {
            console.error(`Failed to parse structured itinerary for ${theme.id}:`, e);
          }

          // Batch: set structuredData and mark loading done in same render cycle
          if (structuredData) {
            setItineraries(prev => prev.map(it =>
              it.id === theme.id ? { ...it, structuredData } : it
            ));
          }
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
      setIsAnalyzingMedia(false);
    }
  }, [preferences, suggestThemes, generateSingleItinerary, analyzeInspiration]);

  const handleEdit = useCallback(async (editRequest: string) => {
    const current = itineraries[activeVariant];
    if (!current) return;

    toast({
      title: "Processing your changes...",
      description: "Updating the itinerary based on your request",
    });

    // Mark this variant as loading
    setLoadingVariants(prev => ({ ...prev, [current.id]: true }));

    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/edit-itinerary`, {
        method: "POST",
        headers: getHeaders(),
        body: JSON.stringify({
          editRequest,
          currentItinerary: current.content,
          themeTitle: `${current.emoji} ${current.name}`,
          tripPreferences: preferences,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({}));
        throw new Error(errorData.error || "Failed to edit itinerary");
      }

      const data = await response.json();
      
      // Update only the current itinerary variant; clear structuredData so fallback markdown renders
      setItineraries(prev => prev.map((it, idx) =>
        idx === activeVariant
          ? { ...it, content: stripPlanningSection(data.updatedItinerary), structuredData: undefined }
          : it
      ));

      toast({
        title: "Changes applied!",
        description: "Your itinerary has been updated",
      });
    } catch (error) {
      console.error("Edit error:", error);
      toast({
        title: "Edit failed",
        description: error instanceof Error ? error.message : "Something went wrong",
        variant: "destructive",
      });
    } finally {
      setLoadingVariants(prev => ({ ...prev, [current.id]: false }));
    }
  }, [itineraries, activeVariant, getHeaders, preferences]);

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
            <img src="/favicon.svg" alt="Travellin'" className="w-8 h-8" />
            <span className="font-display text-lg text-primary">Travellin'</span>
          </div>

          <h1 className="text-4xl md:text-6xl lg:text-7xl font-display font-bold text-center leading-tight text-balance max-w-4xl mx-auto bg-gradient-to-r from-foreground via-primary to-foreground bg-clip-text text-transparent">
            Where to next?
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
            isIdentifyingLocations={isIdentifyingLocations}
            onFramesReady={async (frameUrls) => {
              setIsIdentifyingLocations(true);
              try {
                const identified = await analyzeInspiration(frameUrls);
                const newLocations = identified
                  .filter(d => d.confidence === 'high' || d.confidence === 'medium')
                  .map(d => d.location)
                  .filter(loc => !preferences.cities.some(c =>
                    c.toLowerCase().includes(loc.toLowerCase()) || loc.toLowerCase().includes(c.toLowerCase())
                  ));
                if (newLocations.length > 0) {
                  setPreferences(prev => ({ ...prev, cities: [...prev.cities, ...newLocations] }));
                  toast({
                    title: `📍 Found ${newLocations.length} destination${newLocations.length > 1 ? 's' : ''}!`,
                    description: newLocations.join(', '),
                  });
                } else {
                  toast({
                    title: "No locations identified",
                    description: "Try a video with clearer landmarks or add cities manually",
                  });
                }
              } finally {
                setIsIdentifyingLocations(false);
              }
            }}
          />

          {/* Results */}
          {(itineraries.length > 0 || isGenerating) && (
            <div className="space-y-6 animate-slide-up" style={{ animationDelay: '0.1s' }}>
              {/* Status indicator during analysis/theme suggestion */}
              {isGenerating && itineraries.length === 0 && (
                <div className="bg-card rounded-2xl shadow-medium p-6 flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center animate-pulse">
                    {isAnalyzingMedia ? (
                      <ScanSearch className="w-5 h-5 text-primary" />
                    ) : (
                      <Sparkles className="w-5 h-5 text-primary" />
                    )}
                  </div>
                  <div>
                    <p className="font-medium text-foreground">
                      {isAnalyzingMedia 
                        ? "Analyzing your inspiration photos..." 
                        : isSuggestingThemes 
                          ? "Crafting unique theme ideas..." 
                          : "Preparing your itineraries..."}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {isAnalyzingMedia 
                        ? "AI is identifying travel destinations from your images" 
                        : "This usually takes a few seconds"}
                    </p>
                  </div>
                </div>
              )}
              
              {/* Itinerary Switcher */}
              {itineraries.length > 0 && (
                <ItinerarySwitcher
                  variants={itineraries}
                  activeIndex={activeVariant}
                  onSelect={setActiveVariant}
                  loadingVariants={loadingVariants}
                />
              )}

              {/* Summary Card — only shown in markdown fallback mode */}
              {currentItinerary?.content && !loadingVariants[currentItinerary.id] && !currentItinerary.structuredData && (
                <TripSummaryCard
                  itinerary={currentItinerary.content}
                  departureCity={preferences.departureCity}
                  startDate={preferences.startDate}
                  endDate={preferences.endDate}
                  durationDays={preferences.durationDays}
                />
              )}


              {/* Detailed Itinerary */}
              <div className="bg-card rounded-2xl shadow-medium">
                {/* Sticky header — overflow-hidden on parent breaks sticky, so rounded-t-2xl is on the header instead */}
                <div className="sticky top-0 z-20 bg-card/95 backdrop-blur-sm flex items-center gap-3 px-6 py-4 md:px-8 border-b border-border rounded-t-2xl">
                  <div className="w-9 h-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <Sparkles className="w-4 h-4 text-primary" />
                  </div>
                  <div className="min-w-0">
                    <h2 className="font-display text-lg font-semibold text-foreground truncate">
                      {currentItinerary ? `${currentItinerary.emoji} ${currentItinerary.name}` : "Your Personalized Itinerary"}
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      {currentItinerary ? "Swipe between themes above" : "Crafted based on your preferences"}
                    </p>
                  </div>
                </div>

                <div className="p-6 md:p-8">
                  <ItineraryOutput
                    itinerary={currentItinerary?.content || ""}
                    structuredData={currentItinerary?.structuredData}
                    isLoading={isGenerating && !currentItinerary?.content}
                    isStreaming={!!(currentItinerary?.content && loadingVariants[currentItinerary?.id])}
                    isEditing={currentItinerary ? loadingVariants[currentItinerary.id] && !isGenerating : false}
                    onEdit={handleEdit}
                    themeTitle={currentItinerary ? `${currentItinerary.emoji} ${currentItinerary.name}` : undefined}
                    tripPreferences={preferences}
                  />
                </div>
              </div>
            </div>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="border-t border-border py-8">
        <div className="container text-center text-sm text-muted-foreground">
          <p>Powered by AI. Made personally for you. For travelers everywhere.</p>
        </div>
      </footer>
    </div>
  );
};

export default Index;
