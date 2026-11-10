// League invite links and codes, as pure helpers (no React Native), so
// they're easy to test. lib/leagueInvite.ts re-exports these.
//
// One link works everywhere (decision C1, Oct 31 review): with the app
// installed, https://ballboi.tennis/join/CODE opens the league's join screen;
// without it, ballboi.tennis shows the code and how to get Ball Boi.
// Copy and Share both give this link (John, Nov 9).

export const JOIN_LINK_BASE = "https://ballboi.tennis/join/";

/** Invite codes are uppercase letters and digits, typed or pasted. */
export function cleanCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

export function joinUrl(code: string): string {
  return `${JOIN_LINK_BASE}${cleanCode(code)}`;
}

/** The message the Share sheet sends: "Join Tuesday Flex on Ball Boi: https://ballboi.tennis/join/QQBU4MBY". */
export function inviteMessage(leagueName: string, code: string): string {
  return `Join ${leagueName} on Ball Boi: ${joinUrl(code)}`;
}

/**
 * What someone typed or pasted into the invite code field: a bare code, or
 * the whole copied link (https://ballboi.tennis/join/CODE, ballboi.tennis/join/CODE,
 * ballboi://join/CODE), or a shared message with the link in it.
 */
export function codeFromInput(raw: string): string {
  const link = raw.match(/(?:^|[\s/:])join\/([A-Za-z0-9-]+)/i);
  return cleanCode(link ? link[1] : raw);
}
