import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import React from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useGetLeague, useGetLeagueInvites } from "@workspace/api-client-react";

import { InviteCard } from "@/components/league/InviteCard";
import { Text } from "@/components/ui";
import { MIN_TAP, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";

// Invite players (spec: Onboarding > Run a league "then a share link";
// approved canvas: Admin · Invite players). Shown right after starting a
// league: the code with copy and share (finding 11).

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
        <View style={{ gap: spacing.space1 }}>
          <Text variant="brushM" accessibilityRole="header">
            Invite players
          </Text>
          <Text tone="inkMuted">{`${name} is ready. Players join with this code or link from the Leagues tab.`}</Text>
        </View>

        <InviteCard leagueName={leagueQ.data?.name ?? "my league"} code={invite?.code ?? null} loading={invitesQ.isLoading} onRetry={() => void invitesQ.refetch()} />
      </ScrollView>
    </>
  );
}
