import { reloadAppAsync } from "expo";
import React, { useState } from "react";
import { View } from "react-native";

import { Button, Card, ScrollScreen, Text, TextButton } from "@/components/ui";
import { spacing } from "@/constants/tokens";

// Shown when a screen crashes (Wave 1 review A16). One plain message and one
// button that reloads the app. Development builds can also show the error.

export type ErrorFallbackProps = {
  error: Error;
  resetError: () => void;
};

export function ErrorFallback({ error, resetError }: ErrorFallbackProps) {
  const [showDetails, setShowDetails] = useState(false);
  const [reloading, setReloading] = useState(false);

  const reload = async () => {
    setReloading(true);
    try {
      await reloadAppAsync();
    } catch (restartError) {
      console.error("Failed to restart app:", restartError);
      setReloading(false);
      resetError();
    }
  };

  return (
    <ScrollScreen style={{ justifyContent: "center", gap: spacing.space6 }}>
      <Text variant="title" accessibilityRole="header">
        Something went wrong.
      </Text>
      <Button label="Reload Ball Boi" loading={reloading} onPress={reload} />

      {__DEV__ ? (
        <View style={{ gap: spacing.space3 }}>
          <TextButton
            label={showDetails ? "Hide error details" : "Show error details"}
            onPress={() => setShowDetails((v) => !v)}
          />
          {showDetails ? (
            <Card>
              <Text variant="small" selectable>
                {`Error: ${error.message}${error.stack ? `\n\n${error.stack}` : ""}`}
              </Text>
            </Card>
          ) : null}
        </View>
      ) : null}
    </ScrollScreen>
  );
}
