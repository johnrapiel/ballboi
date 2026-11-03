// Demo data for testing on a phone (development only): realistic players
// around the Hudson Valley, and believable tennis scores. Pure, so it's easy
// to test. The seed that writes it is src/dev/demoSeed.ts (pnpm seed:demo).

export interface DemoPerson {
  firstName: string;
  lastName: string;
  rating: number;
  zip: string;
  hand: "right" | "left";
  bio: string | null;
}

export interface DemoArea {
  town: string;
  latitude: number;
  longitude: number;
}

/** Approximate centers, rounded to two decimals like real "Use my location" saves. */
export const DEMO_AREAS: Record<string, DemoArea> = {
  "12590": { town: "Wappingers Falls", latitude: 41.6, longitude: -73.91 },
  "12508": { town: "Beacon", latitude: 41.5, longitude: -73.96 },
  "12524": { town: "Fishkill", latitude: 41.53, longitude: -73.89 },
  "12533": { town: "Hopewell Junction", latitude: 41.57, longitude: -73.8 },
  "12601": { town: "Poughkeepsie", latitude: 41.7, longitude: -73.92 },
  "12603": { town: "Poughkeepsie", latitude: 41.68, longitude: -73.87 },
  "12538": { town: "Hyde Park", latitude: 41.78, longitude: -73.93 },
  "12569": { town: "Pleasant Valley", latitude: 41.74, longitude: -73.82 },
  "12540": { town: "LaGrangeville", latitude: 41.66, longitude: -73.73 },
  "12550": { town: "Newburgh", latitude: 41.5, longitude: -74.02 },
  "12553": { town: "New Windsor", latitude: 41.47, longitude: -74.06 },
  "12561": { town: "New Paltz", latitude: 41.75, longitude: -74.09 },
  "12528": { town: "Highland", latitude: 41.72, longitude: -73.96 },
  "10516": { town: "Cold Spring", latitude: 41.42, longitude: -73.95 },
  "10566": { town: "Peekskill", latitude: 41.29, longitude: -73.92 },
  "12401": { town: "Kingston", latitude: 41.93, longitude: -74.0 },
  "12563": { town: "Patterson", latitude: 41.49, longitude: -73.58 },
  // Far away on purpose: Discover should never show these to someone in 12590.
  "11215": { town: "Brooklyn", latitude: 40.67, longitude: -73.99 },
  "10025": { town: "Manhattan", latitude: 40.8, longitude: -73.97 },
  "02139": { town: "Cambridge", latitude: 42.36, longitude: -71.1 },
};

/** 12 players who join Test League 1. Ratings sit around a typical 3.5 rec league. */
export const DEMO_LEAGUE_PLAYERS: DemoPerson[] = [
  { firstName: "Maya", lastName: "Chen", rating: 3.5, zip: "12508", hand: "right", bio: "Played in college a while back. Getting the serve back." },
  { firstName: "Marcus", lastName: "Hall", rating: 4.0, zip: "12601", hand: "right", bio: "Big forehand, working on everything else." },
  { firstName: "Priya", lastName: "Raman", rating: 3.5, zip: "12524", hand: "right", bio: null },
  { firstName: "Tom", lastName: "Kowalski", rating: 3.0, zip: "12590", hand: "left", bio: "Lefty. Weeknights after 6 work best." },
  { firstName: "Elena", lastName: "Ortiz", rating: 4.0, zip: "12603", hand: "right", bio: "Former high school No. 1. Love a long rally." },
  { firstName: "Jordan", lastName: "Brooks", rating: 3.5, zip: "12533", hand: "right", bio: "Started playing in 2020 and never stopped." },
  { firstName: "Sam", lastName: "Whitaker", rating: 3.0, zip: "12538", hand: "right", bio: null },
  { firstName: "Aisha", lastName: "Mensah", rating: 4.5, zip: "12569", hand: "right", bio: "Serve and volley when my knees allow it." },
  { firstName: "Ben", lastName: "Russo", rating: 3.5, zip: "12508", hand: "left", bio: "Lefty slice merchant." },
  { firstName: "Hannah", lastName: "Lee", rating: 3.0, zip: "12590", hand: "right", bio: "Weekend mornings at Memorial Park." },
  { firstName: "Diego", lastName: "Alvarez", rating: 4.0, zip: "12550", hand: "right", bio: "Clay-court grinder stuck on hard courts." },
  { firstName: "Kate", lastName: "Sullivan", rating: 3.5, zip: "12540", hand: "right", bio: null },
];

