import { useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams } from "expo-router";
import React from "react";
import { AccessibilityInfo, ActivityIndicator, Alert, View } from "react-native";

import { getGetMyPartnerQueryKey, useGetMyPartner, useRequestPartner } from "@workspace/api-client-react";

import { ListRow } from "@/components/league/ListRow";
import { SheetBody, useSheetClose } from "@/components/Sheet";
import { Button, Card, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { levelSpoken } from "@/lib/onboarding";

// Team up with someone (doubles flow review D9, John, Nov 9; titled to match
// its button in the Team up sheet, finding 31): members of this
// fixed-partner league without a partner, by name, with their level. Tap one
// to ask; they get Accept and Decline and 48 hours to answer. Someone you
// have a block with is never listed, either way. Nothing is typed here, so
// closing never asks.

export default function TeamUpSheet() {
  const c = useColors();
  const { leagueId: raw } = useLocalSearchParams<{ leagueId: string }>();
  const leagueId = Number(raw);
  const queryClient = useQueryClient();
  const q = useGetMyPartner(leagueId);
  const request = useRequestPartner();
  const sheet = useSheetClose(false);
  const v = q.data;

  const ask = (playerId: number, name: string) =>
    Alert.alert(`Ask ${name} to team up?`, `${name} gets a request with Accept and Decline, and has 48 hours to answer.`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Send request",
        onPress: () =>
          request
            .mutateAsync({ leagueId, data: { toPlayerId: playerId } })
            .then((view) => {
              queryClient.setQueryData(getGetMyPartnerQueryKey(leagueId), view);
              AccessibilityInfo.announceForAccessibility(`Request sent to ${name}`);
              sheet.finish();
            })
            .catch((e) => Alert.alert("Couldn't send the request", (e as { data?: { error?: string } | null }).data?.error ?? "Try again in a moment.")),
      },
    ]);

  let body: React.ReactNode;
  if (q.isLoading) {
    body = <ActivityIndicator color={c.ink} accessibilityLabel="Loading players" />;
  } else if (q.isError || !v) {
    body = (
      <View style={{ gap: spacing.space3 }}>
        <Text tone="inkMuted">Couldn't load the players. Check your connection and try again.</Text>
        <Button label="Try again" variant="secondary" onPress={() => void q.refetch()} />
      </View>
    );
  } else if (!v.teamingOpen) {
    body = <Text tone="inkMuted">Teaming up closed when the first round went out. Your league admin can team you up in Manage league.</Text>;
  } else if (v.partner) {
    body = <Text tone="inkMuted">{`You're already teamed up with ${v.partner.name}.`}</Text>;
  } else if (v.outgoing) {
    body = <Text tone="inkMuted">{`You already asked ${v.outgoing.to.name}. To ask someone else, cancel that request in Team up on the league page.`}</Text>;
  } else if (v.candidates.length === 0) {
    body = (
      <Text tone="inkMuted">
        Everyone else has a partner, or nobody else has joined yet. Use Find me a partner in Team up on the league page and your league admin can team you up.
      </Text>
    );
  } else {
    body = (
      <Card style={{ padding: 0, overflow: "hidden" }}>
        {v.candidates.map((p, i) => (
          <ListRow
            key={p.playerId}
            title={p.name}
            subtitle={`Level ${p.level.toFixed(1)}`}
            symbol="person.2"
            onPress={() => ask(p.playerId, p.name)}
            accessibilityHint={`Asks ${p.name}, ${levelSpoken(p.level, "self")}, to team up`}
            last={i === v.candidates.length - 1}
          />
        ))}
      </Card>
    );
  }

  return (
    <SheetBody title="Team up with someone" close={sheet.close} contentStyle={{ gap: spacing.space4 }}>
      <Text tone="inkMuted">Pick someone without a partner. You'll play every round together this season.</Text>
      {body}
    </SheetBody>
  );
}
