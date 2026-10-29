// Spoken cues for the mounted phone. Spec: the voice "plays on silent", and
// every cue is mirrored as an on-screen caption by the caller.

import { setAudioModeAsync } from "expo-audio";
import * as Speech from "expo-speech";

let prepared = false;

/** Lets cues play with the ring/silent switch on. Safe to call more than once. */
export async function prepareVoice() {
  if (prepared) return;
  try {
    await setAudioModeAsync({ playsInSilentMode: true });
    prepared = true;
  } catch {
    // Cues still show as captions.
  }
}

/** Says one cue, cutting off any cue still playing. */
export function say(text: string) {
  try {
    Speech.stop();
    Speech.speak(text, { language: "en-US" });
  } catch {
    // Captions carry the cue.
  }
}

export function stopVoice() {
  try {
    Speech.stop();
  } catch {
    // Nothing playing.
  }
}
