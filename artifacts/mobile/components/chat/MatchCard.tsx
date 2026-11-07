// A match card in a chat (F2; canvas W2_ChatAddCard, W2_ChatAdded,
// W2_ChatDayBefore, W2_ChatDidItHappen, W2_NoShowDispute,
// W2_NoShowDisputed). Each step of a card is one VoiceOver element that
// reads the whole card, with its answers as actions (brief item 37); the
// same answers are buttons on screen. Status lines ("Sam undid…",
// "You two remember this differently…") are centered system lines.

import { useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import React from "react";
import { AccessibilityInfo, Alert, View } from "react-native";

import { Button, Card, Text, TextButton } from "@/components/ui";
import { radius, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { usePlanAction, useShiftPlan } from "@/hooks/useDiscoverMatchPlans";
import { isOfflineError, OFFLINE_MESSAGE } from "@/lib/api";
import { actionLabel, eventCopy, planWhen, type MatchPlan, type PlanAction, type PlanEvent } from "@/lib/discover";

export interface MatchCardItem {
  plan: MatchPlan;
  event: PlanEvent;
}

/** Runs an answer, asking first where it can't be taken back. */
export function useMatchCardActions(otherName: string) {
  const router = useRouter();
  const act = usePlanAction();
  const them = otherName.split(" ")[0] || otherName;

  function run(plan: MatchPlan, action: PlanAction) {
    if (action === "score") {
      if (plan.matchId)
        router.push({ pathname: "/record/score/[matchId]", params: { matchId: String(plan.matchId), opponent: otherName } });
      return;
    }
    const go = () =>
      act
        .mutateAsync({ planId: plan.id, action })
        .then(() => AccessibilityInfo.announceForAccessibility(doneWords(action, them)))
        .catch((e: unknown) =>
          Alert.alert("Couldn't do that", isOfflineError(e) ? OFFLINE_MESSAGE : e instanceof Error ? e.message : "Try again."),
        );
    const day = new Date(plan.startsAt).toLocaleDateString("en-US", { weekday: "long" });
    if (action === "cancel")
      return Alert.alert(
        `Cancel ${day}'s match?`,
        `It comes off both your schedules and ${them} gets a message. Canceling before the match never counts as a no-show.`,
        [
          { text: "Keep match", style: "cancel" },
          { text: "Cancel match", style: "destructive", onPress: go },
        ],
      );
    if (action === "no_show")
      return Alert.alert(
        `${them} didn't show?`,
        `We'll ask ${them}. If they don't say otherwise within 48 hours, a no-show goes on their player card.`,
        [
          { text: "Go back", style: "cancel" },
          { text: "Mark as no-show", style: "destructive", onPress: go },
        ],
      );
    if (action === "admit")
      return Alert.alert("You couldn't make it?", "A no-show goes on your player card.", [
        { text: "Go back", style: "cancel" },
        { text: "I couldn't make it", style: "destructive", onPress: go },
      ]);
    if (action === "not_played")
      return Alert.alert("You didn't play?", "It comes off both your schedules. Nothing goes on either card.", [
        { text: "Go back", style: "cancel" },
        { text: "We didn't play", onPress: go },
      ]);
    void go();
  }

  return { run, busy: act.isPending };
}

function doneWords(a: PlanAction, them: string): string {
  switch (a) {
    case "accept":
      return "Match added";
    case "decline":
      return `${them} will see you can't make it`;
    case "undo":
      return "Undone. It's off both your schedules.";
    case "still_on":
      return "You're in";
    case "cancel":
      return "Match canceled";
    case "dispute":
      return "Left off both cards";
    default:
      return "Done";
  }
}

const SYMBOL: Partial<
  Record<PlanEvent["type"], "calendar" | "calendar.badge.checkmark" | "clock" | "questionmark.circle" | "exclamationmark.circle">
> = {
  proposed: "calendar",
  added: "calendar.badge.checkmark",
  day_before: "clock",
  did_it_happen: "questionmark.circle",
  no_show_reported: "exclamationmark.circle",
};

export function MatchCard({
  item,
  otherName,
  devTools,
  onAction,
  busy,
}: {
  item: MatchCardItem;
  otherName: string;
  devTools?: boolean;
  onAction: (plan: MatchPlan, action: PlanAction) => void;
  busy?: boolean;
}) {
  const c = useColors();
  const router = useRouter();
  const shift = useShiftPlan();
  const { plan, event } = item;
  const copy = eventCopy(event, plan, otherName);
  const them = otherName.split(" ")[0] || otherName;
  const mineSide = event.by === "me" && event.type === "proposed";
  const spoken = [copy.title, copy.body?.replace(/\n/g, ". ")].filter(Boolean).join(". ");
  const showMatchLink = event.type === "added" && plan.matchId != null && !event.actions.includes("undo");

  if (copy.status) {
    return (
      <View
        accessible
        accessibilityRole="text"
        accessibilityLabel={spoken}
        style={{ alignItems: "center", paddingHorizontal: spacing.space8, paddingVertical: spacing.space2, gap: 2 }}
      >
        <Text variant="small" tone="inkMuted" style={{ textAlign: "center" }}>
          {copy.title}
        </Text>
        {copy.body ? (
          <Text variant="small" tone="inkMuted" style={{ textAlign: "center" }}>
            {copy.body}
          </Text>
        ) : null}
      </View>
    );
  }

  const [primary, ...rest] = event.actions;
  return (
    <View style={{ paddingHorizontal: spacing.space4, paddingVertical: spacing.space2, alignItems: mineSide ? "flex-end" : "flex-start" }}>
      <Card
        accessible
        accessibilityLabel={spoken}
        accessibilityActions={[
          ...event.actions.map((a) => ({ name: a, label: actionLabel(a, them) })),
          ...(showMatchLink ? [{ name: "see", label: "See match" }] : []),
        ]}
        onAccessibilityAction={(e) => {
          if (e.nativeEvent.actionName === "see" && plan.matchId)
            router.push({ pathname: "/match/[matchId]", params: { matchId: String(plan.matchId) } });
          else onAction(plan, e.nativeEvent.actionName as PlanAction);
        }}
        style={{ width: "88%", maxWidth: 420, gap: spacing.space2, borderRadius: radius.radiusCard }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.space2 }}>
          {SYMBOL[event.type] ? <SymbolView name={SYMBOL[event.type]!} size={18} tintColor={c.ink} /> : null}
          <Text variant="bodyStrong" style={{ flex: 1 }}>
            {copy.title}
          </Text>
        </View>
        {copy.body ? (
          <Text variant="small" tone="inkMuted">
            {copy.body}
          </Text>
        ) : null}
        {primary ? (
          <View style={{ gap: spacing.space2, marginTop: spacing.space1 }}>
            <Button
              label={actionLabel(primary, them)}
              variant={primary === "cancel" ? "destructiveOutline" : "primary"}
              loading={busy}
              onPress={() => onAction(plan, primary)}
            />
            {rest.map((a) => (
              <Button
                key={a}
                label={actionLabel(a, them)}
                variant={a === "cancel" || a === "no_show" || a === "admit" ? "destructiveOutline" : "secondary"}
                disabled={busy}
                onPress={() => onAction(plan, a)}
              />
            ))}
          </View>
        ) : null}
        {showMatchLink ? (
          <TextButton
            label="See match"
            onPress={() => router.push({ pathname: "/match/[matchId]", params: { matchId: String(plan.matchId) } })}
            style={{ alignSelf: "flex-start", paddingHorizontal: 0 }}
          />
        ) : null}
        {devTools && (event.type === "added" || event.type === "day_before") && new Date(plan.startsAt) > new Date() ? (
          <TextButton
            label="Dev: move 1 day closer"
            accessibilityLabel={`Development only. Move the match on ${planWhen(plan.startsAt)} one day closer`}
            disabled={shift.isPending}
            onPress={() => shift.mutate({ planId: plan.id, hours: 24 })}
            style={{ alignSelf: "flex-start", paddingHorizontal: 0 }}
          />
        ) : null}
      </Card>
    </View>
  );
}
