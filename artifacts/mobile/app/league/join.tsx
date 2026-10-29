import { useUser } from "@clerk/expo";
import { useQueryClient } from "@tanstack/react-query";
import { useRouter } from "expo-router";
import React, { useState } from "react";
import { Alert, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { getGetLeaguesQueryKey, getGetMyPlayersQueryKey, getInvite, joinLeagueViaInvite } from "@workspace/api-client-react";

import { Button, Text } from "@/components/ui";
import { radius, spacing, type } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { playersLabel } from "@/lib/leagues";

// Join with an invite code (spec: Leagues, joining with a code; design:
// Leagues hierarchy, "invite sheet open"). Opens as a native sheet from the
// "Enter your invite code" row on the Leagues tab. Swipe down to dismiss.

export default function JoinWithCodeSheet() {
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { user } = useUser();
  const queryClient = useQueryClient();
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);

  const playerName =
    user?.fullName?.trim() || user?.firstName?.trim() || user?.primaryEmailAddress?.emailAddress?.split("@")[0] || "Player";

  async function join(cleaned: string) {
    setBusy(true);
    try {
      const result = await joinLeagueViaInvite(cleaned, { playerName });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getGetLeaguesQueryKey().slice(0, 1) }),
        queryClient.invalidateQueries({ queryKey: getGetMyPlayersQueryKey() }),
      ]);
      router.back();
      Alert.alert("You're in", `You joined ${result.league.name}.`);
    } catch {
      Alert.alert("Couldn't join", "Something went wrong joining this league. Try again in a moment.");
    } finally {
      setBusy(false);
    }
  }

  async function lookUp() {
    const cleaned = code.trim().toUpperCase();
    if (!cleaned) return;
    setBusy(true);
    try {
      const invite = await getInvite(cleaned);
      setBusy(false);
      const name = invite.leagueName ?? "this league";
      const players = invite.playerCount != null ? playersLabel(invite.playerCount) : null;
      Alert.alert(`Join ${name}?`, players ? `${players} so far.` : undefined, [
        { text: "Cancel", style: "cancel" },
        { text: "Join", onPress: () => void join(cleaned) },
      ]);
    } catch (e) {
      setBusy(false);
      const status = (e as { status?: number }).status;
      Alert.alert(
        status === 410 ? "This invite has ended" : "That code didn't work",
        status === 410 ? "Ask your organizer for a new invite." : "Check the code and try again.",
      );
    }
  }

  return (
    <View
      style={{
        backgroundColor: c.linen,
        paddingTop: spacing.space6,
        paddingHorizontal: spacing.space6,
        paddingBottom: insets.bottom + spacing.space4,
        gap: spacing.space4,
      }}
    >
      <View style={{ gap: spacing.space2 }}>
        <Text variant="titleItalic" accessibilityRole="header">
          Have an invite code?
        </Text>
        <Text tone="inkMuted">Enter the code your league organizer sent, or just open their link.</Text>
      </View>

      <View style={{ gap: spacing.space2, marginTop: spacing.space1 }}>
        <Text variant="label" tone="inkMuted" importantForAccessibility="no" accessibilityElementsHidden>
          Invite code
        </Text>
        {/* Ticket-style well: sand fill, dashed control border (3:1). */}
        <View
          style={{
            minHeight: 64,
            justifyContent: "center",
            paddingHorizontal: spacing.space4,
            backgroundColor: c.sand,
            borderWidth: 1,
            borderStyle: "dashed",
            borderColor: c.hairlineStrong,
            borderRadius: radius.radiusMd,
          }}
        >
          <TextInput
            value={code}
            onChangeText={setCode}
            accessibilityLabel="Invite code"
            placeholder="BEACON35"
            placeholderTextColor={c.inkMuted}
            autoCapitalize="characters"
            autoCorrect={false}
            autoComplete="off"
            autoFocus
            returnKeyType="go"
            onSubmitEditing={lookUp}
            style={[
              type.bodyStrong,
              {
                minHeight: 44,
                fontSize: 22,
                lineHeight: 28,
                letterSpacing: 5,
                fontVariant: ["lining-nums", "tabular-nums"],
                color: c.ink,
              },
            ]}
          />
        </View>
      </View>

      <Button label="Join league" onPress={lookUp} loading={busy} disabled={!code.trim()} style={{ marginTop: spacing.space2 }} />
    </View>
  );
}
