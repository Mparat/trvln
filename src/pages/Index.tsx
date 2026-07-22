import { useState, useCallback, useEffect, useRef } from "react";
import { Sparkles, MapPin, Plane, ScanSearch, ChevronLeft, Plus, Bookmark, BookmarkCheck, Loader2 as BookmarkLoader, RefreshCw } from "lucide-react";
import { TripInputForm, TripPreferences } from "@/components/TripInputForm";
import { ItineraryOutput } from "@/components/ItineraryOutput";
import { TripSummaryCard } from "@/components/TripSummaryCard";
import { ItinerarySwitcher } from "@/components/ItinerarySwitcher";
import { AuthModal } from "@/components/AuthModal";
import { SavedTripsList } from "@/components/SavedTripsList";
import { supabase } from "@/lib/supabase";
import { toast } from "@/hooks/use-toast";
import { ItineraryData } from "@/types/itinerary";
import type { Json } from "@/integrations/supabase/types";
import { format } from "date-fns";
import type { User } from "@supabase/supabase-js";

type View = 'input' | 'results' | 'saved-list';

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
  tagline?: string;
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
  view: View;
};

const loadPersistedSession = (): PersistedSession | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PersistedSession;
    if (!parsed || typeof parsed !== 'object' || !parsed.preferences) return null;
    // Date fields serialize to ISO strings — reconstruct them.
    if (parsed.preferences.startDate) parsed.preferences.startDate = new Date(parsed.preferences.startDate);
    if (parsed.preferences.endDate) parsed.preferences.endDate = new Date(parsed.preferences.endDate);
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
  view: View,
): PersistedSession => {
  const media = preferences.media
    .filter(m => m.url) // only fully-uploaded media survives a reload
    .map(({ file, preview, ...rest }) => ({
      ...rest,
      preview: preview && !preview.startsWith('blob:') ? preview : rest.url,
    }));
  return { preferences: { ...preferences, media }, itineraries, activeVariant, view };
};

// A generation run in flight. Persisted so a reloaded/backgrounded tab can
// reconnect and fetch the itineraries the server finished on its own.
const PENDING_BATCH_KEY = 'trvln:pendingBatch:v1';

type PendingJob = { jobId: string; themeId: string; name: string; emoji: string };
type PendingBatch = { batchId: string; jobs: PendingJob[] };

const loadPendingBatch = (): PendingBatch | null => {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(PENDING_BATCH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as PendingBatch;
    if (!parsed?.batchId || !Array.isArray(parsed.jobs) || parsed.jobs.length === 0) return null;
    return parsed;
  } catch {
    return null;
  }
};

const savePendingBatch = (batch: PendingBatch) => {
  try { window.localStorage.setItem(PENDING_BATCH_KEY, JSON.stringify(batch)); }
  catch { /* storage unavailable — reconnect just won't be possible */ }
};

const clearPendingBatch = () => {
  try { window.localStorage.removeItem(PENDING_BATCH_KEY); } catch { /* ignore */ }
};

// Parse a completed itinerary's JSON, repairing truncated output if needed.
const parseStructuredItinerary = (content: string): ItineraryData | undefined => {
  try {
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return undefined;
    const raw = jsonMatch[0];
    try {
      return JSON.parse(raw) as ItineraryData;
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
      return JSON.parse(repairJson(raw)) as ItineraryData;
    }
  } catch (e) {
    console.error('Failed to parse structured itinerary:', e);
    return undefined;
  }
};

const stripPlanningSection = (content: string): string => {
  const closingTag = '</itinerary_planning>';
  const closingIndex = content.indexOf(closingTag);
  if (closingIndex !== -1) return content.slice(closingIndex + closingTag.length).trimStart();
  if (content.includes('<itinerary_planning>')) return '';
  return content;
};

// Stores a trip the user tried to save while logged out, so we can finish the
// save once the sign-in redirect (Google / magic link) brings them back.
const PENDING_SAVE_KEY = "trvln_pending_save";

