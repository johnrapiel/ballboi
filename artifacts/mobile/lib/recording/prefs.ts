// "Upload over cellular" (spec: Ball Boi > After the match, Upload: "Wi-Fi by
// default with a cellular toggle in settings"). It's about this phone's data
// plan, so it lives on the phone, off by default.
//
// Hand-off to Session H (Settings): render a switch bound to
// useUploadOnCellular() / setUploadOnCellular().

import AsyncStorage from "@react-native-async-storage/async-storage";
import { useSyncExternalStore } from "react";

const KEY = "ballboi.recording.uploadOnCellular";
let value = false;
let loaded = false;
const listeners = new Set<() => void>();

export async function loadUploadOnCellular(): Promise<boolean> {
  if (loaded) return value;
  try {
    value = (await AsyncStorage.getItem(KEY)) === "1";
  } catch {
    value = false;
  }
  loaded = true;
  for (const l of listeners) l();
  return value;
}

export async function setUploadOnCellular(on: boolean) {
  value = on;
  loaded = true;
  for (const l of listeners) l();
  try {
    await AsyncStorage.setItem(KEY, on ? "1" : "0");
  } catch {
    // Kept for this launch.
  }
}

export function useUploadOnCellular(): boolean {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => {
        listeners.delete(l);
      };
    },
    () => value,
    () => value,
  );
}

// "Don't show this again" on the setup page (B7). Per phone, like the
// cellular switch: the "Setup tips" link on the ready screen always opens it.

const HIDE_SETUP_KEY = "ballboi.recording.hideSetup";
let hideSetup = false;
let hideSetupLoaded = false;

/** Reads the setup page choice once per launch. Never throws. */
export async function loadHideSetup(): Promise<boolean> {
  if (hideSetupLoaded) return hideSetup;
  try {
    hideSetup = (await AsyncStorage.getItem(HIDE_SETUP_KEY)) === "1";
  } catch {
    hideSetup = false;
  }
  hideSetupLoaded = true;
  return hideSetup;
}

export async function setHideSetup(hide: boolean) {
  hideSetup = hide;
  hideSetupLoaded = true;
  try {
    await AsyncStorage.setItem(HIDE_SETUP_KEY, hide ? "1" : "0");
  } catch {
    // Kept for this launch.
  }
}
