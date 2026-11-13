// Edit profile (decision 138; canvas W2_EditProfile): one screen of rows
// behind the player card's pencil. Photo, name, level (this row keeps
// "Self-rated", decision 140), home area, plays, free times and home court,
// each opening the editor it always had.

import { Stack, useFocusEffect, useRouter } from "expo-router";
import React, { useCallback } from "react";
import { Pressable, ScrollView, View } from "react-native";

import { useGetMyPlayerCard } from "@workspace/api-client-react";

import { Avatar } from "@/components/Avatar";
import { useEditHeader } from "@/components/profile/editHeader";
import { SettingsRow, SettingsSection } from "@/components/SettingsList";
import { Text } from "@/components/ui";
import { MIN_TAP, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { useProfile } from "@/hooks/useProfile";
import { useScreenBottomInset } from "@/hooks/useScreenBottomInset";
import { photoUrl } from "@/lib/photos";
import { levelRow, playsPill } from "@/lib/playerCard";

export default function EditProfileScreen() {
  const c = useColors();
  const router = useRouter();
  const bottom = useScreenBottomInset();
  const header = useEditHeader("");
  const { profile } = useProfile();
  const cardQ = useGetMyPlayerCard();
  const card = cardQ.data;
  const { refetch } = cardQ;
  // Back from an editor: show what was just saved.
  useFocusEffect(
    useCallback(() => {
      void refetch();
    }, [refetch]),
  );

  const name = profile?.displayName ?? card?.name ?? "";
  const editName = () => router.push("/profile/edit/name");

  return (
    <>
      <Stack.Screen options={header} />
      <ScrollView
        style={{ flex: 1, backgroundColor: c.paper }}
        contentContainerStyle={{ padding: spacing.space4, paddingBottom: bottom.paddingBottom, gap: 20 }}
        scrollIndicatorInsets={bottom.scrollIndicatorInsets}
      >
        <Text variant="headingL" accessibilityRole="header">
          Edit profile
        </Text>

        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.space4 }}>
          <Avatar name={name} uri={photoUrl(profile?.avatarUrl ?? card?.avatarUrl)} size={72} />
          <Pressable
            onPress={editName}
            accessibilityRole="button"
            accessibilityLabel="Change photo"
            style={({ pressed }) => ({ minHeight: MIN_TAP, justifyContent: "center", opacity: pressed ? 0.6 : 1 })}
          >
            <Text style={{ textDecorationLine: "underline" }}>Change photo</Text>
          </Pressable>
        </View>

        <SettingsSection footer="Everything here shows on your player card except your home area. Other players only see your town and an approximate distance.">
          <SettingsRow title="Name" value={name || null} onPress={editName} accessibilityHint="Change your name and photo" />
          <SettingsRow
            title="Level"
            value={profile || card ? levelRow(profile?.rating ?? card?.rating, profile?.ratingSource ?? card?.ratingSource) : null}
            onPress={() => router.push("/profile/edit/level")}
            accessibilityHint="Change your self-rated level"
          />
          <SettingsRow
            title="Home area"
            value={profile ? (profile.homeZip ?? "Not set") : null}
            onPress={() => router.push("/profile/edit/home")}
            accessibilityHint="Change your home area"
          />
          <SettingsRow
            title="Plays"
            value={card ? (playsPill(card.plays) ?? "Not set") : null}
            onPress={() => router.push("/discover/play")}
            accessibilityHint="Singles, doubles, or both"
          />
          <SettingsRow
            title="Free times"
            subtitle={card ? (card.freeSummary ?? "Add when you can play") : null}
            onPress={() => router.push("/availability")}
            accessibilityHint="Opens When you can play"
          />
          <SettingsRow
            title="Home court"
            value={card ? (card.homeCourt ?? "Not set") : null}
            onPress={() => router.push({ pathname: "/courts", params: { mode: "home" } })}
            accessibilityHint="The court you usually play at"
            last
          />
        </SettingsSection>
      </ScrollView>
    </>
  );
}
