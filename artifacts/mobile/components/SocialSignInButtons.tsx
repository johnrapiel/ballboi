// Apple's and Google's own sign-in buttons for Welcome (PR 3).
//
// Apple: Apple's native button from expo-apple-authentication, "Continue with
// Apple". Black on the light Day session, white on the dark Night session, as
// Apple's guidelines ask (never a black button on a dark background).
// Google: Google's approved "Continue with Google" button, built to Google's
// branding spec: the full-color G on white with a gray outline (light), or on
// #131314 (dark).
//
// lib/signInOptions.ts decides which buttons show. This file reads the device
// and the config for it.

import * as AppleAuthentication from "expo-apple-authentication";
import Constants from "expo-constants";
import { requireOptionalNativeModule } from "expo";
import React, { useEffect, useState } from "react";
import { ActivityIndicator, Platform, Pressable, Text, View, useColorScheme } from "react-native";
import Svg, { Path } from "react-native-svg";

import { radius } from "@/constants/tokens";
import { signInOptions, type SignInOptions } from "@/lib/signInOptions";

/** Apple, Google and the email button share one height on Welcome. */
export const SIGN_IN_BUTTON_HEIGHT = 50;

/** The app config this build was made with (embedded by expo-constants), or undefined if it can't be read. */
function builtExtra(): Record<string, unknown> | undefined {
  try {
    const raw = requireOptionalNativeModule<{ manifest?: unknown }>("ExponentConstants")?.manifest;
    const config = typeof raw === "string" ? JSON.parse(raw) : raw;
    if (!config || typeof config !== "object") return undefined;
    return ((config as { extra?: Record<string, unknown> }).extra ?? {}) as Record<string, unknown>;
  } catch {
    return undefined;
  }
}

function readGoogleConfig() {
  const extra = (Constants.expoConfig?.extra ?? {}) as Record<string, unknown>;
  const built = builtExtra();
  return {
    platform: Platform.OS,
    nativeModule: requireOptionalNativeModule("ClerkGoogleSignIn") != null,
    // Same order as Clerk's hook: app config extra first, then the env.
    webClientId: extra.EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID || process.env.EXPO_PUBLIC_CLERK_GOOGLE_WEB_CLIENT_ID,
    iosClientId: extra.EXPO_PUBLIC_CLERK_GOOGLE_IOS_CLIENT_ID || process.env.EXPO_PUBLIC_CLERK_GOOGLE_IOS_CLIENT_ID,
    iosUrlScheme: extra.EXPO_PUBLIC_CLERK_GOOGLE_IOS_URL_SCHEME || process.env.EXPO_PUBLIC_CLERK_GOOGLE_IOS_URL_SCHEME,
    builtIosUrlScheme: built === undefined ? undefined : (built.EXPO_PUBLIC_CLERK_GOOGLE_IOS_URL_SCHEME ?? null),
  };
}

/** Which buttons to show. Null until iOS answers whether Sign in with Apple is available. */
export function useSignInOptions(): SignInOptions | null {
  const [appleAvailable, setAppleAvailable] = useState<boolean | null>(Platform.OS === "ios" ? null : false);

  useEffect(() => {
    if (Platform.OS !== "ios") return;
    let live = true;
    // False on a build without expo-apple-authentication, so the button hides there.
    AppleAuthentication.isAvailableAsync()
      .then((ok) => live && setAppleAvailable(ok))
      .catch(() => live && setAppleAvailable(false));
    return () => {
      live = false;
    };
  }, []);

  if (appleAvailable === null) return null;
  return signInOptions({ platform: Platform.OS, appleAvailable, google: readGoogleConfig() });
}

export function AppleSignInButton({ onPress, disabled }: { onPress: () => void; disabled: boolean }) {
  const scheme = useColorScheme();
  return (
    <View pointerEvents={disabled ? "none" : "auto"} style={{ opacity: disabled ? 0.5 : 1 }}>
      <AppleAuthentication.AppleAuthenticationButton
        buttonType={AppleAuthentication.AppleAuthenticationButtonType.CONTINUE}
        buttonStyle={
          scheme === "dark"
            ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
            : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
        }
        cornerRadius={SIGN_IN_BUTTON_HEIGHT / 2}
        style={{ width: "100%", height: SIGN_IN_BUTTON_HEIGHT }}
        onPress={onPress}
      />
    </View>
  );
}

/** Google's standard multi-color "G". Google's brand rules: never recolor or redraw it. */
function GoogleG({ size }: { size: number }) {
  return (
    <Svg width={size} height={size} viewBox="0 0 48 48" accessibilityElementsHidden importantForAccessibility="no">
      <Path
        fill="#EA4335"
        d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"
      />
      <Path
        fill="#4285F4"
        d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"
      />
      <Path
        fill="#FBBC05"
        d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"
      />
      <Path
        fill="#34A853"
        d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"
      />
    </Svg>
  );
}

// Google's sign-in button colors (Sign in with Google branding guidelines).
const GOOGLE = {
  light: { fill: "#FFFFFF", stroke: "#747775", text: "#1F1F1F" },
  dark: { fill: "#131314", stroke: "#8E918F", text: "#E3E3E3" },
} as const;

export function GoogleSignInButton({
  onPress,
  loading,
  disabled,
}: {
  onPress: () => void;
  loading: boolean;
  disabled: boolean;
}) {
  const g = useColorScheme() === "dark" ? GOOGLE.dark : GOOGLE.light;
  const inactive = disabled || loading;
  return (
    <Pressable
      onPress={onPress}
      disabled={inactive}
      accessibilityRole="button"
      accessibilityLabel="Continue with Google"
      accessibilityState={{ disabled: inactive, busy: loading }}
      style={({ pressed }) => ({
        minHeight: SIGN_IN_BUTTON_HEIGHT,
        borderRadius: radius.radiusPill,
        backgroundColor: g.fill,
        borderWidth: 1,
        borderColor: g.stroke,
        paddingHorizontal: 12,
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        opacity: inactive ? 0.5 : pressed ? 0.85 : 1,
      })}
    >
      {loading ? (
        <ActivityIndicator color={g.text} />
      ) : (
        <>
          <GoogleG size={20} />
          <Text
            maxFontSizeMultiplier={1.6}
            style={{ color: g.text, fontSize: 17, fontWeight: "500", letterSpacing: 0.25 }}
          >
            Continue with Google
          </Text>
        </>
      )}
    </Pressable>
  );
}
