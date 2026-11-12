// Match time link words (Wave 2 finding 25, John, Nov 12). Pure, so it's tested in Node.

/** The visible link: "Set a match time" when none is set, "Change time" once one is. */
export function matchTimeLinkLabel(hasTime: boolean): string {
  return hasTime ? "Change time" : "Set a match time";
}

/** What VoiceOver reads: what the link does and who the match is with. */
export function matchTimeLinkSpoken(hasTime: boolean, opponent: string): string {
  return hasTime ? `Change the time of your match with ${opponent}` : `Set a match time for your match with ${opponent}`;
}
