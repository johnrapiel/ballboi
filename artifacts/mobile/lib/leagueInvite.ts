// League invite links (decision C1, Oct 31 review). The pure helpers live in
// lib/joinLink.ts; this file adds the code kept through sign-in.

import AsyncStorage from "@react-native-async-storage/async-storage";

import { cleanCode } from "./joinLink";

export { JOIN_LINK_BASE, cleanCode, codeFromInput, inviteMessage, joinUrl } from "./joinLink";

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