const Index = () => {
  const [view, setView] = useState<View>(() => loadPersistedSession()?.view ?? 'input');
  const [preferences, setPreferences] = useState<TripPreferences>(
    () => loadPersistedSession()?.preferences ?? defaultPreferences
  );
  const [itineraries, setItineraries] = useState<ItineraryVariant[]>(
    () => loadPersistedSession()?.itineraries ?? []
  );
  const [activeVariant, setActiveVariant] = useState(() => loadPersistedSession()?.activeVariant ?? 0);
  const [isGenerating, setIsGenerating] = useState(false);
  const [loadingVariants, setLoadingVariants] = useState<Record<string, boolean>>({});
  const [isSuggestingThemes, setIsSuggestingThemes] = useState(false);
  const [isAnalyzingMedia, setIsAnalyzingMedia] = useState(false);
  const [isIdentifyingLocations, setIsIdentifyingLocations] = useState(false);
  // True while fetching itineraries the server finished after this tab was
  // backgrounded/reloaded mid-generation.
  const [isReconnecting, setIsReconnecting] = useState(false);
  // Set true when a fresh generation starts, to supersede an in-flight reconnect
  // poll so it doesn't overwrite the new run's results.
  const reconnectAbortRef = useRef(false);

  // Auth + save state
  const [user, setUser] = useState<User | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSaved, setIsSaved] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null);
      if (session?.user) setShowAuthModal(false);
    });
    return () => subscription.unsubscribe();
  }, []);

  // Persist the session (preferences + itineraries + current screen) so a
  // reloaded/backgrounded tab restores instead of clearing. Debounced because
  // itineraries update rapidly while streaming. Transient loading flags are not
  // persisted: the in-flight request dies on reload, so a partial itinerary is
  // restored as-is rather than left spinning.
  useEffect(() => {
    const handle = window.setTimeout(() => {
      try {
        const snapshot = buildSessionSnapshot(preferences, itineraries, activeVariant, view);
        window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(snapshot));
      } catch (error) {
        console.warn('Failed to persist session:', error);
      }
    }, 400);
    return () => window.clearTimeout(handle);
  }, [preferences, itineraries, activeVariant, view]);

  // On mount, if a generation was in flight when the tab was closed/reloaded,
  // reconnect: the server kept generating (and saving) each itinerary, so poll
  // itinerary_jobs until every variant is complete and fill them in.
  useEffect(() => {
    const pending = loadPendingBatch();
    if (!pending || pending.jobs.length === 0) return;

    reconnectAbortRef.current = false;
    // Ensure switcher entries exist (restored session usually has them; if the
    // tab died before that persisted, rebuild from the batch metadata).
    setItineraries(prev => prev.length > 0
      ? prev
      : pending.jobs.map(j => ({ id: j.themeId, name: j.name, emoji: j.emoji, content: "" })));
    setLoadingVariants(prev => {
      const next = { ...prev };
      for (const j of pending.jobs) next[j.themeId] = true;
      return next;
    });
    setIsGenerating(true);
    setIsReconnecting(true);
    setView('results');

    const pollJob = async (job: PendingJob) => {
      const deadline = Date.now() + 5 * 60 * 1000;
      while (!reconnectAbortRef.current && Date.now() < deadline) {
        const { data } = await supabase
          .from('itinerary_jobs')
          .select('status,content')
          .eq('id', job.jobId)
          .maybeSingle();
        if (reconnectAbortRef.current) return;
        if (data?.status === 'complete' && data.content) {
          const displayContent = stripPlanningSection(data.content);
          const structuredData = parseStructuredItinerary(displayContent);
          setItineraries(prev => prev.map(it =>
            it.id === job.themeId ? { ...it, content: displayContent, structuredData } : it));
          setLoadingVariants(prev => ({ ...prev, [job.themeId]: false }));
          return;
        }
        if (data?.status === 'error') {
          setLoadingVariants(prev => ({ ...prev, [job.themeId]: false }));
          return;
        }
        await new Promise(r => setTimeout(r, 2500));
      }
      setLoadingVariants(prev => ({ ...prev, [job.themeId]: false }));
    };

    (async () => {
      await Promise.all(pending.jobs.map(pollJob));
      if (reconnectAbortRef.current) return; // a new generation took over
      setIsGenerating(false);
      setIsReconnecting(false);
      clearPendingBatch();
    })();

    return () => { reconnectAbortRef.current = true; };
  }, []);

  const getHeaders = useCallback(() => ({
    "Content-Type": "application/json",
    "apikey": import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  }), []);

  const analyzeInspiration = useCallback(async (mediaUrls: string[]): Promise<IdentifiedDestination[]> => {
    if (mediaUrls.length === 0) return [];
    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-inspiration`, {
      // The edge function accepts at most 20 images per call
      method: "POST", headers: getHeaders(), body: JSON.stringify({ mediaUrls: mediaUrls.slice(0, 20) }),
    });
    if (!response.ok) return [];
    const data = await response.json();
    return data.destinations || [];
  }, [getHeaders]);

  const suggestThemes = useCallback(async (prefs: TripPreferences) => {
    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/suggest-themes`, {
      method: "POST", headers: getHeaders(), body: JSON.stringify({ preferences: prefs }),
    });
    if (!response.ok) { const e = await response.json().catch(() => ({})); throw new Error(e.error || "Failed to suggest themes"); }
    const data = await response.json();
    return data.themes as { id: string; name: string; emoji: string; tagline?: string }[];
  }, [getHeaders]);

  const generateSingleItinerary = useCallback(async (
    prefs: TripPreferences,
    themeVariant: { id: string; name: string; emoji: string },
    onUpdate: (content: string) => void,
    jobIds?: { jobId: string; batchId: string }
  ) => {
    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-itinerary`, {
      method: "POST", headers: getHeaders(), body: JSON.stringify({ preferences: prefs, themeVariant, ...jobIds }),
    });
    if (!response.ok) { const e = await response.json().catch(() => ({})); throw new Error(e.error || "Failed to generate"); }
    if (!response.body) throw new Error("No response body");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let textBuffer = "", fullContent = "";

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
          if (content) { fullContent += content; onUpdate(fullContent); }
        } catch { /* skip */ }
      }
    }
    return fullContent;
  }, [getHeaders]);

  // ── Save trip ──────────────────────────────────────────────────────────────
  const performSave = useCallback(async (currentUser: User, currentItineraries: ItineraryVariant[], currentPrefs: TripPreferences) => {
    setIsSaving(true);
    try {
      const destination =
        currentItineraries.find(v => v.structuredData?.summary?.destination)?.structuredData?.summary?.destination
        ?? currentPrefs.cities[0]
        ?? "My Trip";

      let dateStr = "";
      if (currentPrefs.startDate) {
        const start = new Date(currentPrefs.startDate);
        dateStr = format(start, "MMM yyyy");
        if (currentPrefs.endDate) {
          const end = new Date(currentPrefs.endDate);
          const sameYear = format(end, "yyyy") === format(start, "yyyy");
          const sameMonth = format(end, "M") === format(start, "M");
          if (!sameYear) dateStr += ` – ${format(end, "MMM yyyy")}`;
          else if (!sameMonth) dateStr += ` – ${format(end, "MMM")}`;
        }
      } else if (currentPrefs.targetMonth) {
        dateStr = currentPrefs.targetMonth;
      }

      const title = dateStr ? `${destination} · ${dateStr}` : destination;

      const { error } = await supabase.from("saved_trips").insert({
        user_id: currentUser.id,
        title,
        // Stored as jsonb — cast our typed objects to the Json column type.
        variants: currentItineraries as unknown as Json,
        preferences: currentPrefs as unknown as Json,
      });
      if (error) throw error;
      setIsSaved(true);
      toast({ title: "Trip saved!", description: "Find it in Saved trips" });
    } catch {
      toast({ title: "Couldn't save", description: "Please try again", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  }, []);

  // Finish a save that was interrupted by the sign-in redirect (Google / magic link).
  // Declared after performSave so its dependency array doesn't hit the TDZ.
  useEffect(() => {
    if (!user) return;
    let raw: string | null = null;
    try { raw = localStorage.getItem(PENDING_SAVE_KEY); } catch { return; }
    if (!raw) return;
    try { localStorage.removeItem(PENDING_SAVE_KEY); } catch { /* ignore */ }
    try {
      const { itineraries: savedItins, preferences: savedPrefs } = JSON.parse(raw);
      if (Array.isArray(savedItins) && savedItins.length > 0) {
        setItineraries(savedItins);
        if (savedPrefs) setPreferences(savedPrefs);
        setActiveVariant(0);
        setView('results');
        performSave(user, savedItins, savedPrefs);
      }
    } catch { /* malformed — drop it */ }
  }, [user, performSave]);

  const handleSaveTrip = useCallback(() => {
    if (isSaved || isSaving) return;
    if (!user) {
      // Stash the trip so we can finish the save after the auth redirect returns.
      try {
        localStorage.setItem(PENDING_SAVE_KEY, JSON.stringify({ itineraries, preferences }));
      } catch { /* quota — fall back to manual re-tap */ }
      setShowAuthModal(true);
      return;
    }
    performSave(user, itineraries, preferences);
  }, [user, itineraries, preferences, isSaved, isSaving, performSave]);

  // ── Open a saved trip ──────────────────────────────────────────────────────
  const handleOpenSavedTrip = useCallback((variants: ItineraryVariant[], savedPrefs: TripPreferences | null) => {
    setItineraries(variants);
    setActiveVariant(0);
    if (savedPrefs) setPreferences(savedPrefs);
    setIsSaved(true);
    setView('results');
  }, []);

  const handleNewSearch = useCallback(() => {
    setPreferences(defaultPreferences);
    setItineraries([]);
    setActiveVariant(0);
    setLoadingVariants({});
    setIsSaved(false);
    setView('input');
  }, []);

  // ── Generate ───────────────────────────────────────────────────────────────
  const handleGenerate = useCallback(async (pendingCity?: string) => {
    const effectiveCities = pendingCity && !preferences.cities.includes(pendingCity)
      ? [...preferences.cities, pendingCity] : preferences.cities;
    let effectivePreferences: TripPreferences = { ...preferences, cities: effectiveCities };
    if (pendingCity && !preferences.cities.includes(pendingCity)) setPreferences(effectivePreferences);

    const hasInspiration = effectivePreferences.media.length > 0 || effectiveCities.length > 0 || effectivePreferences.additionalNotes.trim();
    if (!hasInspiration) {
      toast({ title: "Add some inspiration", description: "Drop some travel photos, add links, or list cities you want to visit", variant: "destructive" });
      return;
    }

    // Supersede any in-flight reconnect from a previous session.
    reconnectAbortRef.current = true;
    setIsReconnecting(false);

    setIsGenerating(true);
    setItineraries([]);
    setActiveVariant(0);
    setIsSaved(false);
    setView('results');

    try {
      const mediaWithUrls = effectivePreferences.media.filter(m => m.url);
      if (mediaWithUrls.length > 0) {
        setIsAnalyzingMedia(true);
        const allImageUrls: string[] = [];
        for (const item of mediaWithUrls) {
          if (item.type === 'image' && item.url) allImageUrls.push(item.url);
          else if (item.type === 'video' && item.frameUrls?.length) allImageUrls.push(...item.frameUrls);
        }
        if (allImageUrls.length > 0) {
          const identified = await analyzeInspiration(allImageUrls);
          const newLocations = identified
            .filter(d => d.confidence === 'high' || d.confidence === 'medium')
            .map(d => d.location)
            .filter(loc => !effectivePreferences.cities.some(c =>
              c.toLowerCase().includes(loc.toLowerCase()) || loc.toLowerCase().includes(c.toLowerCase())
            ));
          if (newLocations.length > 0) {
            effectivePreferences = { ...effectivePreferences, cities: [...effectivePreferences.cities, ...newLocations] };
            setPreferences(effectivePreferences);
            toast({ title: `📍 Found ${newLocations.length} destination${newLocations.length > 1 ? 's' : ''} in your photos!`, description: newLocations.join(', ') });
          }
        }
        setIsAnalyzingMedia(false);
      }

      setIsSuggestingThemes(true);
      const themes = await suggestThemes(effectivePreferences);
      setIsSuggestingThemes(false);
      setItineraries(themes.map(t => ({ ...t, content: "" })));
      setLoadingVariants(Object.fromEntries(themes.map(t => [t.id, true])));

      // Tag each variant with a job id and record the batch, so if this tab is
      // backgrounded/discarded mid-generation the server finishes and saves each
      // itinerary and a reopened tab can reconnect and fetch the results.
      const batchId = crypto.randomUUID();
      const jobIdByTheme: Record<string, string> = Object.fromEntries(
        themes.map(t => [t.id, crypto.randomUUID()])
      );
      savePendingBatch({
        batchId,
        jobs: themes.map(t => ({ jobId: jobIdByTheme[t.id], themeId: t.id, name: t.name, emoji: t.emoji })),
      });

      const contentMap: Record<string, string> = {};
      const promises = themes.map(async (theme) => {
        try {
          const content = await generateSingleItinerary(effectivePreferences, theme, (updatedContent) => {
            const displayContent = stripPlanningSection(updatedContent);
            contentMap[theme.id] = displayContent;
            setItineraries(prev => prev.map(it => contentMap[it.id] !== undefined ? { ...it, content: contentMap[it.id] } : it));
          }, { jobId: jobIdByTheme[theme.id], batchId });

          const structuredData = parseStructuredItinerary(content);
          if (structuredData) setItineraries(prev => prev.map(it => it.id === theme.id ? { ...it, structuredData } : it));
          setLoadingVariants(prev => ({ ...prev, [theme.id]: false }));
          return { id: theme.id, success: true, content };
        } catch (error) {
          console.error(`Error generating ${theme.id}:`, error);
          setLoadingVariants(prev => ({ ...prev, [theme.id]: false }));
          return { id: theme.id, success: false, error };
        }
      });

      await Promise.all(promises);
      clearPendingBatch(); // all variants finished locally — no reconnect needed
      toast({ title: "3 itineraries ready!", description: "Explore different themed versions of your trip" });
    } catch (error) {
      console.error("Error in generation flow:", error);
      toast({ title: "Something went wrong", description: error instanceof Error ? error.message : "Please try again later", variant: "destructive" });
    } finally {
      setIsGenerating(false);
      setIsSuggestingThemes(false);
      setIsAnalyzingMedia(false);
    }
  }, [preferences, suggestThemes, generateSingleItinerary, analyzeInspiration]);

  const handleEdit = useCallback(async (editRequest: string) => {
    const current = itineraries[activeVariant];
    if (!current) return;
    toast({ title: "Processing your changes...", description: "Updating the itinerary based on your request" });
    setLoadingVariants(prev => ({ ...prev, [current.id]: true }));
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/edit-itinerary`, {
        method: "POST", headers: getHeaders(),
        body: JSON.stringify({ editRequest, currentItinerary: current.content, themeTitle: `${current.emoji} ${current.name}`, tripPreferences: preferences }),
      });
      if (!response.ok) { const e = await response.json().catch(() => ({})); throw new Error(e.error || "Failed to edit itinerary"); }
      const data = await response.json();
      setItineraries(prev => prev.map((it, idx) =>
        idx === activeVariant ? { ...it, content: stripPlanningSection(data.updatedItinerary), structuredData: undefined } : it
      ));
      setIsSaved(false); // Mark as unsaved after edit
      toast({ title: "Changes applied!", description: "Your itinerary has been updated" });
    } catch (error) {
      toast({ title: "Edit failed", description: error instanceof Error ? error.message : "Something went wrong", variant: "destructive" });
    } finally {
      setLoadingVariants(prev => ({ ...prev, [current.id]: false }));
    }
  }, [itineraries, activeVariant, getHeaders, preferences]);

  const currentItinerary = itineraries[activeVariant];

  // First name for the personalized greeting (from OAuth metadata, else email local-part)
  const firstName = (() => {
    if (!user) return "";
    const meta = user.user_metadata ?? {};
    const fromName = (meta.full_name || meta.name || meta.given_name || "").trim().split(/\s+/)[0];
    if (fromName) return fromName.charAt(0).toUpperCase() + fromName.slice(1);
    const local = user.email?.split("@")[0] ?? "";
    if (!local) return "";
    return local.charAt(0).toUpperCase() + local.slice(1);
  })();

  // ── Shared top nav ─────────────────────────────────────────────────────────
  const ResultsNav = () => (
    <div className="sticky top-0 z-30 bg-background/95 backdrop-blur-sm border-b border-border">
      <div className="container max-w-4xl mx-auto flex items-center justify-between px-4 py-3">
        <button
          onClick={() => setView('input')}
          className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <ChevronLeft className="w-4 h-4" />
          Back
        </button>
        <div className="flex items-center gap-2">
          <img src="/favicon.svg" alt="Travellin'" className="w-5 h-5" />
          <span className="font-display text-sm text-primary">Travellin'</span>
        </div>
        <button
          onClick={handleNewSearch}
          className="flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors"
        >
          <Plus className="w-4 h-4" />
          <span className="hidden sm:inline">New Search</span>
        </button>
      </div>
    </div>
  );

  // ── Saved trips list ───────────────────────────────────────────────────────
  if (view === 'saved-list') {
    return (
      <>
        <SavedTripsList onBack={() => setView('input')} onOpen={handleOpenSavedTrip} />
        <AuthModal open={showAuthModal} onOpenChange={setShowAuthModal} />
      </>
    );
  }

  // ── Results screen ─────────────────────────────────────────────────────────
  if (view === 'results') {
    return (
      <div className="min-h-screen gradient-hero">
        <ResultsNav />
        <main className="container pb-20">
          <div className="max-w-4xl mx-auto pt-6 space-y-6">
            {/* Loading state */}
            {isGenerating && itineraries.length === 0 && (
              <div className="bg-card rounded-2xl shadow-medium p-6 flex items-center gap-4 animate-slide-up">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center animate-pulse">
                  {isAnalyzingMedia ? <ScanSearch className="w-5 h-5 text-primary" /> : <Sparkles className="w-5 h-5 text-primary" />}
                </div>
                <div>
                  <p className="font-medium text-foreground">
                    {isAnalyzingMedia ? "Analyzing your inspiration photos..." : isSuggestingThemes ? "Crafting unique theme ideas..." : "Preparing your itineraries..."}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {isAnalyzingMedia ? "AI is identifying travel destinations from your images" : "This usually takes a few seconds"}
                  </p>
                </div>
              </div>
            )}

            {/* Reconnect indicator — server kept generating while the tab was away */}
            {isReconnecting && (
              <div className="bg-card rounded-2xl shadow-medium p-6 flex items-center gap-4 animate-slide-up">
                <div className="w-10 h-10 rounded-full bg-primary/10 flex items-center justify-center">
                  <RefreshCw className="w-5 h-5 text-primary animate-spin" />
                </div>
                <div>
                  <p className="font-medium text-foreground">Finishing your itineraries...</p>
                  <p className="text-sm text-muted-foreground">
                    Generation kept running while you were away — picking up the results now
                  </p>
                </div>
              </div>
            )}

            {/* Save + variant switcher */}
            {itineraries.length > 0 && (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <button
                    onClick={handleSaveTrip}
                    disabled={isSaving}
                    className="flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground transition-colors disabled:opacity-40"
                  >
                    {isSaving ? (
                      <BookmarkLoader className="w-4 h-4 animate-spin" />
                    ) : isSaved ? (
                      <BookmarkCheck className="w-4 h-4 text-primary" />
                    ) : (
                      <Bookmark className="w-4 h-4" />
                    )}
                    {isSaved ? "Saved" : "Save trip"}
                  </button>
                </div>
                <ItinerarySwitcher variants={itineraries} activeIndex={activeVariant} onSelect={setActiveVariant} loadingVariants={loadingVariants} />
              </div>
            )}

            {/* Summary card — markdown fallback only */}
            {currentItinerary?.content && !loadingVariants[currentItinerary.id] && !currentItinerary.structuredData && (
              <TripSummaryCard itinerary={currentItinerary.content} departureCity={preferences.departureCity} startDate={preferences.startDate} endDate={preferences.endDate} durationDays={preferences.durationDays} />
            )}

            {/* Itinerary card */}
            {(itineraries.length > 0 || isGenerating) && (
              <div className="bg-card rounded-2xl shadow-medium">
                <div className="sticky top-[57px] z-20 bg-card/95 backdrop-blur-sm px-6 py-5 md:px-8 rounded-t-2xl">
                  <h2 className="font-display text-xl font-bold text-foreground leading-tight">
                    {currentItinerary ? `${currentItinerary.emoji} ${currentItinerary.name}` : "Your Personalized Itinerary"}
                  </h2>
                  <p className="text-sm text-muted-foreground mt-1 leading-snug">
                    {currentItinerary?.structuredData?.summary?.vibeSummary || currentItinerary?.tagline || "Crafted based on your preferences"}
                  </p>
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
            )}
          </div>
        </main>
        <AuthModal open={showAuthModal} onOpenChange={setShowAuthModal} />
      </div>
    );
  }

  // ── Input screen ───────────────────────────────────────────────────────────
  return (
    <div className="min-h-screen gradient-hero">
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
            {firstName ? `Where to next, ${firstName}?` : "Where to next?"}
          </h1>
          <p className="mt-6 text-lg md:text-xl text-muted-foreground text-center max-w-2xl mx-auto text-balance">
            Drop your saved TikToks, tell us your vibe, and let AI craft the perfect itinerary — complete with flights, hidden gems, and local favorites.
          </p>
          <div className="flex items-center justify-center gap-6 mt-8 text-sm text-muted-foreground">
            <div className="flex items-center gap-2"><MapPin className="w-4 h-4" /><span>Hidden gems included</span></div>
            <div className="flex items-center gap-2"><Plane className="w-4 h-4" /><span>Flight suggestions</span></div>
            <div className="flex items-center gap-2"><Sparkles className="w-4 h-4" /><span>Local knowledge</span></div>
          </div>
        </div>
      </header>

      <main className="container pb-20">
        <div className="max-w-4xl mx-auto space-y-6">
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
                  toast({ title: `📍 Found ${newLocations.length} destination${newLocations.length > 1 ? 's' : ''}!`, description: newLocations.join(', ') });
                } else {
                  toast({ title: "No locations identified", description: "Try a video with clearer landmarks or add cities manually" });
                }
              } finally {
                setIsIdentifyingLocations(false);
              }
            }}
          />

          {/* Saved trips entry */}
          <div className="flex justify-center pb-2">
            <button
              onClick={() => user ? setView('saved-list') : setShowAuthModal(true)}
              className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground transition-colors"
            >
              <Bookmark className="w-4 h-4" />
              Saved trips
            </button>
          </div>
        </div>
      </main>

      <footer className="border-t border-border py-8">
        <div className="container text-center text-sm text-muted-foreground">
          <p>Powered by AI. Made personally for you. For travelers everywhere.</p>
        </div>
      </footer>

      <AuthModal open={showAuthModal} onOpenChange={setShowAuthModal} />
    </div>
  );
};

export default Index;
