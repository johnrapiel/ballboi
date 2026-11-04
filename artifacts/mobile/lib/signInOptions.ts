// Which sign-in buttons Welcome shows (PR 3, native Apple and Google).
//
// Email code always shows. Apple shows when iOS says Sign in with Apple is
// available on this build and device. Google shows only when every value the
// native Google flow needs is set and this build was made with Google's URL
// scheme: Google's iOS SDK stops the app if the scheme is missing, so a
// half-configured Google hides instead.
//
// Pure rules here, so they're easy to test. components/NativeSignInButtons.tsx
// reads the device and config and passes them in.

const GOOGLE_CLIENT_SUFFIX = ".apps.googleusercontent.com";
const GOOGLE_SCHEME_PREFIX = "com.googleusercontent.apps.";

/** A Google OAuth client ID with text before ".apps.googleusercontent.com", trimmed. Null otherwise. */
export function googleClientId(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const id = value.trim();
  if (!id.endsWith(GOOGLE_CLIENT_SUFFIX)) return null;
  const prefix = id.slice(0, -GOOGLE_CLIENT_SUFFIX.length);
  return /^[A-Za-z0-9-]+$/.test(prefix) ? id : null;
}

/**
 * The iOS URL scheme Google expects for an iOS client ID:
 * "123-abc.apps.googleusercontent.com" becomes "com.googleusercontent.apps.123-abc".
 */
export function iosUrlSchemeFor(iosClientId: string): string | null {
  const id = googleClientId(iosClientId);
  if (!id) return null;
  return GOOGLE_SCHEME_PREFIX + id.slice(0, -GOOGLE_CLIENT_SUFFIX.length);
}

export interface GoogleSignInInput {
  platform: string;
  /** The ClerkGoogleSignIn native module is in this build (@clerk/expo-google-signin). */
  nativeModule: boolean;
  /** EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID at runtime. */
  webClientId: unknown;
  /** EXPO_PUBLIC_CLERK_GOOGLE_IOS_CLIENT_ID at runtime. */
  iosClientId: unknown;
  /** EXPO_PUBLIC_CLERK_GOOGLE_IOS_URL_SCHEME at runtime. */
  iosUrlScheme: unknown;
  /**
   * EXPO_PUBLIC_CLERK_GOOGLE_IOS_URL_SCHEME as it was when this build was made
   * (the app config embedded in the build). Undefined when the build's config
   * can't be read, and then the runtime value stands in for it.
   */
  builtIosUrlScheme: unknown;
}

export function googleSignInReady(s: GoogleSignInInput): boolean {
  if (s.platform !== "ios" || !s.nativeModule) return false;
  if (!googleClientId(s.webClientId)) return false;
  const iosClientId = googleClientId(s.iosClientId);
  if (!iosClientId) return false;
  const expected = iosUrlSchemeFor(iosClientId);
  const trim = (v: unknown) => (typeof v === "string" ? v.trim() : null);
  const built = s.builtIosUrlScheme === undefined ? trim(s.iosUrlScheme) : trim(s.builtIosUrlScheme);
  return expected !== null && trim(s.iosUrlScheme) === expected && built === expected;
}

export interface SignInOptions {
  apple: boolean;
  google: boolean;
  email: true;
}

export function signInOptions(s: { platform: string; appleAvailable: boolean; google: GoogleSignInInput }): SignInOptions {
  return {
    apple: s.platform === "ios" && s.appleAvailable,
    google: googleSignInReady(s.google),
    email: true,
  };
}
