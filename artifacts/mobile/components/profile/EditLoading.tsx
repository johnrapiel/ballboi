import React from "react";
import { ActivityIndicator, View } from "react-native";

import { Button, Screen, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";

/**
 * Shown while an Edit profile screen loads what's saved, so Save can never
 * overwrite real values with blanks. On failure, says so and offers a retry.
 */
export function EditLoading({ error, onRetry }: { error: string | null; onRetry: () => void }) {
  const c = useColors();
  return (
    <Screen style={{ justifyContent: "center", alignItems: "center", gap: spacing.space4 }}>
      {error ? (
        <View style={{ gap: spacing.space4, alignItems: "stretch", alignSelf: "stretch" }}>
          <Text tone="danger" accessibilityRole="alert" style={{ textAlign: "center" }}>
            {error}
          </Text>
          <Button label="Try again" variant="secondary" onPress={onRetry} />
        </View>
      ) : (
        <ActivityIndicator color={c.ink} accessibilityLabel="Loading your profile" />
      )}
    </Screen>
  );
}