/** Players nearby who aren't in Test League 1: what Discover should show. */
export const DEMO_NEARBY_PLAYERS: DemoPerson[] = [
  { firstName: "Olivia", lastName: "Park", rating: 3.5, zip: "12590", hand: "right", bio: "New to the area, looking for regular hits." },
  { firstName: "Nate", lastName: "Fischer", rating: 4.0, zip: "12508", hand: "right", bio: "USTA 4.0 team captain in the spring." },
  { firstName: "Grace", lastName: "Adeyemi", rating: 3.0, zip: "12524", hand: "right", bio: null },
  { firstName: "Luis", lastName: "Moreno", rating: 3.5, zip: "12601", hand: "right", bio: "Lunchtime hits near Vassar." },
  { firstName: "Rachel", lastName: "Stein", rating: 4.5, zip: "12603", hand: "right", bio: "Coach by day, competitor by night." },
  { firstName: "Chris", lastName: "Nguyen", rating: 2.5, zip: "12533", hand: "right", bio: "Just started. Patient partners welcome." },
  { firstName: "Megan", lastName: "Doyle", rating: 3.0, zip: "12538", hand: "left", bio: "Lefty, consistent, no big weapons." },
  { firstName: "Andre", lastName: "Thomas", rating: 4.0, zip: "12550", hand: "right", bio: null },
  { firstName: "Sofia", lastName: "Rossi", rating: 3.5, zip: "12561", hand: "right", bio: "SUNY New Paltz alum. Doubles or singles." },
  { firstName: "Ryan", lastName: "O'Connor", rating: 3.5, zip: "12569", hand: "right", bio: null },
  { firstName: "Leah", lastName: "Goldberg", rating: 3.0, zip: "12540", hand: "right", bio: "Back after a long break." },
  { firstName: "Kenji", lastName: "Watanabe", rating: 4.0, zip: "12528", hand: "right", bio: "Early mornings before work." },
  { firstName: "Brianna", lastName: "Scott", rating: 3.5, zip: "10516", hand: "right", bio: null },
  { firstName: "Victor", lastName: "Petrov", rating: 5.0, zip: "12603", hand: "right", bio: "Former D1. Happy to hit with anyone 4.0+." },
  { firstName: "Emily", lastName: "Carter", rating: 2.5, zip: "12590", hand: "right", bio: "Learning! Looking for practice hits." },
  { firstName: "Jamal", lastName: "Wright", rating: 3.5, zip: "12553", hand: "left", bio: null },
  { firstName: "Zoe", lastName: "Martin", rating: 3.0, zip: "12508", hand: "right", bio: "Beacon local, flexible schedule." },
  { firstName: "Patrick", lastName: "Byrne", rating: 4.0, zip: "10566", hand: "right", bio: null },
  { firstName: "Nina", lastName: "Kapoor", rating: 3.5, zip: "12401", hand: "right", bio: "Up in Kingston, will drive for a good match." },
  { firstName: "Owen", lastName: "Hughes", rating: 3.0, zip: "12563", hand: "right", bio: null },
  { firstName: "Carmen", lastName: "Diaz", rating: 4.5, zip: "12524", hand: "right", bio: "Competitive singles, any surface." },
  { firstName: "Will", lastName: "Turner", rating: 3.5, zip: "12590", hand: "right", bio: "Dad of two, I play when I can." },
  // Far away: they exist, but shouldn't show up near 12590.
  { firstName: "Isaac", lastName: "Levy", rating: 3.5, zip: "11215", hand: "right", bio: "Prospect Park regular." },
  { firstName: "Tara", lastName: "Quinn", rating: 4.0, zip: "10025", hand: "right", bio: null },
  { firstName: "Felix", lastName: "Braun", rating: 3.5, zip: "02139", hand: "left", bio: null },
];

/** Two Open leagues run by nearby players, starting soon, so joining can be tried. */
export const DEMO_OPEN_LEAGUES = [
  {
    name: "Beacon Fall Singles",
    location: "Memorial Park, Beacon",
    format: "flex",
    minRating: "3.0",
    maxRating: "4.0",
    rosterCap: 16,
    weeks: 8,
    startsInDays: 5,
    organizer: "Nate Fischer",
    members: ["Zoe Martin", "Olivia Park", "Luis Moreno", "Will Turner"],
  },
  {
    name: "Poughkeepsie 4.0+ Round Robin",
    location: "Spratt Park, Poughkeepsie",
    format: "round_robin",
    minRating: "4.0",
    maxRating: "5.0",
    rosterCap: 8,
    weeks: 6,
    startsInDays: 10,
    organizer: "Rachel Stein",
    members: ["Victor Petrov", "Kenji Watanabe", "Carmen Diaz"],
  },
] as const;

