// Edit profile (decision 138; canvas W2_EditProfile): one screen of rows
// behind the player card's pencil. Photo, name, level (this row keeps
// "Self-rated", decision 140), home area, plays, free times and home court,
// each opening the editor it always had. Change photo opens the photo picker
// itself, the same one Name and photo uses, and saves the photo it picks
// (Wave 2 finding 52, canvas G10).

import { useQueryClient } from "@tanstack/react-query";
import { Stack, useFocusEffect, useRouter } from "expo-router";
import React, { useCallback, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Alert, Pressable, ScrollView, View } from "react-native";

import { useGetMyPlayerCard } from "@workspace/api-client-react";

import { Avatar } from "@/components/Avatar";
import { useEditHeader } from "@/components/profile/editHeader";
import { SettingsRow, SettingsSection } from "@/components/SettingsList";
import { Text } from "@/components/ui";
import { MIN_TAP, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { useProfile } from "@/hooks/useProfile";
import { useScreenBottomInset } from "@/hooks/useScreenBottomInset";
import { useStableGetToken } from "@/hooks/useStableGetToken";
import { isOfflineError, OFFLINE_MESSAGE } from "@/lib/api";
import { saveNameAndPhoto, uploadPhoto } from "@/lib/onboarding";
import { photoUrl } from "@/lib/photos";
import { pickProfilePhoto } from "@/lib/pickPhoto";
import { levelRow, playsPill } from "@/lib/playerCard";

export default function EditProfileScreen() {
  const c = useColors();
  const router = useRouter();
  const bottom = useScreenBottomInset();
  const header = useEditHeader("");
  const { profile, reload } = useProfile();
  const getToken = useStableGetToken();
  const queryClient = useQueryClient();
  // The photo just picked, shown while it uploads.
  const [uploading, setUploading] = useState<string | null>(null);
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

  // Change photo: the picker opens here, and the photo saves as soon as it's
  // picked. The name stays what it is.
  async function changePhoto() {
    if (!profile || uploading) return;
    const asset = await pickProfilePhoto();
    if (!asset) return;
    setUploading(asset.uri);
    try {
      const avatarUrl = await uploadPhoto(getToken, asset);
      await saveNameAndPhoto(getToken, { displayName: profile.displayName || name, avatarUrl }, true);
      // The new photo shows everywhere: every screen's data refetches.
      void queryClient.invalidateQueries();
      reload();
      AccessibilityInfo.announceForAccessibility("Photo saved");
    } catch (e) {
      Alert.alert(
        "Couldn't save your photo",
        isOfflineError(e) ? OFFLINE_MESSAGE : e instanceof Error ? e.message : "Try again.",
      );
    } finally {
      setUploading(null);
    }
  }

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
          <Avatar name={name} uri={uploading ?? photoUrl(profile?.avatarUrl ?? card?.avatarUrl)} size={72} />
          <Pressable
            onPress={() => void changePhoto()}
            disabled={!profile || !!uploading}
            accessibilityRole="button"
            accessibilityLabel="Change photo"
            accessibilityHint="Opens your photos"
            accessibilityState={{ disabled: !profile, busy: !!uploading }}
            style={({ pressed }) => ({
              minHeight: MIN_TAP,
              flexDirection: "row",
              alignItems: "center",
              gap: spacing.space2,
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Text style={{ textDecorationLine: "underline" }}>Change photo</Text>
            {uploading ? <ActivityIndicator color={c.ink} accessibilityLabel="Saving your photo" /> : null}
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
            // Like the card's Free times, no "Most of the week" summary
            // (finding 17): only the prompt when none are set.
            subtitle={card && !card.freeSummary ? "Add when you can play" : null}
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
