// Walkthrough test data and the helper commands' grammar (dev only).
// Pure, so it's easy to test. The CLI is src/dev/walkthrough.ts.

/** Seeded accounts. A is John's own account; B, C and D are created here. */
export const WALKTHROUGH_ACCOUNTS = {
  B: {
    firstName: "Blair",
    lastName: "Walker",
    // Clerk development instances accept "+clerk_test" emails with code 424242.
    email: "ballboi-walkthrough-b+clerk_test@example.com",
    rating: 3.5,
    zip: "12508",
    role: "League mate and opponent",
  },
  C: {
    firstName: "Casey",
    lastName: "Ng",
    email: "ballboi-walkthrough-c+clerk_test@example.com",
    rating: 3.0,
    zip: "12524",
    role: "Stranger near you, for messaging",
  },
  D: {
    firstName: "Drew",
    lastName: "Patel",
    email: "ballboi-walkthrough-d+clerk_test@example.com",
    rating: 4.0,
    zip: "12590",
    role: "Second reporter, for auto-restrict",
  },
} as const;

export type SeededLetter = keyof typeof WALKTHROUGH_ACCOUNTS;
export type Letter = SeededLetter | "A";
export const SEEDED_LETTERS = Object.keys(WALKTHROUGH_ACCOUNTS) as SeededLetter[];

/** Clerk's fixed verification code for "+clerk_test" emails on development instances. */
export const TEST_EMAIL_CODE = "424242";

export const SEEDED_LEAGUE_NAME = "Walkthrough League";
/** How the seed recognizes its own league when it runs again. */
export const SEEDED_LEAGUE_MARKER = "Seeded by pnpm seed:walkthrough. Safe to delete.";

export const REPORT_REASONS = ["harassment", "inappropriate_content", "impersonation", "spam", "cheating", "other"] as const;

export type Command =
  | { kind: "help" }
  | { kind: "seed"; me: string | null }
  | { kind: "accounts" }
  | { kind: "message"; as: SeededLetter; to: Letter; text: string }
  | { kind: "join"; as: SeededLetter; code: string }
  | { kind: "report"; as: SeededLetter; about: Letter; reason: string }
  | { kind: "score"; as: SeededLetter; score: string; matchId: number | null }
  | { kind: "leave"; as: SeededLetter; leagueId: number | null }
  | { kind: "time"; league: "seeded" | number; action: string }
  | { kind: "pair-now"; league: "seeded" | number };

const TIME_WORDS: Record<string, string> = {
  "season-started": "season_started",
  "deadline-passed": "deadline_passed",
  "in-grace": "in_grace",
  "grace-over": "grace_over",
};

function letter(raw: string | undefined, allowA: boolean): Letter | null {
  const l = (raw ?? "").toUpperCase();
  if (l === "A" && allowA) return "A";
  return (SEEDED_LETTERS as string[]).includes(l) ? (l as SeededLetter) : null;
}

function leagueArg(raw: string | undefined): "seeded" | number | null {
  if (!raw || raw === "seeded") return "seeded";
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : null;
}

function flag(args: string[], name: string): string | null {
  const i = args.indexOf(name);
  return i >= 0 ? (args[i + 1] ?? null) : null;
}

/** Parses the command line. Returns a plain-English problem for bad input. */
export function parseCommand(argv: string[]): Command | { error: string } {
  const [verb, ...rest] = argv;
  if (!verb || verb === "help" || verb === "--help") return { kind: "help" };
  if (verb === "seed") return { kind: "seed", me: flag(rest, "--me") };
  if (verb === "accounts") return { kind: "accounts" };

  if (verb === "time") {
    const league = leagueArg(rest.length > 1 ? rest[0] : "seeded");
    const word = rest.length > 1 ? rest[1] : rest[0];
    const action = TIME_WORDS[word ?? ""];
    if (league === null || !action) return { error: `Usage: time [seeded|<leagueId>] ${Object.keys(TIME_WORDS).join("|")}` };
    return { kind: "time", league, action };
  }
  if (verb === "pair-now") {
    const league = leagueArg(rest[0]);
    if (league === null) return { error: "Usage: pair-now [seeded|<leagueId>]" };
    return { kind: "pair-now", league };
  }

  if (verb === "as") {
    const as = letter(rest[0], false);
    if (!as || as === "A") return { error: "Act as B, C or D: as <B|C|D> <action> ..." };
    const [action, ...args] = rest.slice(1);
    switch (action) {
      case "message": {
        const to = letter(args[0], true);
        const text = args.slice(1).join(" ").trim();
        if (!to || !text) return { error: 'Usage: as <B|C|D> message <A|B|C|D> "text"' };
        if (to === as) return { error: "Pick someone else to message." };
        return { kind: "message", as, to, text };
      }
      case "join": {
        if (!args[0]) return { error: "Usage: as <B|C|D> join <invite code>" };
        return { kind: "join", as, code: args[0] };
      }
      case "report": {
        const about = letter(args[0], true);
        const reason = args[1] ?? "harassment";
        if (!about || about === as) return { error: "Usage: as <B|C|D> report <A|B|C|D> [reason]" };
        if (!(REPORT_REASONS as readonly string[]).includes(reason)) return { error: `Reason must be one of ${REPORT_REASONS.join(", ")}` };
        return { kind: "report", as, about, reason };
      }
      case "score": {
        const matchRaw = flag(args, "--match");
        const score = args.filter((a, i) => a !== "--match" && args[i - 1] !== "--match").join(" ").trim();
        const matchId = matchRaw === null ? null : Number(matchRaw);
        if (!score || (matchId !== null && !Number.isInteger(matchId))) return { error: 'Usage: as <B|C|D> score "6-3, 6-4" [--match <id>]' };
        return { kind: "score", as, score, matchId };
      }
      case "leave": {
        const leagueId = args[0] ? Number(args[0]) : null;
        if (leagueId !== null && !Number.isInteger(leagueId)) return { error: "Usage: as <B|C|D> leave [leagueId]" };
        return { kind: "leave", as, leagueId };
      }
      default:
        return { error: "Actions: message, join, report, score, leave" };
    }
  }
  return { error: `Unknown command "${verb}". Run: pnpm walkthrough help` };
}

export const HELP = `Ball Boi walkthrough tools (development only)

  pnpm seed:walkthrough                    Reset and create the walkthrough test data
  pnpm walkthrough accounts                List the seeded accounts and how to sign in as them

Act as B, C or D (needs the API running: pnpm dev)
  pnpm walkthrough as C message A "Hi"     Send a message (starts a conversation if needed)
  pnpm walkthrough as B join ABC23456      Join a league by invite code
  pnpm walkthrough as D report C           Report someone (their latest message to you, or their profile)
  pnpm walkthrough as B score "6-3, 6-4"   Enter a score for B's match against A (or --match <id>)
  pnpm walkthrough as B leave [leagueId]   Leave a league mid-season

Time controls for a league (seeded league by default, or pass a league id)
  pnpm walkthrough time season-started     The season starts today
  pnpm walkthrough time deadline-passed    This round's deadline was yesterday (grace week, day 1)
  pnpm walkthrough time in-grace           Midway through the grace week
  pnpm walkthrough time grace-over         The grace week ended yesterday
  pnpm walkthrough pair-now                Draft the next round now, for review in Manage

The same time controls are on the phone: league > Manage > Testing tools.`;
