import { useState, useCallback, useEffect, useRef } from "react";
import { Sparkles, MapPin, Plane, ChevronLeft, Plus, Bookmark, BookmarkCheck, Loader2 as BookmarkLoader, RefreshCw } from "lucide-react";
import { TripInputForm, TripPreferences } from "@/components/TripInputForm";
import { ItineraryOutput } from "@/components/ItineraryOutput";
import { TripSummaryCard } from "@/components/TripSummaryCard";
import { ItinerarySwitcher } from "@/components/ItinerarySwitcher";
import { AuthModal } from "@/components/AuthModal";
import { SavedTripsList } from "@/components/SavedTripsList";
import { supabase, functionHeaders } from "@/lib/supabase";
import { startCheckout, savePendingCheckout, consumePendingCheckout, clearPendingCheckout, waitForPurchase, type CreditPack } from "@/lib/checkout";
import { UnlockDialog } from "@/components/UnlockDialog";
import { PaywallModal } from "@/components/PaywallModal";
import { useEntitlements } from "@/components/EntitlementsProvider";
import { sendReadyText } from "@/lib/readyText";
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
  // The generation batch this variant belongs to and the job that produced it.
  // Stamped when generation starts and serialized everywhere the variant goes
  // (session snapshot, saved trips), so an unlock can name the right batch
  // even after a reload or on a reopened saved trip.
  batchId?: string;
  jobId?: string;
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

// Everything a single variant needs to generate itself, so a variant opened
// later can run without re-deriving the batch it belongs to.
type GenerationContext = {
  preferences: TripPreferences;
  batchId: string;
  jobIdByTheme: Record<string, string>;
  runId: number;
};

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

// Variants are generated one at a time, on demand, so the pending batch is
// built up and torn down job by job. Only a variant that actually started has a
// job on the server; recording one that never ran would make the next load poll
// for a row that will never exist.
const addPendingJob = (batchId: string, job: PendingJob) => {
  const current = loadPendingBatch();
  const jobs = current?.batchId === batchId
    ? current.jobs.filter(j => j.themeId !== job.themeId)
    : [];
  savePendingBatch({ batchId, jobs: [...jobs, job] });
};

const removePendingJob = (batchId: string, themeId: string) => {
  const current = loadPendingBatch();
  if (!current || current.batchId !== batchId) return;
  const jobs = current.jobs.filter(j => j.themeId !== themeId);
  if (jobs.length === 0) clearPendingBatch();
  else savePendingBatch({ batchId, jobs });
};

// Poll itinerary_jobs until the server finishes the given job. The edge
// function keeps generating and persists the result even after the client
// disconnects, so this is how a tab recovers a stream it lost — whether it was
// reloaded or just frozen in the background by mobile Safari/Chrome.
// The outcome is reported separately from the content: 'error' means the server
// gave up and there is nothing left to wait for, while 'timeout' means the job
// may still be running and is worth reconnecting to on a later load.
type JobPollResult =
  | { status: 'complete'; content: string }
  | { status: 'error' | 'timeout' | 'stale' };

