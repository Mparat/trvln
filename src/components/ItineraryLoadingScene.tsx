import { useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { cn } from "@/lib/utils";
import { usePrefersReducedMotion } from "@/hooks/use-reduced-motion";
import { NotifyWhenReadyButton } from "./NotifyWhenReadyButton";

// The "text me when it's ready" CTA ships dark until the Twilio number clears
// A2P registration — set VITE_ENABLE_READY_TEXTS=true to turn it on.
const READY_TEXTS_ENABLED = import.meta.env.VITE_ENABLE_READY_TEXTS === 'true';

/**
 * A hand-drawn stick figure walking through the trip you're waiting on: the
 * scenery, the thing in their hand, and the status lines are all picked from
 * the itinerary's theme and destination, so each of the three variants gets a
 * visibly different walk.
 */

// ── Scene selection ─────────────────────────────────────────────────────────

type SceneKey = 'water' | 'mountain' | 'vineyard' | 'food' | 'city' | 'forest' | 'desert' | 'explore';

// Order matters only for ties — a theme that reads as both (Lakeside Romance &
// Trails) resolves on which side has more evidence, including its emoji.
const SCENE_HINTS: { key: SceneKey; words: string[]; emoji: string[] }[] = [
  {
    key: 'water',
    words: ['lake', 'lakeside', 'canoe', 'kayak', 'paddle', 'beach', 'coast', 'coastal', 'island', 'sail', 'surf', 'sea', 'ocean', 'river', 'harbour', 'harbor', 'marina', 'reef', 'shore', 'fjord', 'lagoon', 'bay', 'waterfall', 'boat', 'cruise'],
    emoji: ['🛶', '🚣', '🏖', '🏝', '🌊', '⛵', '🚤', '🐚', '🏊', '🤿', '🐠'],
  },
  {
    key: 'mountain',
    words: ['alpine', 'mountain', 'peak', 'summit', 'hike', 'hiking', 'trail', 'trek', 'ski', 'snow', 'glacier', 'foothill', 'climb', 'ridge', 'valley', 'dolomite', 'alps', 'highland'],
    emoji: ['🏔', '⛰', '🗻', '🥾', '🎿', '🏂', '🧗'],
  },
  {
    key: 'vineyard',
    words: ['vineyard', 'wine', 'winery', 'grape', 'cellar', 'vino', 'champagne', 'tasting'],
    emoji: ['🍇', '🍷', '🥂', '🍾'],
  },
  {
    key: 'food',
    words: ['food', 'flavor', 'flavour', 'culinary', 'gastronom', 'taste', 'foodie', 'market', 'bakery', 'kitchen', 'feast', 'street eats', 'coffee', 'cafe', 'café'],
    emoji: ['🍽', '🥐', '🍜', '🍲', '🥘', '🧀', '☕', '🍝', '🌮'],
  },
  {
    key: 'city',
    words: ['city', 'urban', 'metro', 'downtown', 'nightlife', 'museum', 'gallery', 'design', 'architecture', 'capital', 'rooftop', 'neighborhood', 'neighbourhood'],
    emoji: ['🏙', '🌆', '🌃', '🎨', '🏛', '🎭', '🕌'],
  },
  {
    key: 'forest',
    words: ['forest', 'jungle', 'wild', 'wilderness', 'safari', 'nature', 'national park', 'woods', 'camp', 'rainforest'],
    emoji: ['🌲', '🌳', '🏕', '🦌', '🦁', '🐘', '🍃'],
  },
  {
    key: 'desert',
    words: ['desert', 'dune', 'sahara', 'oasis', 'canyon', 'outback', 'arid'],
    emoji: ['🐪', '🌵', '🏜'],
  },
];

const detectScene = (text: string): SceneKey => {
  const haystack = text.toLowerCase();
  let best: SceneKey = 'explore';
  let bestScore = 0;

  for (const hint of SCENE_HINTS) {
    const words = hint.words.reduce((n, word) => n + (haystack.includes(word) ? 1 : 0), 0);
    // An emoji is a deliberate label for the theme, so it counts for more than
    // a word that happened to land in the title.
    const emoji = hint.emoji.reduce((n, glyph) => n + (text.includes(glyph) ? 2 : 0), 0);
    const score = words + emoji;
    if (score > bestScore) {
      bestScore = score;
      best = hint.key;
    }
  }

  return best;
};

// ── Drawing helpers ─────────────────────────────────────────────────────────

const GROUND_Y = 138;
// Distant props sit a hair above the ground line and drift slower — enough
// parallax to read as depth without a second horizon competing with the first.
const FAR_Y = 136;
const TILE = 320;
// A shallow arc high in the sky, so it clears the walker's hat on the way past.
const ROUTE_PATH = "M8 58 Q 160 10 312 50";
const PLANE = "M-9 -5 L9 0 L-9 5 L-5 0 Z";

type ShapeProps = { x: number; y?: number; s?: number };

const At = ({ x, y = 0, s = 1, children }: ShapeProps & { children: ReactNode }) => (
  <g transform={`translate(${x} ${y})${s === 1 ? '' : ` scale(${s})`}`}>{children}</g>
);

const Pine = (p: ShapeProps) => (
  <At {...p}>
    <path d="M0 0 v-6" />
    <path d="M-8 -6 L0 -21 L8 -6 Z" />
    <path d="M-6 -14 L0 -25 L6 -14" />
  </At>
);

const Tent = (p: ShapeProps) => (
  <At {...p}>
    <path d="M-14 0 L0 -18 L14 0 Z" />
    <path d="M0 -18 L-5 0" />
    <path d="M0 -18 L5 0" />
  </At>
);

const Campfire = (p: ShapeProps) => (
  <At {...p}>
    <path d="M-9 0 L9 -5" />
    <path d="M-9 -5 L9 0" />
    <path d="M0 -6 q-6 -6 -1 -12 q1 4 4 3 q3 6 -3 9" />
  </At>
);

const Signpost = (p: ShapeProps) => (
  <At {...p}>
    <path d="M0 0 v-26" />
    <path d="M0 -25 h12 l4 4 l-4 4 h-12 z" />
    <path d="M0 -15 h-12 l-4 4 l4 4 h12 z" />
  </At>
);

const Suitcase = (p: ShapeProps) => (
  <At {...p}>
    <path d="M-11 -14 h22 v14 h-22 z" />
    <path d="M-4 -14 v-4 h8 v4" />
    <path d="M-11 -8 h22" />
  </At>
);

const Cactus = (p: ShapeProps) => (
  <At {...p}>
    <path d="M0 0 v-26" />
    <path d="M0 -13 h-8 v-7" />
    <path d="M0 -18 h7 v-6" />
  </At>
);

const Rock = (p: ShapeProps) => (
  <At {...p}>
    <path d="M-9 0 q2 -8 8 -7 q7 1 6 7 z" />
  </At>
);

const Cairn = (p: ShapeProps) => (
  <At {...p}>
    <path d="M-8 0 q1 -6 8 -6 q7 0 8 6 z" />
    <path d="M-6 -6 q1 -5 6 -5 q5 0 6 5" />
    <path d="M-3 -11 q1 -4 3 -4 q3 0 3 4" />
  </At>
);

const Canoe = (p: ShapeProps) => (
  <At {...p}>
    <path d="M-17 -4 Q0 8 17 -4" />
    <path d="M-17 -4 h34" />
    <path d="M-13 -5 L4 -26" />
    <path d="M3 -27 q6 -3 8 3 q-5 5 -9 -1 z" />
  </At>
);

const Waves = (p: ShapeProps) => (
  <At {...p}>
    <path d="M-16 0 q4 -4 8 0 t8 0 t8 0 t8 0" />
    <path d="M-12 -6 q4 -4 8 0 t8 0 t8 0" />
  </At>
);

const Reeds = (p: ShapeProps) => (
  <At {...p}>
    <path d="M0 0 q-3 -11 -1 -19" />
    <path d="M-1 -19 q4 1 3 6 q-4 1 -3 -6" />
    <path d="M7 0 q1 -9 3 -14" />
    <path d="M10 -14 q4 1 3 5 q-4 1 -3 -5" />
    <path d="M-7 0 q-1 -7 -2 -11" />
  </At>
);

const Dock = (p: ShapeProps) => (
  <At {...p}>
    <path d="M-16 -7 h32" />
    <path d="M-12 -7 v7" />
    <path d="M0 -7 v7" />
    <path d="M12 -7 v7" />
  </At>
);

const VineRow = (p: ShapeProps) => (
  <At {...p}>
    <path d="M0 0 v-16" />
    <path d="M16 0 v-16" />
    <path d="M32 0 v-16" />
    <path d="M0 -12 q8 5 16 0 t16 0" />
    <path d="M0 -5 q8 5 16 0 t16 0" />
  </At>
);

const GrapeBunch = (p: ShapeProps) => (
  <At {...p}>
    <path d="M0 -22 v-4" />
    <path d="M0 -25 q7 -3 9 3 q-7 2 -9 -3" />
    <circle cx="-5" cy="-17" r="3.2" />
    <circle cx="1" cy="-18" r="3.2" />
    <circle cx="-2" cy="-11" r="3.2" />
    <circle cx="4" cy="-12" r="3.2" />
    <circle cx="0" cy="-5" r="3.2" />
  </At>
);

const Barrel = (p: ShapeProps) => (
  <At {...p}>
    <path d="M-9 0 q-3 -8 0 -16 h18 q3 8 0 16 z" />
    <path d="M-10 -11 h20" />
    <path d="M-10 -5 h20" />
  </At>
);

const CafeTable = (p: ShapeProps) => (
  <At {...p}>
    <path d="M-11 -13 h22" />
    <path d="M0 -13 v11" />
    <path d="M-7 -2 h14" />
    <path d="M2 -20 h8 v4 q0 4 -4 4 t-4 -4 z" />
    <path d="M5 -23 q2 -3 0 -5" />
    <path d="M-11 -13 l-4 13" />
    <path d="M-11 -20 v7" />
  </At>
);

const MarketStall = (p: ShapeProps) => (
  <At {...p}>
    <path d="M-16 -15 l3 -6 h26 l3 6 z" />
    <path d="M-14 -15 v15" />
    <path d="M14 -15 v15" />
    <path d="M-16 -5 h32" />
    <path d="M-8 -15 v10" />
    <path d="M0 -15 v10" />
    <path d="M8 -15 v10" />
  </At>
);

const FoodSign = (p: ShapeProps) => (
  <At {...p}>
    <path d="M0 0 v-16" />
    <path d="M-11 -30 h22 v14 h-22 z" />
    <path d="M-6 -27 v8" />
    <path d="M-8 -27 v3 h4 v-3" />
    <path d="M5 -27 q3 2 0 5 v3" />
  </At>
);

const StreetLamp = (p: ShapeProps) => (
  <At {...p}>
    <path d="M0 0 v-28" />
    <path d="M0 -28 q0 -5 7 -5" />
    <path d="M4 -33 h7 l-3.5 6 z" />
  </At>
);

const Bench = (p: ShapeProps) => (
  <At {...p}>
    <path d="M-13 -8 h26" />
    <path d="M-13 -14 h26" />
    <path d="M-10 -8 v8" />
    <path d="M10 -8 v8" />
    <path d="M-10 -14 v6" />
    <path d="M10 -14 v6" />
  </At>
);

const BusSign = (p: ShapeProps) => (
  <At {...p}>
    <path d="M0 0 v-22" />
    <path d="M-9 -34 h18 v12 h-18 z" />
    <path d="M-5 -31 h6 q3 0 3 3 t-3 3 h-6 z" />
  </At>
);

const Mushroom = (p: ShapeProps) => (
  <At {...p}>
    <path d="M-2 0 v-7" />
    <path d="M2 0 v-7" />
    <path d="M-8 -7 Q0 -17 8 -7 Z" />
  </At>
);

const Milestone = (p: ShapeProps) => (
  <At {...p}>
    <path d="M-7 0 v-9 q7 -7 14 0 v9 z" />
    <path d="M-5 -8 h10" />
    <path d="M-3 -4 h6" />
  </At>
);

const Peaks = (p: ShapeProps) => (
  <At {...p}>
    <path d="M0 0 L26 -34 L44 -13 L62 -30 L86 0" />
    <path d="M19 -25 l4 3 l3 -5 l4 6 l4 -3" />
  </At>
);

const Hills = (p: ShapeProps) => (
  <At {...p}>
    <path d="M0 0 Q 24 -20 48 -2 Q 68 -16 90 0" />
  </At>
);

const Dunes = (p: ShapeProps) => (
  <At {...p}>
    <path d="M0 0 Q 30 -18 62 -3 Q 84 4 108 0" />
  </At>
);

const Island = (p: ShapeProps) => (
  <At {...p}>
    <path d="M-18 0 Q0 -11 18 0 Z" />
    <path d="M2 -7 q1 -9 7 -13" />
    <path d="M9 -20 q-7 -3 -11 1" />
    <path d="M9 -20 q7 -3 11 1" />
    <path d="M9 -20 q-1 -7 -7 -9" />
  </At>
);

const Sailboat = (p: ShapeProps) => (
  <At {...p}>
    <path d="M-11 -2 Q0 6 11 -2 Z" />
    <path d="M0 -2 v-18" />
    <path d="M2 -19 L11 -3 L2 -3 Z" />
  </At>
);

const Villa = (p: ShapeProps) => (
  <At {...p}>
    <path d="M-9 0 v-12 h18 v12 z" />
    <path d="M-13 -12 L0 -21 L13 -12" />
    <path d="M-3 -9 h6 v6 h-6 z" />
  </At>
);

const Building = ({ h = 30, w = 18, ...p }: ShapeProps & { h?: number; w?: number }) => (
  <At {...p}>
    <path d={`M${-w / 2} 0 v${-h} h${w} v${h}`} />
    <path d={`M${-w / 2 + 3} ${-h + 7} h${w - 6}`} />
    <path d={`M${-w / 2 + 3} ${-h + 15} h${w - 6}`} />
  </At>
);

const Cloud = (p: ShapeProps) => (
  <At {...p}>
    <path d="M-16 4 A8 8 0 0 1 -8 -6 A11 11 0 0 1 12 -6 A7 7 0 0 1 16 4 Z" />
  </At>
);

// ── Scenery per theme ───────────────────────────────────────────────────────

const NEAR_PROPS: Record<SceneKey, ReactNode> = {
  water: (
    <>
      <Canoe x={34} y={GROUND_Y} />
      <Waves x={124} y={GROUND_Y} />
      <Reeds x={206} y={GROUND_Y} />
      <Dock x={282} y={GROUND_Y} />
    </>
  ),
  mountain: (
    <>
      <Pine x={26} y={GROUND_Y} s={1.1} />
      <Signpost x={128} y={GROUND_Y} />
      <Tent x={224} y={GROUND_Y} />
      <Rock x={292} y={GROUND_Y} />
    </>
  ),
  vineyard: (
    <>
      <VineRow x={18} y={GROUND_Y} />
      <GrapeBunch x={142} y={GROUND_Y} />
      <Barrel x={224} y={GROUND_Y} />
      <VineRow x={274} y={GROUND_Y} s={0.9} />
    </>
  ),
  food: (
    <>
      <CafeTable x={34} y={GROUND_Y} />
      <MarketStall x={146} y={GROUND_Y} />
      <FoodSign x={252} y={GROUND_Y} />
    </>
  ),
  city: (
    <>
      <StreetLamp x={30} y={GROUND_Y} />
      <Bench x={132} y={GROUND_Y} />
      <BusSign x={232} y={GROUND_Y} />
      <Bench x={300} y={GROUND_Y} s={0.85} />
    </>
  ),
  forest: (
    <>
      <Tent x={32} y={GROUND_Y} />
      <Campfire x={112} y={GROUND_Y} />
      <Pine x={202} y={GROUND_Y} s={1.2} />
      <Mushroom x={280} y={GROUND_Y} />
    </>
  ),
  desert: (
    <>
      <Cactus x={32} y={GROUND_Y} />
      <Cairn x={142} y={GROUND_Y} />
      <Cactus x={238} y={GROUND_Y} s={0.8} />
      <Rock x={298} y={GROUND_Y} />
    </>
  ),
  explore: (
    <>
      <Signpost x={30} y={GROUND_Y} />
      <Suitcase x={140} y={GROUND_Y} />
      <Milestone x={236} y={GROUND_Y} />
      <Pine x={300} y={GROUND_Y} s={0.9} />
    </>
  ),
};

const FAR_PROPS: Record<SceneKey, ReactNode> = {
  water: (
    <>
      <Island x={44} y={FAR_Y} />
      <Sailboat x={158} y={FAR_Y} />
      <Island x={248} y={FAR_Y} s={0.7} />
    </>
  ),
  mountain: (
    <>
      <Peaks x={8} y={FAR_Y} s={1.1} />
      <Peaks x={150} y={FAR_Y} s={0.85} />
      <Pine x={252} y={FAR_Y} s={0.7} />
      <Pine x={272} y={FAR_Y} s={0.55} />
    </>
  ),
  vineyard: (
    <>
      <Hills x={6} y={FAR_Y} />
      <Villa x={132} y={FAR_Y} />
      <Hills x={186} y={FAR_Y} s={0.9} />
    </>
  ),
  food: (
    <>
      <Hills x={10} y={FAR_Y} />
      <Villa x={130} y={FAR_Y} s={0.85} />
      <Villa x={168} y={FAR_Y} />
      <Hills x={210} y={FAR_Y} s={0.95} />
    </>
  ),
  city: (
    <>
      <Building x={30} y={FAR_Y} h={34} w={18} />
      <Building x={56} y={FAR_Y} h={22} w={16} />
      <Building x={82} y={FAR_Y} h={42} w={14} />
      <Building x={150} y={FAR_Y} h={26} w={20} />
      <Building x={178} y={FAR_Y} h={38} w={16} />
      <Building x={252} y={FAR_Y} h={30} w={18} />
      <Building x={278} y={FAR_Y} h={20} w={14} />
    </>
  ),
  forest: (
    <>
      <Pine x={16} y={FAR_Y} s={0.8} />
      <Pine x={44} y={FAR_Y} s={1} />
      <Pine x={72} y={FAR_Y} s={0.7} />
      <Pine x={150} y={FAR_Y} s={0.9} />
      <Pine x={176} y={FAR_Y} s={0.65} />
      <Pine x={248} y={FAR_Y} s={1} />
      <Pine x={276} y={FAR_Y} s={0.75} />
    </>
  ),
  desert: (
    <>
      <Dunes x={4} y={FAR_Y} />
      <Dunes x={150} y={FAR_Y} s={0.9} />
      <Cactus x={268} y={FAR_Y} s={0.6} />
    </>
  ),
  explore: (
    <>
      <Hills x={8} y={FAR_Y} />
      <Peaks x={112} y={FAR_Y} s={0.6} />
      <Hills x={196} y={FAR_Y} s={0.9} />
    </>
  ),
};

// Something in the walker's front hand, so the figure belongs to the trip too.
// Everything here hangs off the hand at (62, 104) and rotates with the arm.
const HAND_ITEMS: Record<SceneKey, ReactNode> = {
  water: (
    <>
      <path d="M57 90 L71 124" />
      <path d="M71 122 q6 2 4 8 q-6 1 -7 -5 z" />
    </>
  ),
  mountain: <path d="M62 104 L69 138" />,
  vineyard: (
    <>
      <path d="M56 92 q6 10 12 0 z" />
      <path d="M62 102 v5" />
      <path d="M57 107 h10" />
    </>
  ),
  food: (
    <>
      <path d="M57 106 L62 118 L67 106 z" />
      <circle cx="59.5" cy="103" r="3.2" />
      <circle cx="64.5" cy="103" r="3.2" />
    </>
  ),
  city: (
    <>
      <path d="M54 100 h16 v11 h-16 z" />
      <circle cx="62" cy="105.5" r="3.4" />
      <path d="M56 100 v-3 h4 v3" />
    </>
  ),
  forest: (
    <>
      <path d="M57 104 h10 v11 h-10 z" />
      <path d="M58 104 q4 -7 8 0" />
      <path d="M60 107 h4 v4 h-4 z" />
    </>
  ),
  desert: (
    <>
      <path d="M57 103 h10 v13 h-10 z" />
      <path d="M60 103 v-3 h4 v3" />
    </>
  ),
  explore: (
    <>
      <path d="M53 101 l9 -4 l9 4 v10 l-9 4 l-9 -4 z" />
      <path d="M62 97 v14" />
      <path d="M56 104 q4 3 9 0" />
    </>
  ),
};

// ── Status lines ────────────────────────────────────────────────────────────

const THEME_LINES: Record<SceneKey, string[]> = {
  water: ["Finding the quiet stretch of shoreline…", "Checking which boats actually run…"],
  mountain: ["Counting the switchbacks…", "Picking trails you'll actually finish…"],
  vineyard: ["Sniffing out the small producers…", "Booking a tasting that isn't a bus tour…"],
  food: ["Ranking the bakeries…", "Finding the place with the queue out front…"],
  city: ["Mapping the walkable bits…", "Skipping the tourist-trap blocks…"],
  forest: ["Looking for the trailhead…", "Checking where the good campsites are…"],
  desert: ["Timing it around the midday heat…", "Finding shade worth stopping for…"],
  explore: ["Following a hunch…", "Chasing down the good detours…"],
};

const buildLines = (scene: SceneKey, destination: string): string[] => {
  const [themeA, themeB] = THEME_LINES[scene];
  const where = destination ? ` through ${destination}` : '';
  return [
    `Sketching a route${where}…`,
    themeA,
    "Asking around for where locals actually eat…",
    "Pinning hidden gems to the map…",
    themeB,
    "Checking what's shut on a Monday…",
    "Working out how you get from A to B…",
    "Penciling in time to do nothing…",
  ];
};

// ── Component ───────────────────────────────────────────────────────────────

interface ItineraryLoadingSceneProps {
  /** Theme label, e.g. "🛶 Lakeside Romance & Trails". Drives the scenery. */
  themeTitle?: string;
  /** Where the trip goes, used in the status lines and scene pick. */
  destination?: string;
  headline?: string;
  className?: string;
}

export function ItineraryLoadingScene({
  themeTitle,
  destination,
  headline,
  className,
}: ItineraryLoadingSceneProps) {
  const prefersReducedMotion = usePrefersReducedMotion();
  // The plane follows the route by id, so the pair has to be unique per instance.
  const routeId = `doodle-route-${useId().replace(/:/g, '')}`;

  const scene = useMemo(
    () => detectScene(`${themeTitle ?? ''} ${destination ?? ''}`),
    [themeTitle, destination]
  );

  const lines = useMemo(() => buildLines(scene, destination ?? ''), [scene, destination]);
  const [lineIndex, setLineIndex] = useState(0);

  useEffect(() => {
    setLineIndex(0);
    const timer = window.setInterval(() => {
      setLineIndex(prev => (prev + 1) % lines.length);
    }, 3200);
    return () => window.clearInterval(timer);
  }, [lines]);

  const near = NEAR_PROPS[scene];
  const far = FAR_PROPS[scene];

  return (
    <div className={cn("flex flex-col items-center gap-5 py-8 text-center", className)}>
      <svg
        viewBox="0 0 320 170"
        role="img"
        aria-label="A stick figure walking through the landscape while your itinerary is written"
        className="doodle-scene w-full max-w-[460px] h-auto"
        fill="none"
        stroke="currentColor"
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        {/* Sky */}
        <g className="text-primary/35" stroke="currentColor">
          <circle cx="284" cy="22" r="8.5" />
          <g
            className="doodle-spin"
            style={{ transformOrigin: '284px 22px' }}
          >
            {[0, 45, 90, 135, 180, 225, 270, 315].map(angle => (
              <path
                key={angle}
                d="M284 9 v-4"
                transform={`rotate(${angle} 284 22)`}
              />
            ))}
          </g>
          <g className="doodle-cloud" style={{ animationDelay: '-4s' }}>
            <Cloud x={0} y={30} s={0.9} />
          </g>
          <g className="doodle-cloud" style={{ animationDelay: '-17s', animationDuration: '34s' }}>
            <Cloud x={0} y={68} s={0.65} />
          </g>
        </g>

        {/* The route being drawn, with a little plane riding it */}
        <g className="text-primary">
          <path id={routeId} className="doodle-route" d={ROUTE_PATH} />
          {prefersReducedMotion ? (
            <path d={PLANE} strokeWidth={1.8} transform="translate(312 50) rotate(18)" />
          ) : (
            <path d={PLANE} strokeWidth={1.8}>
              <animateMotion dur="7s" rotate="auto" repeatCount="indefinite">
                {/* href is SVG 2; xlink:href keeps older Safari happy */}
                <mpath href={`#${routeId}`} xlinkHref={`#${routeId}`} />
              </animateMotion>
            </path>
          )}
        </g>

        {/* Distant scenery, drifting slowly */}
        <g className="doodle-far text-foreground/20">
          <g>{far}</g>
          <g transform={`translate(${TILE} 0)`}>{far}</g>
        </g>

        {/* Foreground scenery, drifting past */}
        <g className="doodle-near text-foreground/45">
          <g>{near}</g>
          <g transform={`translate(${TILE} 0)`}>{near}</g>
        </g>

        {/* Ground */}
        <g className="text-foreground/30">
          <path d={`M0 ${GROUND_Y} h320`} />
          <g className="doodle-near">
            <path
              className="doodle-ground"
              d={`M0 ${GROUND_Y + 7} h640`}
              strokeWidth={1.6}
            />
          </g>
        </g>

        {/* The traveller. Hip (62,104), shoulder (62,84), hand at rest (62,104). */}
        <g className="doodle-walker text-primary">
          {/* back leg + arm sit behind the body */}
          <g className="doodle-leg-b" style={{ transformOrigin: '62px 104px' }}>
            <path d="M62 104 v34" strokeWidth={1.8} opacity={0.55} />
          </g>
          <g className="doodle-arm-a" style={{ transformOrigin: '62px 84px' }}>
            <path d="M62 84 L62 104" strokeWidth={1.8} opacity={0.55} />
          </g>

          {/* pack, body, head, sun hat */}
          <path d="M50 86 h11 v17 h-11 q-3 -8 0 -17 z" strokeWidth={1.8} />
          <path d="M50 93 h11" strokeWidth={1.5} />
          <path d="M62 104 V83" />
          <circle cx="62" cy="74" r="8.5" />
          <path d="M51 64 h22" />
          <path d="M55 64 Q62 53 69 64" />

          {/* front leg + arm, carrying the themed prop */}
          <g className="doodle-leg-a" style={{ transformOrigin: '62px 104px' }}>
            <path d="M62 104 v34" />
          </g>
          <g className="doodle-arm-b" style={{ transformOrigin: '62px 84px' }}>
            <path d="M62 84 L62 104" />
            {HAND_ITEMS[scene]}
          </g>
        </g>
      </svg>

      <div className="space-y-1.5">
        <p className="font-semibold text-foreground">
          {headline ?? "Drawing up your itinerary…"}
        </p>
        <p key={lineIndex} className="text-sm text-muted-foreground animate-fade-in min-h-[20px]">
          {lines[lineIndex]}
        </p>
      </div>

      {READY_TEXTS_ENABLED && <NotifyWhenReadyButton />}
    </div>
  );
}
