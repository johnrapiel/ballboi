// The actions on a match card before it's played (Wave 2 finding 54, John,
// Nov 12: "It should be constant"). One set, in one order, everywhere the
// card appears: Home's next match, the league page's Your match, and Match
// detail before play. There's no Details button: tapping the card itself
// opens Match detail.
//
// - Before play: Record with Ball Boi (the primary button, when it can be
//   recorded), then Message and Enter score side by side.
// - Past due (finding 47: an hour after the start, no score): Enter score
//   (primary) and Message side by side, then Record with Ball Boi as a text
//   link, in case they're still playing.
//
// At most one primary button and one secondary pair (decision 189). Pure, so
// it's tested in lib/__tests__; components/MatchActions.tsx draws it.

export type MatchActionKey = "record" | "message" | "enterScore";

export interface MatchActionSlot {
  key: MatchActionKey;
  /** A Button, or a TextLinkButton on its own line. */
  as: "button" | "link";
  variant: "primary" | "secondary";
  /** "lead": its own full-width row; "row": side by side; "under": a link under the row. */
  place: "lead" | "row" | "under";
}

export function matchActionLayout(input: {
  /** Record with Ball Boi is offered (singles, playable). */
  record: boolean;
  message: boolean;
  enterScore: boolean;
  pastDue: boolean;
  /** Doubles: a dimmed Record with its reason takes Record's place (league page). */
  recordPlaceholder?: boolean;
}): MatchActionSlot[] {
  const { record, message, enterScore, pastDue } = input;
  const out: MatchActionSlot[] = [];
  if (pastDue) {
    if (enterScore) out.push({ key: "enterScore", as: "button", variant: "primary", place: "row" });
    if (message) out.push({ key: "message", as: "button", variant: enterScore ? "secondary" : "primary", place: "row" });
    if (record) out.push({ key: "record", as: "link", variant: "secondary", place: "under" });
    return out;
  }
  const led = record || !!input.recordPlaceholder;
  if (record) out.push({ key: "record", as: "button", variant: "primary", place: "lead" });
  if (message) out.push({ key: "message", as: "button", variant: led ? "secondary" : "primary", place: "row" });
  if (enterScore) out.push({ key: "enterScore", as: "button", variant: led || message ? "secondary" : "primary", place: "row" });
  return out;
}

/**
 * What VoiceOver reads for a tappable match card: "Today, 6:30 PM, You vs.
 * Elena Ortiz, Memorial Park, Beacon, Test League 1". Its hint is
 * MATCH_CARD_HINT.
 */
export function matchCardSpoken(parts: {
  dateLabel: string;
  time?: string | null;
  versus: string;
  location?: string | null;
  league?: string | null;
  note?: string | null;
}): string {
  return [parts.dateLabel, parts.time, parts.versus, parts.location, parts.league, parts.note]
    .map((p) => (p ?? "").trim())
    .filter(Boolean)
    .join(", ")
    .replace(/ · /g, ", ")
    .replace(/ & /g, " and ");
}

export const MATCH_CARD_HINT = "Opens match details";
