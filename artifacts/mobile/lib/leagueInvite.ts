// League invite links (decision C1, Oct 31 review). One link works everywhere:
// with the app installed it opens the join screen (universal link on
// ballboi.tennis, or ballboi://join/CODE); without it, ballboi.tennis shows
// the code and an App Store link.

import AsyncStorage from "@react-native-async-storage/async-storage";

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

const PENDING_KEY = "ballboi.leagues.pendingJoinCode";

/** A join link opened before signing in, reopened once the player is in the app. */
export async function savePendingJoinCode(code: string) {
  try {
    await AsyncStorage.setItem(PENDING_KEY, cleanCode(code));
  } catch {
    // They can open the link again.
  }
}

/** Returns and forgets the saved code, if any. */
export async function takePendingJoinCode(): Promise<string | null> {
  try {
    const code = await AsyncStorage.getItem(PENDING_KEY);
    if (code) await AsyncStorage.removeItem(PENDING_KEY);
    return code;
  } catch {
    return null;
  }
}
