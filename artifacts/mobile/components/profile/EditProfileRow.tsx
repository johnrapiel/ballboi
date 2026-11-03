import { useRouter } from "expo-router";
import React from "react";

import { ListRow } from "@/components/league/ListRow";
import { Card } from "@/components/ui";
import { spacing } from "@/constants/tokens";

/**
 * "Edit profile" on the Profile tab, above Sign out (Wave 1 review A5): a
 * 52pt row with a chevron that opens the Edit profile list. Lives in its own
 * file so the Profile screen gets a one-line change; Session H keeps it when
 * the Profile screen is rebuilt in Wave 2.
 */
export function EditProfileRow() {
  const router = useRouter();
  return (
    <Card style={{ padding: 0, overflow: "hidden", marginBottom: spacing.space3 }}>
      <ListRow
        title="Edit profile"
        symbol="person.crop.circle"
        onPress={() => router.push("/profile/edit")}
        accessibilityHint="Change your name and photo, home area, or level"
        last
      />
    </Card>
  );
}
