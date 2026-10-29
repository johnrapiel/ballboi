// An invite link opened before signing in. Kept on the phone so the
// invite screen opens again once the person is in the app.

import AsyncStorage from "@react-native-async-storage/async-storage";

const KEY = "ballboi.recording.pendingInvite";

export async function savePendingInvite(code: string) {
  try {
    await AsyncStorage.setItem(KEY, code);
  } catch {
    // They can open the link again.
  }
}

/** Returns and forgets the saved code, if any. */
export async function takePendingInvite(): Promise<string | null> {
  try {
    const code = await AsyncStorage.getItem(KEY);
    if (code) await AsyncStorage.removeItem(KEY);
    return code;
  } catch {
    return null;
  }
}
