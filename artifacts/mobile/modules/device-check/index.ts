// Ball Boi's DeviceCheck token (Wave 2, Session G; device bans). The native
// side is ios/BallBoiDeviceCheckModule.swift. Where it isn't built in (Expo Go,
// a simulator, older builds), it reports unsupported and nothing breaks.

import { requireOptionalNativeModule } from "expo";

interface DeviceCheckModule {
  isSupported(): boolean;
  generateTokenAsync(): Promise<string>;
}

const native = requireOptionalNativeModule<DeviceCheckModule>("BallBoiDeviceCheck");

/** A fresh DeviceCheck token, or null where DeviceCheck isn't available. Never throws. */
export async function deviceCheckToken(): Promise<string | null> {
  try {
    if (!native || !native.isSupported()) return null;
    return await native.generateTokenAsync();
  } catch {
    return null;
  }
}
