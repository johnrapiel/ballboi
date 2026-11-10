// Ball Boi's DeviceCheck token (Wave 2, Session G; device bans). The native
// side is apple/BallBoiDeviceCheckModule.swift (apple/, not ios/, because the
// app's .gitignore drops ios/ folders). Where it isn't built in (Expo Go, a
// simulator, older builds), it reports unsupported and nothing breaks.

import { requireOptionalNativeModule } from "expo";

import { readDeviceCheckToken, type DeviceCheckNative } from "@/lib/deviceCheck/token";

const native = requireOptionalNativeModule<DeviceCheckNative>("BallBoiDeviceCheck");

/** A fresh DeviceCheck token, or null where DeviceCheck isn't available. Never throws. */
export function deviceCheckToken(): Promise<string | null> {
  return readDeviceCheckToken(native);
}
