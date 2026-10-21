import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import React from "react";
import { ActivityIndicator, Pressable, ScrollView, Share, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useGetLeague, useGetLeagueInvites } from "@workspace/api-client-react";

import { Button, Card, Text } from "@/components/ui";
import { MIN_TAP, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";

// Invite players (spec: Onboarding > Run a league "then a share link";
// canvas: Admin · Invite players). Shown right after starting a league.

export default function InvitePlayersScreen() {
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { leagueId: raw } = useLocalSearchParams<{ leagueId: string }>();
  const leagueId = Number(raw);

  const leagueQ = useGetLeague(leagueId);
  const invitesQ = useGetLeagueInvites(leagueId);
  const invite = invitesQ.data?.find((i) => i.isActive);
  const name = leagueQ.data?.name ?? "your league";

  const done = () => router.dismissTo("/(tabs)/leagues");

  async function share() {
    if (!invite) return;
    await Share.share({
      message: `Join ${name} on Ball Boi. Open the app, go to Leagues, and enter code ${invite.code}.`,
    });
  }

  return (
    <>
      <Stack.Screen
        options={{
          headerLeft: () => null,
          headerRight: () => (
            <Pressable
              onPress={done}
              accessibilityRole="button"
              accessibilityLabel="Done"
              hitSlop={8}
              style={{ minHeight: MIN_TAP, minWidth: MIN_TAP, justifyContent: "center", alignItems: "flex-end" }}
            >
              <Text variant="bodyStrong">Done</Text>
            </Pressable>
          ),
        }}
      />
      <ScrollView
        style={{ flex: 1, backgroundColor: c.paper }}
        contentContainerStyle={{ padding: spacing.space4, paddingBottom: insets.bottom + spacing.space8, gap: spacing.space6 }}
      >
        <View style={{ gap: spacing.space2 }}>
          <Text variant="label" tone="inkMuted">
            {name}
          </Text>
          <Text variant="displayL" accessibilityRole="header">
            Invite players
          </Text>
          <Text tone="inkMuted">Your league is ready. Share the code so players can join from the Leagues tab.</Text>
        </View>

        <Card style={{ alignItems: "center", gap: spacing.space4, paddingVertical: spacing.space6 }}>
          <Text variant="label" tone="inkMuted">
            Invite code
          </Text>
          {invitesQ.isLoading ? (
            <ActivityIndicator color={c.ink} accessibilityLabel="Loading invite code" />
          ) : invite ? (
            <Text
              variant="displayL"
              selectable
              accessibilityLabel={`Invite code ${invite.code.split("").join(" ")}`}
              style={{ letterSpacing: 4, textAlign: "center" }}
            >
              {invite.code}
            </Text>
          ) : (
            <Text tone="inkMuted" style={{ textAlign: "center" }}>
              Couldn't load the invite code. Pull down on Leagues and open the league to try again.
            </Text>
          )}
          <Button label="Share" onPress={share} disabled={!invite} style={{ alignSelf: "stretch" }} />
        </Card>
      </ScrollView>
    </>
  );
}
