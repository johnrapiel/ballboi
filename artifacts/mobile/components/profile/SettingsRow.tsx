import { useRouter } from "expo-router";
import React from "react";

import { ListRow } from "@/components/league/ListRow";
import { Card } from "@/components/ui";
import { spacing } from "@/constants/tokens";

/**
 * "Settings" on the Profile tab (Wave 1 review Q14): opens the recording
 * settings, "Help Ball Boi get smarter" and "Upload on cellular". Its own
 * file, like EditProfileRow, so the Profile screen gets a one-line change.
 */
export function SettingsRow() {
  const router = useRouter();
  return (
    <Card style={{ padding: 0, overflow: "hidden", marginBottom: spacing.space3 }}>
      <ListRow
        title="Settings"
        symbol="gearshape"
        onPress={() => router.push("/settings")}
        accessibilityHint="Training and cellular upload"
        last
      />
    </Card>
  );
}
