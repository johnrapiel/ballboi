import { useUser } from "@clerk/expo";
import { Image } from "expo-image";
import { useRouter } from "expo-router";
import React from "react";
import { Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Text } from "@/components/ui";
import { MIN_TAP, radius, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";

/** Initials for the avatar, from the signed-in user's name or email. */
export function useInitials() {
  const { user } = useUser();
  if (user?.firstName) {
    return `${user.firstName[0]}${user.lastName?.[0] ?? ""}`.toUpperCase();
  }
  return user?.emailAddresses?.[0]?.emailAddress?.[0]?.toUpperCase() ?? "?";
}

/** Your photo, or your initials, in a 44pt circle. Opens Profile. */
export function ProfileButton() {
  const c = useColors();
  const router = useRouter();
  const { user } = useUser();
  const initials = useInitials();
  const photo = user?.hasImage ? user.imageUrl : null;

  return (
    <Pressable
      onPress={() => router.push("/profile")}
      accessibilityRole="button"
      accessibilityLabel="Profile"
      hitSlop={4}
      style={({ pressed }) => ({
        width: MIN_TAP,
        height: MIN_TAP,
        borderRadius: radius.radiusPill,
        backgroundColor: c.sand,
        borderWidth: 1,
        borderColor: c.hairline,
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
        opacity: pressed ? 0.7 : 1,
      })}
    >
      {photo ? (
        <Image source={{ uri: photo }} style={{ width: MIN_TAP, height: MIN_TAP }} accessibilityIgnoresInvertColors />
      ) : (
        <Text variant="bodyStrong" importantForAccessibility="no" accessibilityElementsHidden>
          {initials}
        </Text>
      )}
    </Pressable>
  );
}

/** A tab's page: paper background, safe-area top, and the tab header. */
export function TabScreen({ title, children }: { title: string; children: React.ReactNode }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  return (
    <View style={{ flex: 1, backgroundColor: c.paper, paddingTop: insets.top + spacing.space2 }}>
      <TabHeader title={title} />
      {children}
    </View>
  );
}

/**
 * Top of every tab: the tab's name as a large title, with your Profile
 * button in the top-right corner. The title always matches the tab label.
 */
export function TabHeader({ title }: { title: string }) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: spacing.space3,
        paddingHorizontal: spacing.space4,
        paddingBottom: spacing.space3,
      }}
    >
      <Text variant="displayL" accessibilityRole="header" style={{ flexShrink: 1 }}>
        {title}
      </Text>
      <ProfileButton />
    </View>
  );
}
