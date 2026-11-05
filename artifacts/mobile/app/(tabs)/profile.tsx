import { useAuth, useUser } from "@clerk/expo";
import { Ionicons } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import { useRouter } from "expo-router";
import React from "react";
import {
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Avatar } from "@/components/Avatar";
import { RatingBadge } from "@/components/RatingBadge";
import { BlockedPlayersRow } from "@/components/safety/BlockedPlayersRow";
import { TabScreen } from "@/components/TabHeader";
import { EditProfileRow } from "@/components/profile/EditProfileRow";
import { MatchRemindersRow } from "@/components/profile/MatchRemindersRow";
import { SettingsRow } from "@/components/profile/SettingsRow";
import { Text as UIText } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { useProfile } from "@/hooks/useProfile";
import { confirmSignOut } from "@/lib/confirmSignOut";
import { photoUrl } from "@/lib/photos";

export default function ProfileScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { signOut } = useAuth();
  const { user } = useUser();
  const router = useRouter();
  // A1: the header shows the saved profile (name, photo, level), reloaded each
  // time the tab comes into focus, so an Edit profile save shows right away.
  const { profile } = useProfile();

  const bottomPad = Platform.OS === "web" ? 34 : insets.bottom;

  const handleSignOut = async () => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    if (!(await confirmSignOut(signOut))) return;
    router.replace("/(auth)/welcome");
  };

  const styles = StyleSheet.create({
    container: {
      flex: 1,
      backgroundColor: colors.background,
    },
    scroll: {
      flex: 1,
    },
    scrollContent: {
      paddingHorizontal: 20,
      paddingTop: 8,
      paddingBottom: bottomPad + 96,
    },
    avatarRow: {
      flexDirection: "row",
      alignItems: "center",
      gap: 16,
      marginBottom: 32,
    },
    userInfo: {
      flex: 1,
      gap: spacing.space1,
    },
    section: {
      marginBottom: 24,
    },
    sectionLabel: {
      fontSize: 13,
      fontWeight: "600" as const,
      color: colors.mutedForeground,
      letterSpacing: 0.8,
      textTransform: "uppercase",
      marginBottom: 12,
      fontFamily: "DMSans_600SemiBold",
    },
    card: {
      backgroundColor: colors.card,
      borderWidth: 1,
      borderColor: colors.border,
      borderRadius: colors.radius + 2,
      overflow: "hidden",
    },
    row: {
      flexDirection: "row",
      alignItems: "center",
      padding: 16,
      gap: 14,
    },
    rowBorder: {
      borderTopWidth: 1,
      borderTopColor: colors.border,
    },
    rowIconWrap: {
      width: 36,
      height: 36,
      borderRadius: 10,
      alignItems: "center",
      justifyContent: "center",
    },
    rowText: {
      flex: 1,
      fontSize: 15,
      color: colors.foreground,
      fontFamily: "DMSans_500Medium",
    },
    rowSubtext: {
      fontSize: 13,
      color: colors.mutedForeground,
      fontFamily: "DMSans_400Regular",
    },
    signOutBtn: {
      backgroundColor: colors.destructive + "22",
      borderWidth: 1,
      borderColor: colors.destructive + "44",
      borderRadius: colors.radius + 2,
      padding: 16,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 10,
      marginTop: 8,
    },
    deleteRow: {
      minHeight: 44,
      alignItems: "center",
      justifyContent: "center",
      marginTop: 12,
    },
    deleteText: {
      fontSize: 15,
      color: colors.destructive,
      fontFamily: "DMSans_500Medium",
    },
    signOutText: {
      fontSize: 15,
      fontWeight: "600" as const,
      color: colors.destructive,
      fontFamily: "DMSans_600SemiBold",
    },
  });

  // Until the profile loads, the Clerk name (never part of the email).
  const displayName = profile?.displayName?.trim() || user?.fullName?.trim() || "";

  return (
    <TabScreen title="Profile">
      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.scrollContent}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.avatarRow}>
          <Avatar name={displayName} uri={photoUrl(profile?.avatarUrl)} size={72} />
          <View style={styles.userInfo}>
            <UIText variant="title" accessibilityRole="header">
              {displayName}
            </UIText>
            <UIText variant="small" tone="inkMuted">
              {user?.primaryEmailAddress?.emailAddress ?? ""}
            </UIText>
            {profile?.rating != null ? (
              <View style={{ marginTop: spacing.space1 }}>
                <RatingBadge rating={profile.rating} source={profile.ratingSource ?? "self"} />
              </View>
            ) : null}
          </View>
        </View>

        {Platform.OS !== "web" ? (
          <View style={styles.section}>
            <Text style={styles.sectionLabel}>Notifications</Text>
            <MatchRemindersRow enabled={profile ? profile.matchRemindersEnabled : null} />
          </View>
        ) : null}

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>About</Text>
          <View style={styles.card}>
            <View style={styles.row}>
              <View style={[styles.rowIconWrap, { backgroundColor: colors.primary + "22" }]}>
                <Ionicons name="tennisball" size={18} color={colors.primary} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowText}>Ball Boi Mobile</Text>
                <Text style={styles.rowSubtext}>Match replay companion</Text>
              </View>
            </View>
            <View style={[styles.row, styles.rowBorder]}>
              <View style={[styles.rowIconWrap, { backgroundColor: colors.muted }]}>
                <Ionicons name="information-circle" size={18} color={colors.mutedForeground} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowText}>Version</Text>
                <Text style={styles.rowSubtext}>1.0.0</Text>
              </View>
            </View>
          </View>
        </View>

        <View style={styles.section}>
          <Text style={styles.sectionLabel}>Account</Text>
          <EditProfileRow />
          <SettingsRow />
          <BlockedPlayersRow />
          <Pressable
            style={({ pressed }) => [styles.signOutBtn, { opacity: pressed ? 0.7 : 1 }]}
            onPress={handleSignOut}
            accessibilityRole="button"
            accessibilityLabel="Sign out"
          >
            <Ionicons name="log-out-outline" size={20} color={colors.destructive} />
            <Text style={styles.signOutText}>Sign out</Text>
          </Pressable>
          <Pressable
            style={({ pressed }) => [styles.deleteRow, { opacity: pressed ? 0.7 : 1 }]}
            onPress={() => router.push("/delete-account")}
            accessibilityRole="button"
            accessibilityLabel="Delete account"
          >
            <Text style={styles.deleteText}>Delete account</Text>
          </Pressable>
        </View>
      </ScrollView>
    </TabScreen>
  );
}
