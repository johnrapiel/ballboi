import { Image } from "expo-image";
import React, { useEffect, useState } from "react";
import { View } from "react-native";

import { Text } from "@/components/ui";
import { radius } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { initials } from "@/lib/onboarding";

/**
 * Round player photo, or their initials on sand when there's no photo
 * (spec: onboarding step 3, "photo skippable with an initials avatar").
 * Initials also stand in when a photo fails to load, so it's never a blank circle.
 * Decorative: the name is always shown or read next to it.
 */
export function Avatar({ name, uri, size = 96 }: { name: string; uri?: string | null; size?: number }) {
  const c = useColors();
  const [failed, setFailed] = useState(false);
  // A new photo gets a fresh try.
  useEffect(() => setFailed(false), [uri]);
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
      {uri && !failed ? (
        <Image source={{ uri }} style={{ width: size, height: size }} contentFit="cover" onError={() => setFailed(true)} />
      ) : (
        // Fixed size inside a fixed circle, so it doesn't scale with Dynamic Type and clip.
        <Text variant="title" allowFontScaling={false} style={{ fontSize: size * 0.38, lineHeight: size * 0.46 }}>
          {initials(name)}
        </Text>
      )}
    </View>
  );
}