export const DEMO_COURTS = [
  "Memorial Park, Beacon",
  "Spratt Park, Poughkeepsie",
  "Brinckerhoff Park, Fishkill",
  "Robinson Lane courts, Wappingers Falls",
  "Hyde Park Town courts",
];

/** Clerk development instances accept "+clerk_test" emails with code 424242. */
export function demoEmail(p: Pick<DemoPerson, "firstName" | "lastName">): string {
  const slug = `${p.firstName}-${p.lastName}`.toLowerCase().replace(/[^a-z-]/g, "");
  return `ballboi-demo-${slug}+clerk_test@example.com`;
}

export const DEMO_EMAIL_PREFIX = "ballboi-demo-";
/** How the demo seed recognizes leagues it made when it runs again. */
export const DEMO_LEAGUE_MARKER = "Seeded by pnpm seed:demo. Safe to delete.";

// ─── Randomness that repeats ─────────────────────────────────────────────────

/** A small seeded random generator, so every run of the seed makes the same data. */
export function seededRandom(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Chance the first player wins a set: about 73% for a half-level edge, 50% when even. */
export function setWinChance(rating1: number, rating2: number): number {
  return 1 / (1 + Math.exp(-(rating1 - rating2) * 2));
}

function pick<T>(rand: () => number, items: readonly T[]): T {
  return items[Math.floor(rand() * items.length)];
}

/** One set's games from the set winner's side, like "6-3" or "7-6(4)". */
function setScore(rand: () => number, closeness: number): string {
  const r = rand();
  if (r < 0.1 + closeness * 0.1) return `7-6(${pick(rand, [2, 3, 4, 5, 5, 6, 7, 8])})`;
  if (r < 0.22 + closeness * 0.15) return "7-5";
  // Closer matchups lose fewer bagels.
  const loser = pick(rand, closeness > 0.5 ? [2, 3, 3, 4, 4, 4] : [0, 1, 1, 2, 2, 3, 3, 4]);
  return `6-${loser}`;
}

function flip(set: string): string {
  const m = set.match(/^(\d+)-(\d+)(\(\d+\))?$/)!;
  return `${m[2]}-${m[1]}${m[3] ?? ""}`;
}

/**
 * A best-of-three match between two ratings. Score is from player 1's side, as
 * the app stores it. A split goes to a 10-point match tiebreak most of the time.
 */
export function simulateMatch(rand: () => number, rating1: number, rating2: number): { score: string; winnerSide: 1 | 2 } {
  const p1 = setWinChance(rating1, rating2);
  const closeness = 1 - Math.abs(p1 - 0.5) * 2;
  const sets: string[] = [];
  let w1 = 0;
  let w2 = 0;
  while (w1 < 2 && w2 < 2) {
    const p1Wins = rand() < p1;
    if (w1 === 1 && w2 === 1 && rand() < 0.7) {
      const loser = pick(rand, [3, 4, 5, 6, 7, 8]);
      sets.push(p1Wins ? `10-${loser}` : `${loser}-10`);
    } else {
      const s = setScore(rand, closeness);
      sets.push(p1Wins ? s : flip(s));
    }
    if (p1Wins) w1++;
    else w2++;
  }
  return { score: sets.join(", "), winnerSide: w1 > w2 ? 1 : 2 };
}

/** The season start that keeps the league's weekday and puts `today` in round `round`. */
export function startForRound(originalStart: string, today: string, round: number): string {
  const day = (d: string) => Math.round(Date.parse(`${d}T00:00:00Z`) / 86_400_000);
  const latest = day(today) - (round - 1) * 7; // the latest start that still puts today in this round
  const offset = (((latest - day(originalStart)) % 7) + 7) % 7;
  return new Date((latest - offset) * 86_400_000).toISOString().slice(0, 10);
}

/** Minutes east of UTC for New York on a date (handles daylight saving). */
function nyOffsetMinutes(date: string): number {
  const probe = new Date(`${date}T12:00:00Z`);
  const ny = new Date(probe.toLocaleString("en-US", { timeZone: "America/New_York" }));
  const utc = new Date(probe.toLocaleString("en-US", { timeZone: "UTC" }));
  return Math.round((ny.getTime() - utc.getTime()) / 60_000);
}

/** ISO time for a local New York date and hour, like 6:30 PM on a weeknight. */
export function nyTime(date: string, hour: number, minute = 0): string {
  const utcMs = Date.parse(`${date}T00:00:00Z`) + (hour * 60 + minute - nyOffsetMinutes(date)) * 60_000;
  return new Date(utcMs).toISOString();
}
