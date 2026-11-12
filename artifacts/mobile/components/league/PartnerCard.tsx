import { useQueryClient } from "@tanstack/react-query";
import { router } from "expo-router";
import React from "react";
import { AccessibilityInfo, Alert, View } from "react-native";

import {
  getGetLeagueTeamsQueryKey,
  getGetMyPartnerQueryKey,
  useAcceptPartnerRequest,
  useCancelPartnerRequest,
  useDeclinePartnerRequest,
  useDismissPartnerNotice,
  useGetMyPartner,
  useSetLookingForPartner,
  type MyPartner,
} from "@workspace/api-client-react";

import { Avatar } from "@/components/Avatar";
import { Icon } from "@/components/Icon";
import { Button, ButtonRow, Card, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { expiresLine, newestRequestsFirst, teamUpRequestLabel } from "@/lib/doubles";
import { refreshLeague } from "@/lib/leagueRefresh";

// Teaming up in a fixed-partner doubles league (doubles flow review D2, D4,
// D9, John, Nov 9; league page layout, finding 31, decision 185, Nov 12).
// - On the league page your partner is one line under the name (PartnerLine),
//   and "Team up" opens the Team up sheet, which holds PartnerOptions.
// - After joining, PartnerOptions sits in a "Next, team up" card (PartnerCard).
// - A request to you is its own card (TeamUpRequestCards) only while it waits,
//   with Accept and Decline and the time left. One card per request, newest first.
// PartnerOptions, by state:
// - No partner yet, before the first round: "Team up with someone" (a
//   request) or "Find me a partner" (the list your admin sees in Manage).
// - Your request out: who, the time left, and Cancel.
// - Declined or unanswered: the notice in words, with OK.
// - Your partner left mid-season: byes until your admin teams you up (D4).
// Every state is words plus an icon, never color alone.

const errorText = (e: unknown) => (e as { data?: { error?: string } | null }).data?.error ?? "Try again in a moment.";

export function usePartnerActions(leagueId: number) {
  const queryClient = useQueryClient();
  const accept = useAcceptPartnerRequest();
  const decline = useDeclinePartnerRequest();
  const cancel = useCancelPartnerRequest();
  const dismiss = useDismissPartnerNotice();
  const looking = useSetLookingForPartner();
  const settle = async (view: MyPartner, said?: string) => {
    queryClient.setQueryData(getGetMyPartnerQueryKey(leagueId), view);
    await Promise.all([
      refreshLeague(queryClient, leagueId),
      queryClient.invalidateQueries({ queryKey: getGetLeagueTeamsQueryKey(leagueId) }),
    ]);
    if (said) AccessibilityInfo.announceForAccessibility(said);
  };
  const run = (title: string, p: Promise<MyPartner>, said?: string) =>
    p.then((v) => settle(v, said)).catch((e) => Alert.alert(title, errorText(e)));
  return {
    busy: accept.isPending || decline.isPending || cancel.isPending || dismiss.isPending || looking.isPending,
    accept: (requestId: number, name: string) =>
      run("Couldn't accept", accept.mutateAsync({ leagueId, requestId }), `You're teamed up with ${name}`),
    decline: (requestId: number, name: string) =>
      Alert.alert(`Decline ${name}?`, `${name} goes back on the list, so your admin can team them up with someone else.`, [
        { text: "Cancel", style: "cancel" },
        { text: "Decline", style: "destructive", onPress: () => void run("Couldn't decline", decline.mutateAsync({ leagueId, requestId }), "Request declined") },
      ]),
    cancel: (requestId: number, name: string) =>
      Alert.alert(`Cancel your request to ${name}?`, undefined, [
        { text: "Keep it", style: "cancel" },
        { text: "Cancel request", style: "destructive", onPress: () => void run("Couldn't cancel", cancel.mutateAsync({ leagueId, requestId }), "Request cancelled") },
      ]),
    dismiss: (requestId: number) => run("Something went wrong", dismiss.mutateAsync({ leagueId, requestId })),
    setLooking: (on: boolean) =>
      run(
        on ? "Couldn't add you to the list" : "Couldn't take you off the list",
        looking.mutateAsync({ leagueId, data: { on } }),
        on ? "You're on the Looking for a partner list" : "You're off the list",
      ),
  };
}

/** A line with a brush icon, read with the text. */
function StateLine({ icon, title, body }: { icon: "person.2" | "hourglass" | "info.circle" | "checkmark.circle"; title: string; body?: string | null }) {
  const c = useColors();
  return (
    <View accessible accessibilityLabel={[title, body].filter(Boolean).join(". ")} style={{ flexDirection: "row", gap: spacing.space3, alignItems: "flex-start" }}>
      <Icon name={icon} size={20} tintColor={c.ink} style={{ marginTop: 2 }} />
      <View style={{ flex: 1, gap: 2 }}>
        <Text variant="bodyStrong">{title}</Text>
        {body ? (
          <Text variant="small" tone="inkMuted">
            {body}
          </Text>
        ) : null}
      </View>
    </View>
  );
}

/** Team-up requests to you, one card each, newest first. Nothing when none wait. */
export function TeamUpRequestCards({ leagueId }: { leagueId: number }) {
  const q = useGetMyPartner(leagueId);
  const act = usePartnerActions(leagueId);
  const v = q.data;
  if (!v || !v.fixedPartners || !v.member || v.partner || v.incoming.length === 0) return null;
  return (
    <>
      {newestRequestsFirst(v.incoming).map((r) => (
        <Card key={r.requestId} style={{ gap: spacing.space4 }}>
          <View
            accessible
            accessibilityLabel={teamUpRequestLabel(r.from.name, r.expiresAt)}
            style={{ flexDirection: "row", gap: spacing.space3, alignItems: "center" }}
          >
            <Avatar name={r.from.name} uri={r.from.photoUrl} size={44} />
            <View style={{ flex: 1, gap: 2 }}>
              <Text variant="bodyStrong">{`${r.from.name} wants to team up`}</Text>
              <Text variant="small" tone="inkMuted">
                {expiresLine(r.expiresAt)}
              </Text>
            </View>
          </View>
          <ButtonRow>
            <Button label="Accept" onPress={() => void act.accept(r.requestId, r.from.name)} disabled={act.busy} accessibilityHint={`Team up with ${r.from.name} for the season`} />
            <Button label="Decline" variant="secondary" onPress={() => act.decline(r.requestId, r.from.name)} disabled={act.busy} />
          </ButtonRow>
        </Card>
      ))}
    </>
  );
}

/**
 * The explanation and the two options (or where things stand), for the Team up
 * sheet and the step after joining. `onTeamUp` opens the list of people to ask.
 */
export function PartnerOptions({ leagueId, onTeamUp }: { leagueId: number; onTeamUp: () => void }) {
  const q = useGetMyPartner(leagueId);
  const act = usePartnerActions(leagueId);
  const v = q.data;
  // Harden: a failed load says so with a way back, rather than hiding the team-up step.
  if (q.isError && !v) {
    return (
      <View style={{ gap: spacing.space3 }}>
        <StateLine icon="info.circle" title="Couldn't load your partner" body="Check your connection and try again." />
        <Button label="Try again" variant="secondary" loading={q.isRefetching} onPress={() => void q.refetch()} />
      </View>
    );
  }
  if (!v || !v.fixedPartners || !v.member) return null;
  if (v.partner) {
    return <StateLine icon="person.2" title={`Your partner: ${v.partner.name}`} body="You play every round together this season." />;
  }
  return (
    <View style={{ gap: spacing.space4 }}>
      {v.notice ? (
        <View style={{ gap: spacing.space2 }}>
          <StateLine icon="info.circle" title="Your request didn't go through" body={v.notice.text} />
          <Button label="OK" variant="secondary" onPress={() => void act.dismiss(v.notice!.requestId)} disabled={act.busy} />
        </View>
      ) : null}

      {v.needsPartner ? (
        <StateLine
          icon="hourglass"
          title="You need a partner"
          body="Your partner left the league. Your played results stay. You'll have byes until your league admin teams you up with someone new."
        />
      ) : v.outgoing ? (
        <View style={{ gap: spacing.space2 }}>
          <StateLine icon="hourglass" title={`Waiting on ${v.outgoing.to.name}`} body={`You asked to team up. ${expiresLine(v.outgoing.expiresAt)}.`} />
          <Button label="Cancel request" variant="secondary" onPress={() => act.cancel(v.outgoing!.requestId, v.outgoing!.to.name)} disabled={act.busy} />
        </View>
      ) : v.teamingOpen ? (
        <View style={{ gap: spacing.space3 }}>
          {v.looking ? (
            <StateLine icon="checkmark.circle" title="You're on Looking for a partner" body="Your league admin sees the list and can team you up. You can still ask someone yourself." />
          ) : (
            <Text tone="inkMuted">
              This league plays fixed partners. Ask someone to team up, or let your league admin find you a partner. Anyone without one when the first round goes out is teamed by level.
            </Text>
          )}
          <ButtonRow>
            <Button label="Team up with someone" onPress={onTeamUp} disabled={act.busy} />
            {v.looking ? (
              <Button label="Leave the list" variant="secondary" onPress={() => void act.setLooking(false)} disabled={act.busy} />
            ) : (
              <Button
                label="Find me a partner"
                variant="secondary"
                onPress={() => void act.setLooking(true)}
                disabled={act.busy}
                accessibilityHint="Adds you to the list your league admin sees"
              />
            )}
          </ButtonRow>
        </View>
      ) : (
        <StateLine icon="info.circle" title="No partner yet" body="Teaming up closed when the first round went out. Your league admin can team you up in Manage league." />
      )}
    </View>
  );
}

/** The step right after joining a fixed-partner league: requests to you, then the options. */
export function PartnerCard({ leagueId }: { leagueId: number }) {
  const q = useGetMyPartner(leagueId);
  const v = q.data;
  if (!q.isError && (!v || !v.fixedPartners || !v.member || v.partner)) return null;
  const openTeamUp = () => router.push({ pathname: "/league/[leagueId]/team-up", params: { leagueId: String(leagueId) } });
  return (
    <>
      <TeamUpRequestCards leagueId={leagueId} />
      <Card style={{ gap: spacing.space4 }}>
        <Text variant="section" tone="inkMuted" accessibilityRole="header">
          Next, team up
        </Text>
        <PartnerOptions leagueId={leagueId} onTeamUp={openTeamUp} />
      </Card>
    </>
  );
}
