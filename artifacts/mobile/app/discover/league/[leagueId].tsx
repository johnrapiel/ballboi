import {
  getGetDiscoverLeagueQueryKey,
  getGetDiscoverLeaguesQueryKey,
  getGetMyJoinRequestsQueryKey,
  useGetDiscoverLeague,
  useRequestToJoinLeague,
  useWithdrawLeagueJoinRequest,
  type JoinRequest,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import { SymbolView, type SFSymbol } from "expo-symbols";
import React from "react";
import { AccessibilityInfo, ActivityIndicator, Alert, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { Button, Card, Chip, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { useProfile } from "@/hooks/useProfile";
import { FORMAT_LABEL, joinButtonLabel, leagueTag, shortDay } from "@/lib/discover";
import { weeklyMatchTime } from "@/lib/leagueSchedule";

// An Open league's preview from Discover (spec: Discover, "Joining an Open
// league: request a spot before the season starts, admin approves. Once the
// season starts the league locks to new joins; full and locked leagues hold
// requests on a waitlist for next season"). The admin approves in Manage.

function Fact({ symbol, label, value }: { symbol: SFSymbol; label: string; value: string }) {
  const c = useColors();
  return (
    <View
      accessible
      accessibilityLabel={`${label}: ${value}`}
      style={{ flexDirection: "row", alignItems: "center", gap: spacing.space3, minHeight: 32 }}
    >
      <SymbolView name={symbol} size={18} tintColor={c.inkMuted} />
      <View style={{ flex: 1 }}>
        <Text variant="small" tone="inkMuted">
          {label}
        </Text>
        <Text>{value}</Text>
      </View>
    </View>
  );
}

export default function DiscoverLeagueScreen() {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const queryClient = useQueryClient();
  const { profile } = useProfile();
  const { leagueId: raw } = useLocalSearchParams<{ leagueId: string }>();
  const leagueId = Number(raw);
  const query = useGetDiscoverLeague(leagueId, {
    query: { enabled: Number.isInteger(leagueId), retry: false, queryKey: getGetDiscoverLeagueQueryKey(leagueId) },
  });
  const request = useRequestToJoinLeague();
  const withdraw = useWithdrawLeagueJoinRequest();
  const l = query.data;

  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: getGetDiscoverLeagueQueryKey(leagueId) }),
      queryClient.invalidateQueries({ queryKey: getGetDiscoverLeaguesQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getGetMyJoinRequestsQueryKey() }),
    ]);

  const ask = () => {
    if (!l) return;
    // The server uses the profile's name and level; these are only a fallback.
    request.mutate(
      { leagueId, data: { playerName: profile?.displayName ?? "", skillLevel: null } },
      {
        onSuccess: (r: JoinRequest) => {
          void refresh();
          const said = r.message ?? (r.kind === "waitlist" ? "You're on the waitlist for next season." : "Request sent.");
          AccessibilityInfo.announceForAccessibility(said);
          Alert.alert(r.kind === "waitlist" ? "You're on the waitlist" : "Request sent", said);
        },
        onError: (e) => {
          const message = (e as { data?: { error?: string } }).data?.error;
          Alert.alert("Request not sent", message ?? "Check your connection and try again.");
        },
      },
    );
  };

  const cancel = () => {
    if (!l) return;
    const waitlist = l.myRequest === "waitlist";
    Alert.alert(waitlist ? "Leave the waitlist?" : "Withdraw your request?", `${l.name}'s admin won't see it anymore.`, [
      { text: "Keep it", style: "cancel" },
      {
        text: waitlist ? "Leave waitlist" : "Withdraw",
        style: "destructive",
        onPress: () =>
          withdraw.mutate(
            { leagueId },
            {
              onSuccess: () => void refresh(),
              onError: () => Alert.alert("Couldn't withdraw", "Check your connection and try again."),
            },
          ),
      },
    ]);
  };

  if (query.isPending && Number.isInteger(leagueId))
    return (
      <View style={{ flex: 1, backgroundColor: c.paper }}>
        <ActivityIndicator style={{ marginTop: spacing.space12 }} color={c.ink} accessibilityLabel="Loading league" />
      </View>
    );

  if (!l)
    return (
      <View style={{ flex: 1, backgroundColor: c.paper, padding: spacing.space6, gap: spacing.space4, alignItems: "center" }}>
        <Text tone="inkMuted" style={{ textAlign: "center" }} accessibilityLiveRegion="polite">
          {query.error && (query.error as { status?: number }).status !== 404
            ? "This league didn't load. Check your connection and try again."
            : "This league isn't in Discover right now."}
        </Text>
        <Button label="Try again" variant="secondary" onPress={() => void query.refetch()} />
      </View>
    );

  const season = [
    l.startDate ? shortDay(l.startDate, true) : null,
    l.endDate ? `to ${shortDay(l.endDate, true)}` : null,
    l.seasonWeeks ? `(${l.seasonWeeks} ${l.seasonWeeks === 1 ? "week" : "weeks"})` : null,
  ]
    .filter(Boolean)
    .join(" ");
  const players = l.rosterCap ? `${l.players} of ${l.rosterCap}` : String(l.players);
  const setTime = weeklyMatchTime(l.matchDay, l.matchTime, l.timeZone);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: c.paper }}
      contentContainerStyle={{ padding: spacing.space4, paddingBottom: insets.bottom + spacing.space6, gap: spacing.space4 }}
    >
      <View style={{ gap: spacing.space2 }}>
        <Text variant="displayL" accessibilityRole="header">
          {l.name}
        </Text>
        <Chip label={leagueTag(l)} />
        {l.adminName ? <Text tone="inkMuted">Run by {l.adminName}</Text> : null}
      </View>

      {l.description ? <Text>{l.description}</Text> : null}

      <Card style={{ gap: spacing.space3 }}>
        <Fact symbol="location" label="Distance" value={l.distanceLabel} />
        <Fact symbol="chart.bar" label="Level" value={l.levelRange} />
        <Fact symbol="arrow.triangle.2.circlepath" label="Format" value={FORMAT_LABEL[l.format]} />
        {season ? <Fact symbol="calendar" label="Season" value={season} /> : null}
        {setTime ? <Fact symbol="clock" label="Match time" value={setTime} /> : null}
        <Fact symbol="person.2" label="Players" value={players} />
        {l.playoffSize ? <Fact symbol="trophy" label="Playoffs" value={`Top ${l.playoffSize}`} /> : null}
      </Card>

      {l.myRequest ? (
        <View style={{ gap: spacing.space2 }}>
          <Text style={{ textAlign: "center" }} accessibilityLiveRegion="polite">
            {l.myRequest === "waitlist"
              ? "You're on the waitlist for next season."
              : "You asked to join. You'll hear back when the admin approves it."}
          </Text>
          <Button
            label={l.myRequest === "waitlist" ? "Leave the waitlist" : "Withdraw request"}
            variant="secondary"
            loading={withdraw.isPending}
            onPress={cancel}
          />
        </View>
      ) : (
        <View style={{ gap: spacing.space2 }}>
          <Button label={joinButtonLabel(l)} loading={request.isPending} onPress={ask} />
          <Text variant="small" tone="inkMuted" style={{ textAlign: "center" }}>
            {l.joining === "join"
              ? "The admin approves each request."
              : "The season has started or the league is full, so you'll be on the list for next season."}
          </Text>
        </View>
      )}
    </ScrollView>
  );
}
