// The phone facts for a recording's sidecar (decision T5), from packages the
// app already has: expo-device, expo-constants and expo-battery. No new
// native code.

import * as Battery from "expo-battery";
import Constants from "expo-constants";
import * as Device from "expo-device";
import { Platform } from "react-native";

import { batteryPercent, type Sidecar } from "@/lib/recording/sidecar";

export function sidecarDevice(): Sidecar["device"] {
  const iosBuild = (Constants.platform?.ios as { buildNumber?: string | null } | undefined)?.buildNumber ?? null;
  return {
    // The exact identifier, like "iPhone15,2".
    model: Device.modelId ?? Device.modelName ?? null,
    iosVersion: Device.osVersion ?? (Platform.OS === "ios" ? String(Platform.Version) : null),
    appVersion: Constants.expoConfig?.version ?? null,
    // The installed build number (CFBundleVersion). EAS sets it remotely, so app.json's copy can be stale.
    appBuild: iosBuild,
  };
}

/** Battery as a whole percent, or null when the phone doesn't say. */
export async function batteryNow(): Promise<number | null> {
  try {
    return batteryPercent(await Battery.getBatteryLevelAsync());
  } catch {
    return null;
  }
}
