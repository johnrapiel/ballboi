import { describe, expect, it } from "vitest";

import {
  googleClientId,
  googleSignInReady,
  iosUrlSchemeFor,
  signInOptions,
  type GoogleSignInInput,
} from "@/lib/signInOptions";

// Made-up IDs in Google's format. Never real ones.
const WEB = "1234-webexample.apps.googleusercontent.com";
const IOS = "1234-iosexample.apps.googleusercontent.com";
const SCHEME = "com.googleusercontent.apps.1234-iosexample";

const ready: GoogleSignInInput = {
  platform: "ios",
  nativeModule: true,
  webClientId: WEB,
  iosClientId: IOS,
  iosUrlScheme: SCHEME,
  builtIosUrlScheme: SCHEME,
};

describe("googleClientId", () => {
  it("accepts a Google client ID and trims it", () => {
    expect(googleClientId(` ${WEB}\n`)).toBe(WEB);
  });

  it("refuses empty, placeholder and other values", () => {
    expect(googleClientId(undefined)).toBeNull();
    expect(googleClientId("")).toBeNull();
    expect(googleClientId(".apps.googleusercontent.com")).toBeNull();
    expect(googleClientId("your client id.apps.googleusercontent.com")).toBeNull();
    expect(googleClientId("pk_test_xxx")).toBeNull();
    expect(googleClientId(42)).toBeNull();
  });
});

describe("iosUrlSchemeFor", () => {
  it("reverses the iOS client ID the way Google expects", () => {
    expect(iosUrlSchemeFor(IOS)).toBe(SCHEME);
  });

  it("is null for something that isn't a client ID", () => {
    expect(iosUrlSchemeFor("nope")).toBeNull();
  });
});

describe("googleSignInReady", () => {
  it("shows Google when everything is set and the build has the URL scheme", () => {
    expect(googleSignInReady(ready)).toBe(true);
  });

  it("hides Google when any value is missing at runtime", () => {
    expect(googleSignInReady({ ...ready, webClientId: undefined })).toBe(false);
    expect(googleSignInReady({ ...ready, iosClientId: "" })).toBe(false);
    expect(googleSignInReady({ ...ready, iosUrlScheme: undefined })).toBe(false);
  });

  it("hides Google on a build made without the URL scheme, so the Google SDK can't stop the app", () => {
    expect(googleSignInReady({ ...ready, builtIosUrlScheme: null })).toBe(false);
    expect(googleSignInReady({ ...ready, builtIosUrlScheme: "com.googleusercontent.apps.other" })).toBe(false);
  });

  it("uses the runtime scheme when the build's config can't be read", () => {
    expect(googleSignInReady({ ...ready, builtIosUrlScheme: undefined })).toBe(true);
    expect(googleSignInReady({ ...ready, builtIosUrlScheme: undefined, iosUrlScheme: undefined })).toBe(false);
  });

  it("hides Google when the URL scheme doesn't match the iOS client ID", () => {
    const other = "com.googleusercontent.apps.9999-other";
    expect(googleSignInReady({ ...ready, iosUrlScheme: other, builtIosUrlScheme: other })).toBe(false);
  });

  it("hides Google on a build without Clerk's Google module, or off iOS", () => {
    expect(googleSignInReady({ ...ready, nativeModule: false })).toBe(false);
    expect(googleSignInReady({ ...ready, platform: "android" })).toBe(false);
    expect(googleSignInReady({ ...ready, platform: "web" })).toBe(false);
  });
});

describe("signInOptions", () => {
  it("always offers email", () => {
    const none = signInOptions({ platform: "ios", appleAvailable: false, google: { ...ready, nativeModule: false } });
    expect(none).toEqual({ apple: false, google: false, email: true });
  });

  it("offers Apple only where iOS says it's available, whatever Google's config", () => {
    expect(signInOptions({ platform: "ios", appleAvailable: true, google: { ...ready, webClientId: "" } })).toEqual({
      apple: true,
      google: false,
      email: true,
    });
    expect(signInOptions({ platform: "web", appleAvailable: true, google: ready }).apple).toBe(false);
  });

  it("offers all three when everything is set up", () => {
    expect(signInOptions({ platform: "ios", appleAvailable: true, google: ready })).toEqual({
      apple: true,
      google: true,
      email: true,
    });
  });
});
