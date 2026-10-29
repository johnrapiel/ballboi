// Delete account, opened from Profile.
// Spec: Navigation (Profile holds account deletion) and App Store implications,
// "Account deletion" (guideline 5.1.1(v)). Deletes data, never just deactivates.
// Standard iOS pattern: an explanation screen, a red button, then a native
// confirmation alert. Destructive actions are red and confirmed (CLAUDE.md).

import { useAuth } from "@clerk/expo";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import { Alert, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, Card, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { apiErrorMessage, apiFetch } from "@/lib/api";

const DELETED = [
  "Your sign-in, so you can't sign back in to this account",
  "Your profile, photo, and contact details",
  "The video of every match you recorded with Ball Boi",
  "Your availability, location, and notification settings",
];

const KEPT = [
  "Scores from league matches you played stay in your opponents' history, listed as \"Deleted player.\"",
  "Opponents keep their replay and stats from matches you recorded. Your video is still deleted.",
];

function List({ title, items }: { title: string; items: string[] }) {
  return (
    <Card style={{ gap: spacing.space3 }}>
      <Text variant="label" accessibilityRole="header">
        {title}
      </Text>
      {items.map((item) => (
        <View key={item} style={{ flexDirection: "row", gap: spacing.space2 }} accessible accessibilityLabel={item}>
          <Text tone="inkMuted" importantForAccessibility="no">
            {"•"}
          </Text>
          <Text style={{ flex: 1 }}>{item}</Text>
        </View>
      ))}
    </Card>
  );
}

export default function DeleteAccountScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const { getToken, signOut } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function deleteAccount() {
    setError(null);
    setBusy(true);
    try {
      const res = await apiFetch("/api/users/me", getToken, {
        method: "DELETE",
        body: JSON.stringify({ confirm: "DELETE" }),
      });
      if (!res.ok) {
        setError(await apiErrorMessage(res, "We couldn't delete your account. Try again."));
        return;
      }
      // The server already deleted the sign-in; clear the local session too.
      await signOut().catch(() => undefined);
      router.replace("/(auth)/welcome");
    } catch {
      setError("We couldn't reach Ball Boi. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  function confirm() {
    Alert.alert("Delete your account?", "This can't be undone.", [
      { text: "Cancel", style: "cancel" },
      { text: "Delete", style: "destructive", onPress: deleteAccount },
    ]);
  }

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.paper }}
      contentContainerStyle={{
        padding: spacing.space4,
        paddingBottom: insets.bottom + spacing.space8,
        gap: spacing.space6,
      }}
    >
      <Text>This permanently deletes your Ball Boi account. You can't undo it.</Text>

      <List title="What's deleted" items={DELETED} />
      <List title="What stays" items={KEPT} />

      {error ? (
        <Text tone="danger" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}

      <Button label="Delete account" variant="destructive" loading={busy} onPress={confirm} />
    </ScrollView>
  );
}
