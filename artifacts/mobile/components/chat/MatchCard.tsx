// A match card in a chat (F2; canvas W2_ChatAddCard, W2_ChatAdded,
// W2_ChatDayBefore, W2_ChatDidItHappen, W2_NoShowDispute,
// W2_NoShowDisputed). Each step of a card is one VoiceOver element that
// reads the whole card, with its answers as actions (brief item 37); the
// same answers are buttons on screen. Status lines ("Sam undid…",
// "You two remember this differently…") are centered system lines.
//
// Can't make it (canceling an added match, or saying no to "Add this
// match?") is a brush X in the card's top-right corner, not a red button
// (John, Nov 12, Wave 2 finding 46; decision 184). Because an X alone could
// read as dismissing the card, it always confirms with a native alert that
// says what happens (decision 193). See match is an underlined link.

import { useRouter } from "expo-router";
import { Icon } from "@/components/Icon";
import React from "react";
import { AccessibilityInfo, Alert, Pressable, View } from "react-native";

import { Button, Card, Text, TextButton, TextLink } from "@/components/ui";
import { radius, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { usePlanAction, useShiftPlan } from "@/hooks/useDiscoverMatchPlans";
import { isOfflineError, OFFLINE_MESSAGE } from "@/lib/api";
import { actionLabel, cardActions, eventCopy, planWhen, type MatchPlan, type PlanAction, type PlanEvent } from "@/lib/discover";
import { tapSlop, textTapSlop } from "@/lib/tapTarget";

const X_SIZE = 20;

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
    const when = planWhen(plan.startsAt);
    // Can't make it is a small X, so the alert says what it does (finding 46).
    if (action === "cancel")
      return Alert.alert(
        "Can't make it?",
        `This takes ${when} off your and ${them}'s schedules. ${them} gets a message. Canceling before the match never counts as a no-show.`,
        [
          { text: "Keep match", style: "cancel" },
          { text: "Can't make it", style: "destructive", onPress: go },
        ],
      );
    if (action === "decline")
      return Alert.alert("Can't make it?", `${them} sees you can't make ${when}. It doesn't go on either schedule.`, [
        { text: "Go back", style: "cancel" },
        { text: "Can't make it", style: "destructive", onPress: go },
      ]);
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

  // Can't make it is the X in the corner; the other answers stay buttons.
  const { cantMakeIt: cant, buttons } = cardActions(event.actions);
  const [primary, ...rest] = buttons;
  const openMatch = () => {
    if (plan.matchId) router.push({ pathname: "/match/[matchId]", params: { matchId: String(plan.matchId) } });
  };
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
          if (e.nativeEvent.actionName === "see") openMatch();
          else onAction(plan, e.nativeEvent.actionName as PlanAction);
        }}
        style={{ width: "88%", maxWidth: 420, gap: spacing.space2, borderRadius: radius.radiusCard }}
      >
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.space2 }}>
          {SYMBOL[event.type] ? <Icon name={SYMBOL[event.type]!} size={18} tintColor={c.ink} /> : null}
          <Text variant="bodyStrong" style={{ flex: 1 }}>
            {copy.title}
          </Text>
          {cant ? (
            <Pressable
              onPress={() => onAction(plan, cant)}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Can't make it"
              accessibilityHint={cant === "cancel" ? "Takes this match off both schedules" : `Tells ${them} you can't make this time`}
              accessibilityState={{ disabled: !!busy }}
              // A 20pt brush X with a 44pt target from hitSlop (decision 192).
              hitSlop={tapSlop(X_SIZE, X_SIZE)}
              style={({ pressed }) => ({ alignSelf: "flex-start", opacity: busy ? 0.5 : pressed ? 0.6 : 1 })}
            >
              <Icon name="xmark" size={X_SIZE} tintColor={c.inkMuted} />
            </Pressable>
          ) : null}
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
              variant="primary"
              loading={busy}
              onPress={() => onAction(plan, primary)}
            />
            {rest.map((a) => (
              <Button
                key={a}
                label={actionLabel(a, them)}
                variant={a === "no_show" || a === "admit" ? "destructiveOutline" : "secondary"}
                disabled={busy}
                onPress={() => onAction(plan, a)}
              />
            ))}
          </View>
        ) : null}
        {showMatchLink ? (
          // A real link: underlined TextLink, 44pt from hitSlop (decision 192).
          <Pressable
            onPress={openMatch}
            accessibilityRole="link"
            accessibilityLabel="See match"
            hitSlop={textTapSlop("body")}
            style={({ pressed }) => ({ alignSelf: "flex-start", opacity: pressed ? 0.6 : 1 })}
          >
            <TextLink onPress={openMatch} accessible={false}>
              See match
            </TextLink>
          </Pressable>
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
