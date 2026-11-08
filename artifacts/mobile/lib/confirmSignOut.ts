// Every Sign out button goes through here, so the warning about recordings
// that haven't uploaded shows wherever someone signs out.

import { Alert } from "react-native";

import { forgetThisPhone } from "@/lib/notifications";
import { loadQueue } from "@/lib/recording/queue";
import { signOutConfirm, signOutWarning } from "@/lib/signOutWarning";

/**
 * Runs signOut straight away when no recordings are waiting. Otherwise asks
 * first, and runs it only on "Sign out anyway". With `always` (Settings), it
 * asks every time. Resolves true when it signed out.
 */
export async function confirmSignOut(signOut: () => Promise<unknown>, opts: { always?: boolean } = {}): Promise<boolean> {
  let waiting = 0;
  try {
    waiting = (await loadQueue()).length;
  } catch {
    waiting = 0;
  }
  const warning = opts.always ? signOutConfirm(waiting) : signOutWarning(waiting);
  if (warning) {
    const go = await new Promise<boolean>((resolve) => {
      Alert.alert(
        warning.title,
        warning.message,
        [
          { text: "Cancel", style: "cancel", onPress: () => resolve(false) },
          { text: warning.confirmLabel, style: "destructive", onPress: () => resolve(true) },
        ],
        { cancelable: true, onDismiss: () => resolve(false) },
      );
    });
    if (!go) return false;
  }
  // While still signed in: this phone stops getting the account's pushes.
  await forgetThisPhone();
  await signOut();
  return true;
}