const pollJobContent = async (
  jobId: string,
  isStale: () => boolean,
  timeoutMs = 5 * 60 * 1000,
): Promise<JobPollResult> => {
  const deadline = Date.now() + timeoutMs;
  while (!isStale() && Date.now() < deadline) {
    const { data } = await supabase
      .from('itinerary_jobs')
      .select('status,content')
      .eq('id', jobId)
      .maybeSingle();
    if (isStale()) return { status: 'stale' };
    if (data?.status === 'complete' && data.content) return { status: 'complete', content: data.content };
    if (data?.status === 'error') return { status: 'error' };
    await new Promise(r => setTimeout(r, 2500));
  }
  return { status: isStale() ? 'stale' : 'timeout' };
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

// A finished variant texts the user's phone. sendReadyText is a no-op unless
// they opted in with a number, so this is safe to call from every completion
// path; the edge function rate-limits repeats per number.
const notifyVariantReady = (
  variant: { id: string; name: string; emoji: string },
  destination?: string,
) => {
  void sendReadyText(variant, destination);
};

// Stores a trip the user tried to save while logged out, so we can finish the
// save once the Google sign-in redirect brings them back.
const PENDING_SAVE_KEY = "trvln_pending_save";
// Records where a sign-in should land the user when they reach the auth modal
// from a flow that isn't "save" (e.g. tapping "Saved trips" while logged out).
// Kept separate from — and mutually exclusive with — PENDING_SAVE_KEY so the
// two intents never fire together.
const PENDING_SIGNIN_DEST_KEY = "trvln_pending_signin_dest";

// Forget any queued post-sign-in action (save, redirect, or purchase). Called
// when the user abandons the flow that queued it.
const clearPendingAuthAction = () => {
  try {
    localStorage.removeItem(PENDING_SAVE_KEY);
    localStorage.removeItem(PENDING_SIGNIN_DEST_KEY);
  } catch { /* ignore */ }
  clearPendingCheckout();
};

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
  // Bumped whenever a generation or reconnect takes over. Async work captures
  // the value it started under and bails out once it no longer matches, so a
  // superseded run can't overwrite the current one's results or loading flags.
  const runIdRef = useRef(0);
  // Only the first variant is generated up front; the rest are generated when
  // the user actually opens them. These hold what a later variant needs to run.
  const generationContextRef = useRef<GenerationContext | null>(null);
  // Variants already kicked off, so re-opening a tab mid-generation doesn't
  // start a second run for the same theme.
  const startedVariantsRef = useRef<Set<string>>(new Set());
  // Completion handlers outlive the render that started them — the reconnect
  // poll runs from a mount effect — so the notification reads its label here.
  const destinationRef = useRef<string>('');

  // Auth + save state
  const [user, setUser] = useState<User | null>(null);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isSaved, setIsSaved] = useState(false);
  // True once the user actually kicks off a sign-in from the auth modal (Google
  // redirect begun). Lets us tell "dismissed without signing in"
  // (cancel the queued action) from "left to complete sign-in" (keep it).
  const authInitiatedRef = useRef(false);

  // The saved_trips row backing the trip on screen, when there is one — set on
  // save and on opening a saved trip, so re-saves update in place.
  const savedTripIdRef = useRef<string | null>(null);

  const entitlements = useEntitlements();

  useEffect(() => {
    destinationRef.current = preferences.cities[0] ?? '';
  }, [preferences.cities]);

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

    const runId = ++runIdRef.current;
    let unmounted = false;
    const isStale = () => unmounted || runIdRef.current !== runId;
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

    // These variants already have a job running on the server. Mark them started
    // so opening one while we reconnect doesn't kick off a duplicate generation.
    pending.jobs.forEach(job => startedVariantsRef.current.add(job.themeId));

    const pollJob = async (job: PendingJob) => {
      const result = await pollJobContent(job.jobId, isStale);
      if (isStale()) return;
      if (result.status === 'complete') {
        const displayContent = stripPlanningSection(result.content);
        const structuredData = parseStructuredItinerary(displayContent);
        setItineraries(prev => prev.map(it =>
          it.id === job.themeId ? { ...it, content: displayContent, structuredData } : it));
        notifyVariantReady(
          { id: job.themeId, name: job.name, emoji: job.emoji },
          destinationRef.current,
        );
      }
      setLoadingVariants(prev => ({ ...prev, [job.themeId]: false }));
    };

    (async () => {
      await Promise.all(pending.jobs.map(pollJob));
      if (isStale()) return; // a new generation took over
      setIsGenerating(false);
      setIsReconnecting(false);
      clearPendingBatch();
    })();

    return () => { unmounted = true; };
  }, []);

  const getHeaders = useCallback(() => functionHeaders(), []);

  const analyzeInspiration = useCallback(async (mediaUrls: string[]): Promise<IdentifiedDestination[]> => {
    if (mediaUrls.length === 0) return [];
    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/analyze-inspiration`, {
      // The edge function accepts at most 20 images per call
      method: "POST", headers: await getHeaders(), body: JSON.stringify({ mediaUrls: mediaUrls.slice(0, 20) }),
    });
    if (!response.ok) return [];
    const data = await response.json();
    return data.destinations || [];
  }, [getHeaders]);

  const suggestThemes = useCallback(async (prefs: TripPreferences) => {
    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/suggest-themes`, {
      method: "POST", headers: await getHeaders(), body: JSON.stringify({ preferences: prefs }),
    });
    if (!response.ok) { const e = await response.json().catch(() => ({})); throw new Error(e.error || "Failed to suggest themes"); }
    const data = await response.json();
    return data.themes as { id: string; name: string; emoji: string; tagline?: string }[];
  }, [getHeaders]);

  const generateSingleItinerary = useCallback(async (
    prefs: TripPreferences,
    themeVariant: { id: string; name: string; emoji: string },
    onUpdate: (content: string) => void,
    jobIds?: { jobId: string; batchId: string },
    // Resume-on-unlock sends a different request body but reads the same
    // stream; everything below the fetch is shared.
    bodyOverride?: Record<string, unknown>,
  ) => {
    const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-itinerary`, {
      method: "POST", headers: await getHeaders(),
      body: JSON.stringify(bodyOverride ?? { preferences: prefs, themeVariant, ...jobIds }),
    });
    if (!response.ok) {
      const e = await response.json().catch(() => ({}));
      // The server actively refused this request (bad input, rate limit, upstream
      // failure). Nothing is generating in the background, so there is nothing for
      // the recovery poll to wait for — flag it so the caller doesn't sit on it.
      throw Object.assign(new Error(e.error || "Failed to generate"), { serverRejected: true });
    }
    if (!response.body) throw new Error("No response body");

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let textBuffer = "", fullContent = "";
    // Only a [DONE] sentinel proves we received the whole itinerary. A stream
    // that just stops — the usual outcome when a mobile browser freezes a
    // backgrounded tab and drops its connection — leaves partial or empty
    // content, so the caller has to recover it from the server instead.
    let complete = false;

    while (!complete) {
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
        if (jsonStr === "[DONE]") { complete = true; break; }
        try {
          const parsed = JSON.parse(jsonStr);
          const content = parsed.choices?.[0]?.delta?.content;
          if (content) { fullContent += content; onUpdate(fullContent); }
        } catch { /* skip */ }
      }
    }
    // We stopped reading at [DONE]; release the connection rather than leaving
    // it open for the rest of the tab's life.
    reader.cancel().catch(() => { /* already closed */ });

    return { content: fullContent, complete };
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

      // Re-saving a trip that already has a row (e.g. after an unlock filled
      // its content in) updates in place rather than duplicating it.
      if (savedTripIdRef.current) {
        const { error } = await supabase.from("saved_trips").update({
          title,
          variants: currentItineraries as unknown as Json,
          preferences: currentPrefs as unknown as Json,
        }).eq("id", savedTripIdRef.current);
        if (error) throw error;
      } else {
        const { data, error } = await supabase.from("saved_trips").insert({
          user_id: currentUser.id,
          title,
          // Stored as jsonb — cast our typed objects to the Json column type.
          variants: currentItineraries as unknown as Json,
          preferences: currentPrefs as unknown as Json,
        }).select("id").single();
        if (error) throw error;
        savedTripIdRef.current = data?.id ?? null;
      }
      setIsSaved(true);
      toast({ title: "Trip saved!", description: "Find it in Saved trips" });
    } catch {
      toast({ title: "Couldn't save", description: "Please try again", variant: "destructive" });
    } finally {
      setIsSaving(false);
    }
  }, []);

  // Resume whatever the user set out to do before the Google sign-in redirect
  // sent them away. Exactly one action is queued at a time: either a
  // pending save (from the "Save trip" flow) or a redirect (from "Saved trips").
  // Consuming a save must NOT also honor a redirect, and vice versa — signing in
  // from "Saved trips" should never resurrect a save the user abandoned earlier.
  // Declared after performSave so its dependency array doesn't hit the TDZ.
  useEffect(() => {
    if (!user) return;
    // A queued purchase goes straight to Stripe — it was the last thing the
    // user asked for before signing in. Consuming removes the key, so a later
    // auth event (token refresh, tab focus) can't replay it.
    const checkout = consumePendingCheckout();
    if (checkout) {
      clearPendingAuthAction();
      void startCheckout(checkout.pack, checkout.unlockBatchId).catch(err => {
        toast({
          title: "Couldn't start checkout",
          description: err instanceof Error ? err.message : "Please try again",
          variant: "destructive",
        });
      });
      return;
    }
    let raw: string | null = null;
    let dest: string | null = null;
    try {
      raw = localStorage.getItem(PENDING_SAVE_KEY);
      dest = localStorage.getItem(PENDING_SIGNIN_DEST_KEY);
    } catch { return; }
    // Clear both up front so a later auth event (token refresh, tab focus) can't
    // replay the action.
    clearPendingAuthAction();

    if (raw) {
      try {
        const { itineraries: savedItins, preferences: savedPrefs } = JSON.parse(raw);
        if (Array.isArray(savedItins) && savedItins.length > 0) {
          setItineraries(savedItins);
          if (savedPrefs) setPreferences(savedPrefs);
          setActiveVariant(0);
          setView('results');
          performSave(user, savedItins, savedPrefs);
          return;
        }
      } catch { /* malformed — fall through to any redirect intent */ }
    }

    if (dest === 'saved-list') setView('saved-list');
  }, [user, performSave]);

  const handleSaveTrip = useCallback(() => {
    if (isSaved || isSaving) return;
    if (!user) {
      // Stash the trip so we can finish the save after the auth redirect returns,
      // and drop any competing redirect intent so this is the only queued action.
      try {
        localStorage.setItem(PENDING_SAVE_KEY, JSON.stringify({ itineraries, preferences }));
        localStorage.removeItem(PENDING_SIGNIN_DEST_KEY);
        clearPendingCheckout();
      } catch { /* quota — fall back to manual re-tap */ }
      authInitiatedRef.current = false;
      setShowAuthModal(true);
      return;
    }
    performSave(user, itineraries, preferences);
  }, [user, itineraries, preferences, isSaved, isSaving, performSave]);

  // Open the saved-trips list, prompting sign-in first when logged out. Signing
  // in from here should land on the list — never trigger a save the user may
  // have started and walked away from earlier.
  const handleViewSavedTrips = useCallback(() => {
    if (user) { setView('saved-list'); return; }
    clearPendingAuthAction();
    try { localStorage.setItem(PENDING_SIGNIN_DEST_KEY, 'saved-list'); } catch { /* ignore */ }
    authInitiatedRef.current = false;
    setShowAuthModal(true);
  }, [user]);

  // Dismissing the auth modal without starting a sign-in cancels whatever action
  // (save / view saved / purchase) prompted it. A started sign-in (Google
  // redirect begun) leaves it queued so it can complete after the round-trip.
  const handleAuthModalOpenChange = useCallback((open: boolean) => {
    if (!open && !authInitiatedRef.current) clearPendingAuthAction();
    setShowAuthModal(open);
  }, []);

  // ── Open a saved trip ──────────────────────────────────────────────────────
  const handleOpenSavedTrip = useCallback((variants: ItineraryVariant[], savedPrefs: TripPreferences | null, tripId?: string) => {
    // This trip replaces whatever was on screen: supersede any in-flight
    // generation and drop the old trip's context so a later rebuild (retry,
    // variant click, unlock resume) derives from THESE variants — reusing the
    // previous trip's batch here would regenerate the wrong trip.
    runIdRef.current += 1;
    generationContextRef.current = null;
    startedVariantsRef.current = new Set();
    setLoadingVariants({});
    setIsGenerating(false);
    setIsReconnecting(false);
    savedTripIdRef.current = tripId ?? null;
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
    savedTripIdRef.current = null;
    setView('input');
    // The itinerary that a pending save referred to is gone — drop the queued save.
    clearPendingAuthAction();
  }, []);

  // Generate one variant end to end: stream it, and if the stream dies while the
  // server is still working, poll the job it left behind. Used both for the
  // variant generated up front and for the ones generated when opened.
  const runVariant = useCallback(async (
    theme: { id: string; name: string; emoji: string },
    ctx: GenerationContext,
    // When set, this run resumes an unlocked preview (writes only the locked
    // days server-side) instead of generating from scratch.
    resumeBatchId?: string,
  ): Promise<{ ok: boolean; stillPending: boolean; error?: unknown }> => {
    const isStale = () => runIdRef.current !== ctx.runId;
    startedVariantsRef.current.add(theme.id);

    const jobId = ctx.jobIdByTheme[theme.id] ?? crypto.randomUUID();
    ctx.jobIdByTheme[theme.id] = jobId;
    addPendingJob(ctx.batchId, { jobId, themeId: theme.id, name: theme.name, emoji: theme.emoji });

    // Stamp the batch/job identity onto the variant up front — the unlock flow
    // needs it even if this run later fails or the tab reloads.
    setItineraries(prev => prev.map(it =>
      it.id === theme.id ? { ...it, batchId: ctx.batchId, jobId } : it));

    const applyFinalContent = (rawContent: string) => {
      const displayContent = stripPlanningSection(rawContent);
      const structuredData = parseStructuredItinerary(displayContent);
      setItineraries(prev => prev.map(it =>
        it.id === theme.id ? { ...it, content: displayContent, structuredData } : it));
    };

    setLoadingVariants(prev => ({ ...prev, [theme.id]: true }));

    let recoverable = false;
    let error: unknown;

    try {
      const { content, complete } = await generateSingleItinerary(ctx.preferences, theme, (updatedContent) => {
        const displayContent = stripPlanningSection(updatedContent);
        setItineraries(prev => prev.map(it =>
          it.id === theme.id ? { ...it, content: displayContent } : it));
      }, { jobId, batchId: ctx.batchId },
      resumeBatchId ? { completeBatchId: resumeBatchId, jobId } : undefined);

      // A stream cut short leaves nothing to show — often literally nothing.
      // Don't call that a success; the server finished and saved the result
      // regardless, so recover it below.
      if (complete && stripPlanningSection(content).trim()) {
        if (isStale()) return { ok: false, stillPending: false };
        applyFinalContent(content);
        setLoadingVariants(prev => ({ ...prev, [theme.id]: false }));
        removePendingJob(ctx.batchId, theme.id);
        return { ok: true, stillPending: false };
      }
      recoverable = true;
    } catch (err) {
      console.error(`Error generating ${theme.id}:`, err);
      error = err;
      // A refused request never produces a job to poll, so there is nothing to
      // recover and no reason to keep the spinner or the batch entry alive.
      recoverable = !(err as { serverRejected?: boolean })?.serverRejected;
    }

    if (isStale()) return { ok: false, stillPending: false, error };

    if (!recoverable) {
      setLoadingVariants(prev => ({ ...prev, [theme.id]: false }));
      removePendingJob(ctx.batchId, theme.id);
      return { ok: false, stillPending: false, error };
    }

    setIsReconnecting(true);
    const result = await pollJobContent(jobId, isStale);
    if (isStale()) return { ok: false, stillPending: false, error };
    setIsReconnecting(false);

    if (result.status === 'complete') applyFinalContent(result.content);
    setLoadingVariants(prev => ({ ...prev, [theme.id]: false }));

    // Only a genuine timeout leaves work the server may still finish; keep that
    // job so a later load can reconnect to it, and drop everything else.
    const stillPending = result.status === 'timeout';
    if (!stillPending) removePendingJob(ctx.batchId, theme.id);

    return { ok: result.status === 'complete', stillPending, error };
  }, [generateSingleItinerary]);

  // One generation at a time. Three variants running concurrently share the
  // same Perplexity and Anthropic rate limits, and in production they starved
  // each other past the edge function's 150s wall clock: 21 simultaneous
  // search calls pushed one variant's research from ~30s to ~114s, another's
  // plan pass from ~79s to ~96s, and both were killed mid-generation while the
  // third — the one that won the race for throughput — finished first. The
  // traveler can only watch one variant anyway, so the others wait their turn,
  // with their loading flag set immediately so the loading scene shows while
  // queued.
  const generationChainRef = useRef<Promise<unknown>>(Promise.resolve());
  const enqueueVariant = useCallback((
    theme: { id: string; name: string; emoji: string },
    ctx: GenerationContext,
    resumeBatchId?: string,
  ): Promise<{ ok: boolean; stillPending: boolean; error?: unknown }> => {
    setLoadingVariants(prev => ({ ...prev, [theme.id]: true }));
    const run = generationChainRef.current.then(() => {
      // The queue outlives any single trip: a variant enqueued before a
      // regenerate or reset should not run against the old context.
      if (runIdRef.current !== ctx.runId) {
        setLoadingVariants(prev => ({ ...prev, [theme.id]: false }));
        return { ok: false, stillPending: false };
      }
      return runVariant(theme, ctx, resumeBatchId);
    });
    // Failures propagate to the caller, not down the chain to the next variant.
    generationChainRef.current = run.then(() => undefined, () => undefined);
    return run;
  }, [runVariant]);

  // A rebuilt context (the ref died with a reload) keeps the trip's original
  // batch when the variants carry one — minting a fresh batch here would
  // orphan the batch an unlock has to name, and would make the server treat a
  // retried variant as a new trip.
  const rebuildContextFromVariants = useCallback((): GenerationContext => {
    const batchId = itineraries.find(it => it.batchId)?.batchId ?? crypto.randomUUID();
    const jobIdByTheme: Record<string, string> = {};
    for (const it of itineraries) {
      if (it.jobId) jobIdByTheme[it.id] = it.jobId;
    }
    return { preferences, batchId, jobIdByTheme, runId: runIdRef.current };
  }, [itineraries, preferences]);

  // ── Unlock (preview → paid trip) ───────────────────────────────────────────
  const [showUnlockDialog, setShowUnlockDialog] = useState(false);
  const [unlockLoading, setUnlockLoading] = useState(false);

  // ── Paywall (purchaser out of credits) ─────────────────────────────────────
  const [showPaywall, setShowPaywall] = useState(false);
  const [paywallLoadingPack, setPaywallLoadingPack] = useState<CreditPack | null>(null);

  const handlePaywallPurchase = useCallback(async (pack: CreditPack) => {
    setPaywallLoadingPack(pack);
    try {
      await startCheckout(pack);
      // Navigating to Stripe — leave the spinner up.
    } catch (err) {
      setPaywallLoadingPack(null);
      toast({
        title: "Couldn't start checkout",
        description: err instanceof Error ? err.message : "Please try again",
        variant: "destructive",
      });
    }
  }, []);

  // Finish generating every opened variant that still has locked content —
  // the server writes only the missing days per variant. Runs through the
  // same serialized queue as normal generations. A variant whose banked state
  // is gone (409) falls back to a full regeneration, free under the now-
  // entitled batch.
  const resumeLockedVariants = useCallback(() => {
    const ctx = generationContextRef.current ?? rebuildContextFromVariants();
    generationContextRef.current = ctx;
    for (const variant of itineraries) {
      if (!variant.structuredData?.access || !variant.batchId || !variant.jobId) continue;
      const theme = { id: variant.id, name: variant.name, emoji: variant.emoji };
      void enqueueVariant(theme, ctx, variant.batchId).then(result => {
        if (result.ok || runIdRef.current !== ctx.runId) return;
        const message = result.error instanceof Error ? result.error.message : "";
        if (message === "resume_unavailable") {
          startedVariantsRef.current.delete(variant.id);
          setItineraries(prev => prev.map(it =>
            it.id === variant.id ? { ...it, content: "", structuredData: undefined } : it));
          delete ctx.jobIdByTheme[variant.id];
          void enqueueVariant(theme, ctx);
          return;
        }
        toast({
          title: `Couldn't finish ${variant.name}`,
          description: "Your trip is unlocked — use the retry button to fill in the rest.",
          variant: "destructive",
        });
      });
    }
  }, [itineraries, enqueueVariant, rebuildContextFromVariants]);

  // Once an unlock has filled every variant in (no access markers remain),
  // refresh the trip's saved row so Saved trips reopens the content the user
  // paid for, not the redacted preview it stored before the purchase.
  const hadLockedContentRef = useRef(false);
  useEffect(() => {
    const hasLocked = itineraries.some(it => it.structuredData?.access);
    if (hasLocked) { hadLockedContentRef.current = true; return; }
    if (!hadLockedContentRef.current) return;
    hadLockedContentRef.current = false;
    if (!savedTripIdRef.current || !user || itineraries.every(it => !it.content)) return;
    void supabase.from('saved_trips').update({
      variants: itineraries as unknown as Json,
      preferences: preferences as unknown as Json,
    }).eq('id', savedTripIdRef.current);
  }, [itineraries, user, preferences]);

  // A locked-content tap on an already-unlocked trip (e.g. the resume failed
  // or the purchase landed on another tab) re-runs the resume instead of
  // asking for money again.
  const handleUnlockRequest = useCallback(() => {
    const batchId = itineraries.find(it => it.batchId)?.batchId;
    if (batchId && entitlements.entitledBatches.has(batchId)) {
      toast({ title: "Finishing your trip...", description: "Filling in the locked days now." });
      resumeLockedVariants();
      return;
    }
    setShowUnlockDialog(true);
  }, [itineraries, entitlements.entitledBatches, resumeLockedVariants]);

  // The $5 starter pack unlocks the batch the current trip was generated
  // under. Signed out: queue the purchase and sign in first — the resume
  // effect above sends the user straight to Stripe afterwards.
  const handleUnlockPurchase = useCallback(async () => {
    const unlockBatchId = itineraries.find(it => it.batchId)?.batchId;
    if (!user) {
      clearPendingAuthAction();
      savePendingCheckout({ pack: 'pack_2', unlockBatchId });
      setShowUnlockDialog(false);
      authInitiatedRef.current = false;
      setShowAuthModal(true);
      return;
    }
    setUnlockLoading(true);
    try {
      await startCheckout('pack_2', unlockBatchId);
      // The browser is navigating to Stripe — leave the spinner up.
    } catch (err) {
      setUnlockLoading(false);
      toast({
        title: "Couldn't start checkout",
        description: err instanceof Error ? err.message : "Please try again",
        variant: "destructive",
      });
    }
  }, [user, itineraries]);

  // ── Checkout return ────────────────────────────────────────────────────────
  // Capture ?checkout=…&session_id=… once and strip it from the URL so a
  // reload can't replay the confirmation.
  const checkoutReturnRef = useRef<{ status: string; sessionId: string | null } | null>(null);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const status = params.get('checkout');
    if (!status) return;
    checkoutReturnRef.current = { status, sessionId: params.get('session_id') };
    params.delete('checkout');
    params.delete('session_id');
    const rest = params.toString();
    window.history.replaceState({}, '', window.location.pathname + (rest ? `?${rest}` : ''));
    if (status === 'cancelled') {
      checkoutReturnRef.current = null;
      toast({ title: "No charge", description: "Your trip is right where you left it." });
    }
  }, []);

  // Confirm the purchase once the auth session has restored (the redirect
  // lands before Supabase has rehydrated the user). waitForPurchase polls for
  // the webhook and falls back to confirming with Stripe directly.
  useEffect(() => {
    const pending = checkoutReturnRef.current;
    if (!pending || pending.status !== 'success' || !pending.sessionId || !user) return;
    checkoutReturnRef.current = null;
    const sessionId = pending.sessionId;
    (async () => {
      setShowUnlockDialog(false);
      toast({ title: "Confirming your purchase..." });
      const applied = await waitForPurchase(sessionId);
      if (!applied) {
        toast({
          title: "Payment is still processing",
          description: "Your card was charged only if Stripe shows the payment as complete. Reload in a moment — your credits will be here.",
          variant: "destructive",
        });
        return;
      }
      await entitlements.refresh();
      const hasLocked = itineraries.some(it => it.structuredData?.access);
      toast({
        title: hasLocked ? "Trip unlocked!" : "Purchase complete!",
        description: hasLocked
          ? "Filling in the rest of your trip now — plus 1 more full trip on your account."
          : "Your trip credits are ready.",
      });
      if (hasLocked) resumeLockedVariants();
    })();
  }, [user, entitlements, itineraries, resumeLockedVariants]);

  // Opening a variant that hasn't been generated yet starts it.
  // A variant whose stream was cut off is otherwise stuck: its partial content
  // passes the "already has content" guard and its id is in startedVariants, so
  // re-clicking the tab does nothing and the error card's advice to regenerate
  // had no button. This clears both gates and queues a fresh run.
  const handleRetryVariant = useCallback(() => {
    const theme = itineraries[activeVariant];
    if (!theme || loadingVariants[theme.id]) return;
    startedVariantsRef.current.delete(theme.id);
    setItineraries(prev => prev.map(it =>
      it.id === theme.id ? { ...it, content: "", structuredData: undefined } : it));

    const ctx: GenerationContext = generationContextRef.current ?? rebuildContextFromVariants();
    generationContextRef.current = ctx;
    // A fresh job id: the old one belongs to the run that died.
    delete ctx.jobIdByTheme[theme.id];

    void enqueueVariant(theme, ctx).then(result => {
      if (result.ok) {
        notifyVariantReady(theme, destinationRef.current);
      } else if (runIdRef.current === ctx.runId) {
        toast({
          title: `Couldn't rebuild ${theme.name}`,
          description: "Please try again in a moment.",
          variant: "destructive",
        });
      }
    });
  }, [itineraries, activeVariant, loadingVariants, enqueueVariant, rebuildContextFromVariants]);

  const handleSelectVariant = useCallback((index: number) => {
    setActiveVariant(index);
    const theme = itineraries[index];
    if (!theme || theme.content || startedVariantsRef.current.has(theme.id)) return;

    // After a reload the original context is gone, but a variant only needs the
    // preferences and a fresh job id — so rebuild rather than refusing to run.
    const ctx: GenerationContext = generationContextRef.current ?? rebuildContextFromVariants();
    generationContextRef.current = ctx;

    void enqueueVariant(theme, ctx).then(result => {
      if (result.ok) {
        notifyVariantReady(theme, destinationRef.current);
        return;
      }
      if (runIdRef.current !== ctx.runId) return;
      toast({
        title: `Couldn't load ${theme.name}`,
        description: result.error instanceof Error
          ? result.error.message
          : result.stillPending
            ? "It didn't come through — reload to pick it up, or try again"
            : "Please try again",
        variant: "destructive",
      });
    });
  }, [itineraries, enqueueVariant, rebuildContextFromVariants]);

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

    // No client-side paywall pre-check here on purpose: only the server knows
    // whether the paywall is switched on, and a purchaser must generate
    // normally with PAYWALL=off. An out-of-credits purchaser costs one cheap
    // themes call before the server's 402 routes them to the paywall below.

    // Supersede any in-flight reconnect from a previous session.
    const runId = ++runIdRef.current;
    const isStale = () => runIdRef.current !== runId;
    setIsReconnecting(false);

    setIsGenerating(true);
    setItineraries([]);
    setActiveVariant(0);
    setIsSaved(false);
    savedTripIdRef.current = null; // a fresh trip gets a fresh saved_trips row
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
      if (themes.length === 0) throw new Error("No themes came back for this trip — try adding more detail");
      setIsSuggestingThemes(false);
      setItineraries(themes.map(t => ({ ...t, content: "" })));
      setLoadingVariants({});

      // Generate only the first variant now. Producing all three up front meant
      // waiting on the slowest of three long generations before seeing anything,
      // and two of them were usually never opened. The rest start when the user
      // actually switches to them.
      const ctx: GenerationContext = {
        preferences: effectivePreferences,
        batchId: crypto.randomUUID(),
        jobIdByTheme: {},
        runId,
      };
      generationContextRef.current = ctx;
      startedVariantsRef.current = new Set();

      const result = await enqueueVariant(themes[0], ctx);
      if (isStale()) return; // a newer generation took over while we streamed

      if (result.ok) {
        notifyVariantReady(themes[0], destinationRef.current);
        toast({
          title: `${themes[0].emoji} ${themes[0].name} is ready!`,
          description: themes.length > 1
            ? "Tap another theme to build a different version of the trip"
            : "Explore your trip below",
        });
      } else if (result.error instanceof Error && result.error.message === 'payment_required') {
        // Stale client state slipped past the pre-check — the server said pay.
        setView('input');
        setShowPaywall(true);
      } else {
        toast({
          title: "Couldn't load your itinerary",
          description: result.error instanceof Error
            ? result.error.message
            : result.stillPending
              ? "The connection dropped before it arrived. Please try again."
              : "Please try again.",
          variant: "destructive",
        });
      }
    } catch (error) {
      if (isStale()) return;
      console.error("Error in generation flow:", error);
      toast({ title: "Something went wrong", description: error instanceof Error ? error.message : "Please try again later", variant: "destructive" });
    } finally {
      // A newer run owns these flags now — leave them alone.
      if (!isStale()) {
        setIsGenerating(false);
        setIsReconnecting(false);
        setIsSuggestingThemes(false);
        setIsAnalyzingMedia(false);
      }
    }
  }, [preferences, suggestThemes, enqueueVariant, analyzeInspiration]);

  const handleEdit = useCallback(async (editRequest: string) => {
    const current = itineraries[activeVariant];
    if (!current) return;
    toast({ title: "Processing your changes...", description: "Updating the itinerary based on your request" });
    setLoadingVariants(prev => ({ ...prev, [current.id]: true }));
    try {
      const response = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/edit-itinerary`, {
        method: "POST", headers: await getHeaders(),
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
        <AuthModal
          open={showAuthModal}
          onOpenChange={handleAuthModalOpenChange}
          onSignInStart={() => { authInitiatedRef.current = true; }}
        />
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
                <ItinerarySwitcher variants={itineraries} activeIndex={activeVariant} onSelect={handleSelectVariant} loadingVariants={loadingVariants} />
              </div>
            )}

            {/* Summary card — markdown fallback only */}
            {currentItinerary?.content && !loadingVariants[currentItinerary.id] && !currentItinerary.structuredData && (
              <TripSummaryCard data={currentItinerary.structuredData} departureCity={preferences.departureCity} startDate={preferences.startDate} endDate={preferences.endDate} durationDays={preferences.durationDays} />
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
                    isLoading={(isGenerating || !!(currentItinerary && loadingVariants[currentItinerary.id])) && !currentItinerary?.content}
                    loadingHeadline={
                      isAnalyzingMedia
                        ? "Reading your inspiration photos…"
                        : isSuggestingThemes
                          ? "Dreaming up trip themes…"
                          : undefined
                    }
                    isStreaming={!!(currentItinerary?.content && loadingVariants[currentItinerary?.id])}
                    isEditing={currentItinerary ? loadingVariants[currentItinerary.id] && !isGenerating : false}
                    onRetry={handleRetryVariant}
                    onEdit={handleEdit}
                    themeTitle={currentItinerary ? `${currentItinerary.emoji} ${currentItinerary.name}` : undefined}
                    tripPreferences={preferences}
                    onUnlockRequest={handleUnlockRequest}
                  />
                </div>
              </div>
            )}
          </div>
        </main>
        <AuthModal
          open={showAuthModal}
          onOpenChange={handleAuthModalOpenChange}
          onSignInStart={() => { authInitiatedRef.current = true; }}
        />
        <UnlockDialog
          open={showUnlockDialog}
          onOpenChange={setShowUnlockDialog}
          onUnlock={handleUnlockPurchase}
          loading={unlockLoading}
        />
        <PaywallModal
          open={showPaywall}
          onOpenChange={setShowPaywall}
          onPurchase={handlePaywallPurchase}
          loadingPack={paywallLoadingPack}
        />
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
              onClick={handleViewSavedTrips}
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

      <AuthModal
        open={showAuthModal}
        onOpenChange={handleAuthModalOpenChange}
        onSignInStart={() => { authInitiatedRef.current = true; }}
      />
      <PaywallModal
        open={showPaywall}
        onOpenChange={setShowPaywall}
        onPurchase={handlePaywallPurchase}
        loadingPack={paywallLoadingPack}
      />
    </div>
  );
};

export default Index;
