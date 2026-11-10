// The DeviceCheck token read, without React Native, so it can be tested in
// Node. modules/device-check/index.ts passes in the native module, or null
// where it isn't built in (Expo Go, a simulator, a build without it).
//
// Fail safe (#204): any missing module, unsupported phone, error or odd
// answer gives null. The app then skips the check-in, so nobody is blocked
// and nothing crashes.

export interface DeviceCheckNative {
  isSupported(): boolean;
  generateTokenAsync(): Promise<string>;
}

/** A fresh DeviceCheck token, or null where DeviceCheck isn't available. Never throws. */
export async function readDeviceCheckToken(native: DeviceCheckNative | null | undefined): Promise<string | null> {
  try {
    if (!native || !native.isSupported()) return null;
    const token = await native.generateTokenAsync();
    return typeof token === "string" && token.length > 0 ? token : null;
  } catch {
    return null;
  }
}
