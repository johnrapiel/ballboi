import { useAuth } from "@clerk/expo";
import { Image } from "expo-image";
import React, { useEffect, useState } from "react";
import { View } from "react-native";

import { Text } from "@/components/ui";
import { radius } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { initials } from "@/lib/onboarding";
import { isApiPhoto, photoSource } from "@/lib/photos";

/**
 * Round player photo, or their initials on sand when there's no photo
 * (spec: onboarding step 3, "photo skippable with an initials avatar").
 * Initials also stand in when a photo fails to load, so it's never a blank circle.
 * Decorative: the name is always shown or read next to it.
 * Photos from the API need sign-in (A17), so the request carries the session
 * token; initials show until it's ready.
 */
export function Avatar({ name, uri, size = 96 }: { name: string; uri?: string | null; size?: number }) {
  const c = useColors();
  const { getToken } = useAuth();
  const [failed, setFailed] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const needsToken = !!uri && isApiPhoto(uri);
  // A new photo gets a fresh try.
  useEffect(() => setFailed(false), [uri]);
  useEffect(() => {
    if (!needsToken) return;
    let live = true;
    getToken()
      .then((t) => live && setToken(t))
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
  }, [needsToken, uri, getToken]);
  const source = uri ? photoSource(uri, token) : null;
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        width: size,
        height: size,
        borderRadius: radius.radiusPill,
        backgroundColor: c.sand,
        borderWidth: 1,
        borderColor: c.hairline,
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      {source && !failed ? (
        <Image source={source} style={{ width: size, height: size }} contentFit="cover" onError={() => setFailed(true)} />
      ) : (
        // Fixed size inside a fixed circle, so it doesn't scale with Dynamic Type and clip.
        <Text variant="title" allowFontScaling={false} style={{ fontSize: size * 0.38, lineHeight: size * 0.46 }}>
          {initials(name)}
        </Text>
      )}
    </View>
  );
}
