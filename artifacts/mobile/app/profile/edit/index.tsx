// Profile > Edit profile (Wave 1 review A5, A6). A grouped list of the three
// things set during onboarding, each with its current value. Each row opens
// the matching onboarding screen in edit mode. Values reload when you come
// back, so a Save shows up here right away.

import { Stack, useRouter } from "expo-router";
import React from "react";
import { ScrollView, View } from "react-native";

import { ListRow } from "@/components/league/ListRow";
import { EditLoading } from "@/components/profile/EditLoading";
import { useEditHeader } from "@/components/profile/editHeader";
import { Card, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { useProfile } from "@/hooks/useProfile";
import { formatRating, type Profile } from "@/lib/onboarding";

function levelValue(p: Profile): string {
  if (p.rating == null) return "Not set";
  return `${formatRating(p.rating)}, ${p.ratingSource === "verified" ? "Verified" : "Self-rated"}`;
}

export default function EditProfileList() {
  const c = useColors();
  const router = useRouter();
  const header = useEditHeader("Edit profile");
  const { profile, error, reload } = useProfile();

  return (
    <>
      <Stack.Screen options={header} />
      {!profile ? (
        <EditLoading error={error} onRetry={reload} />
      ) : (
        <ScrollView
          style={{ flex: 1, backgroundColor: c.paper }}
          contentInsetAdjustmentBehavior="automatic"
          contentContainerStyle={{ padding: spacing.space4, gap: spacing.space3 }}
        >
          <Card style={{ padding: 0, overflow: "hidden" }}>
            <ListRow
              title="Name and photo"
              subtitle={`${profile.displayName}${profile.avatarUrl ? "" : ", initials only"}`}
              onPress={() => router.push("/profile/edit/name")}
              accessibilityHint="Opens your name and photo"
            />
            <ListRow
              title="Home area"
              subtitle={profile.homeZip ?? "Not set"}
              onPress={() => router.push("/profile/edit/home")}
              accessibilityHint="Opens your home area"
            />
            <ListRow
              title="Your level"
              subtitle={levelValue(profile)}
              onPress={() => router.push("/profile/edit/level")}
              accessibilityHint="Opens your level"
              last
            />
          </Card>
          <View style={{ paddingHorizontal: spacing.space1 }}>
            <Text variant="small" tone="inkMuted">
              Your name, photo and level show on your player card. Your home area is never shown, only an approximate distance.
            </Text>
          </View>
        </ScrollView>
      )}
    </>
  );
}
