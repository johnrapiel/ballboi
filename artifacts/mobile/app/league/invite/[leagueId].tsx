import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import React from "react";
import { ScrollView, View } from "react-native";

import { useGetLeague, useGetLeagueInvites } from "@workspace/api-client-react";

import { HeaderIconButton } from "@/components/Choice";
import { InviteCard } from "@/components/league/InviteCard";
import { Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { useScreenBottomInset } from "@/hooks/useScreenBottomInset";

// Invite players (spec: Onboarding > Run a league "then a share link";
// approved canvas: Admin · Invite players). Shown right after starting a
// league: the code with copy and share (finding 11).
//
// Close (X) at the top left, like every sheet (Wave 2 finding 50, decision
// 198); it replaced the Done at the top right. It goes to the Leagues tab.
// Swipe down stays off on this screen, as before this change; the X and the
// VoiceOver escape gesture are the ways out.

export default function InvitePlayersScreen() {
  const c = useColors();
  const router = useRouter();
  const bottom = useScreenBottomInset();
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
          headerLeft: () => <HeaderIconButton symbol="xmark" label="Close" hint="Goes to Leagues" onPress={done} />,
        }}
      />
      <ScrollView
        onAccessibilityEscape={done}
        style={{ flex: 1, backgroundColor: c.paper }}
        contentContainerStyle={{ padding: spacing.space4, paddingBottom: bottom.paddingBottom, gap: spacing.space6 }}
        scrollIndicatorInsets={bottom.scrollIndicatorInsets}
      >
        <View style={{ gap: spacing.space1 }}>
          <Text variant="headingM" accessibilityRole="header">
            Invite players
          </Text>
          <Text tone="inkMuted">{`${name} is ready. Players join with this code or link from the Leagues tab.`}</Text>
        </View>

        <InviteCard leagueName={leagueQ.data?.name ?? "my league"} code={invite?.code ?? null} loading={invitesQ.isLoading} onRetry={() => void invitesQ.refetch()} />
      </ScrollView>
    </>
  );
}
