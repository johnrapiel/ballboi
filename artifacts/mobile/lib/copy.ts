// Copy text to the clipboard (finding 11; since Nov 9 the invite's copy gives the join link).
// expo-clipboard is a native module. A development build made before it was
// added doesn't have it, so it's loaded on first use and a missing module
// returns false instead of crashing; the caller then offers Share.

export async function copyText(text: string): Promise<boolean> {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const Clipboard = require("expo-clipboard") as typeof import("expo-clipboard");
    return await Clipboard.setStringAsync(text);
  } catch {
    return false;
  }
}
