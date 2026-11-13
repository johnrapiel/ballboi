// Opened from a Quick match invite link (spec: Video and training data):
// "On joining they see '<name> recorded your match on <date>' with their
// training toggle before the match attaches."
//
// Wave 1 review: the toggle starts from the player's saved training choice
// (D7), and a lost connection says so instead of calling the link broken (D21).
//
// Also "Was that you?" (Session G, decision 124): a Quick match recorded
// against someone the recorder found in player search but has never played.
// Opened from the push. Yes adds it like an invite; Not me keeps them off it,
// for good; no answer leaves it unlinked.
//
// Close (X) at the top left on every state, as well as swipe down (Wave 2
// finding 50, decision 198). Nothing is lost by closing: the match stays
// unlinked until it's answered, so it closes at once.

import { useAuth } from "@clerk/expo";
import { useQueryClient } from "@tanstack/react-query";
import { useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useState } from "react";
import { AccessibilityInfo, ActivityIndicator, Alert, View, type ViewProps } from "react-native";

import { TRAINING_COPY } from "@/components/record/ConsentScreen";
import { SheetCloseBar } from "@/components/Sheet";
import { Button, Card, Screen, Text, TextButton } from "@/components/ui";
import { MIN_TAP, spacing } from "@/constants/tokens";
import { Toggle } from "@/components/Toggle";
import { useColors } from "@/hooks/useColors";
import { useGate } from "@/hooks/useGate";
import { isOfflineError } from "@/lib/api";
import {
  claimMatchInvite,
  InviteError,
  recordingsKey,
  useMatchInvite,
  useRecordingConsent,
} from "@/lib/recording/api";
import { sayNotMe } from "@/lib/notifications";
import { savePendingInvite } from "@/lib/recording/pendingInvite";

/** The sheet: Close (X) at the top left, then the state's content. */
function Sheet({ onClose, style, children }: ViewProps & { onClose: () => void }) {
  const c = useColors();
  return (
    <View style={{ flex: 1, backgroundColor: c.paper }} onAccessibilityEscape={onClose}>
      <SheetCloseBar onPress={onClose} />
      <Screen style={[{ paddingTop: spacing.space4 }, style]}>{children}</Screen>
    </View>
  );
}

function longDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? "a recent day" : d.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });
}

export default function MatchInviteScreen() {
  const c = useColors();
  const router = useRouter();
  const { isSignedIn, isLoaded, getToken } = useAuth();
  const queryClient = useQueryClient();
  const params = useLocalSearchParams<{ code: string }>();
  const code = String(params.code ?? "").toUpperCase();
  // Signed in but not past the age check or onboarding (or blocked): the root
  // gate moves them on and keeps this link for later, so show nothing here (A3).
  const gate = useGate();
  const held = !!isSignedIn && gate !== "app";
  const invite = useMatchInvite(code, !!isSignedIn && !held);
  // Null until the player touches it: then it follows their saved choice (D7).
  const [trainingChoice, setTraining] = useState<boolean | null>(null);
  const consent = useRecordingConsent();
  const training = trainingChoice ?? consent.data?.trainingEnabled ?? true;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState(false);
  const [notMe, setNotMe] = useState(false);

  // Not signed in yet: remember the link so it opens again after sign-in.
  useEffect(() => {
    if (isLoaded && !isSignedIn && code) savePendingInvite(code);
  }, [isLoaded, isSignedIn, code]);

  const close = () => (router.canGoBack() ? router.back() : router.replace("/(tabs)/ballboi"));

  if (!isLoaded) return <Sheet onClose={close} />;
  if (held) {
    return (
      <Sheet onClose={close} style={{ justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator color={c.ink} accessibilityLabel="Loading" />
      </Sheet>
    );
  }

  if (!isSignedIn) {
    return (
      <Sheet onClose={close} style={{ justifyContent: "center", gap: spacing.space4 }}>
        <Text variant="title" accessibilityRole="header">
          A match is waiting for you
        </Text>
        <Text tone="inkMuted">Sign in to Ball Boi to add it to your matches. This link opens again once you're in.</Text>
        <Button label="Sign in" onPress={() => router.replace("/(auth)/welcome")} />
      </Sheet>
    );
  }

  if (invite.isLoading || (consent.isLoading && !consent.data)) {
    return (
      <Sheet onClose={close} style={{ justifyContent: "center", alignItems: "center" }}>
        <ActivityIndicator color={c.ink} accessibilityLabel="Loading" />
      </Sheet>
    );
  }

  if (invite.isError && !(invite.error instanceof InviteError && invite.error.status === 404)) {
    const offline = isOfflineError(invite.error);
    return (
      <Sheet onClose={close} style={{ justifyContent: "center", gap: spacing.space4 }}>
        <Text variant="title" accessibilityRole="header">
          {offline ? "You're offline" : "Couldn't load this match"}
        </Text>
        <Text tone="inkMuted">Check your connection and try again.</Text>
        <Button label="Try again" loading={invite.isRefetching} onPress={() => invite.refetch()} />
      </Sheet>
    );
  }

  if (invite.isError || !invite.data) {
    return (
      <Sheet onClose={close} style={{ justifyContent: "center", gap: spacing.space4 }}>
        <Text variant="title" accessibilityRole="header">
          This link doesn't work
        </Text>
        <Text tone="inkMuted">{invite.error instanceof Error ? invite.error.message : "Ask the player who sent it for a new one."}</Text>
        <Button variant="secondary" label="Close" onPress={close} />
      </Sheet>
    );
  }

  const inv = invite.data;
  const when = longDate(inv.recordedAt);

  if (joined || inv.claimedByYou) {
    return (
      <Sheet onClose={close} style={{ justifyContent: "center", gap: spacing.space4 }}>
        <Text variant="title" accessibilityRole="header">
          Added to your matches
        </Text>
        <Text tone="inkMuted">
          Your match with {inv.recorderName} on {when} is yours too. Its stats show up once Ball Boi finishes the analysis.
        </Text>
        <Button label="Done" onPress={close} />
      </Sheet>
    );
  }

  if (notMe || inv.wasThatYou === "not_me") {
    return (
      <Sheet onClose={close} style={{ justifyContent: "center", gap: spacing.space4 }}>
        <Text variant="title" accessibilityRole="header">
          Not you
        </Text>
        <Text tone="inkMuted">You said this wasn't you, so the match with {inv.recorderName} isn't on your profile.</Text>
        <Button label="Done" onPress={close} />
      </Sheet>
    );
  }

  if (inv.isYourInvite || inv.claimed) {
    return (
      <Sheet onClose={close} style={{ justifyContent: "center", gap: spacing.space4 }}>
        <Text variant="title" accessibilityRole="header">
          {inv.isYourInvite ? "This is your invite" : "Already added"}
        </Text>
        <Text tone="inkMuted">
          {inv.isYourInvite
            ? `Send this link to ${inv.yourName} so the match shows up for them.`
            : "Someone already joined this match with this link. Ask the player who sent it if that wasn't you."}
        </Text>
        <Button variant="secondary" label="Close" onPress={close} />
      </Sheet>
    );
  }

  async function join() {
    setSaving(true);
    setError(null);
    try {
      await claimMatchInvite(code, training, getToken);
      queryClient.invalidateQueries({ queryKey: recordingsKey });
      queryClient.invalidateQueries({ queryKey: ["recording", "consent"] });
      setJoined(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't add the match. Try again.");
    } finally {
      setSaving(false);
    }
  }

  function confirmNotMe() {
    Alert.alert("Not you?", `The match ${inv.recorderName} recorded won't be added to your profile. You can't undo this.`, [
      { text: "Cancel", style: "cancel" },
      { text: "Not me", style: "destructive", onPress: () => void answerNotMe() },
    ]);
  }

  async function answerNotMe() {
    setSaving(true);
    setError(null);
    try {
      await sayNotMe(code);
      queryClient.invalidateQueries({ queryKey: ["recording", "invite", code] });
      setNotMe(true);
      AccessibilityInfo.announceForAccessibility("Saved. The match isn't on your profile.");
    } catch (e) {
      setError(isOfflineError(e) ? "You're offline. Check your connection and try again." : "Couldn't save. Try again.");
    } finally {
      setSaving(false);
    }
  }

  const asking = inv.wasThatYou === "pending";

  return (
    <Sheet onClose={close} style={{ gap: spacing.space6 }}>
      <View style={{ gap: spacing.space2 }}>
        {asking ? (
          <>
            <Text variant="headingM" accessibilityRole="header">
              Was that you?
            </Text>
            <Text tone="inkMuted">
              {inv.recorderName} recorded a match with you on {when}. Yes adds it to your profile, with your stats and replay once they're
              ready. Not me keeps you off it.
            </Text>
          </>
        ) : (
          <>
            <Text variant="title" accessibilityRole="header">
              {inv.recorderName} recorded your match on {when}
            </Text>
            <Text tone="inkMuted">Add it to your matches to see your shots and stats.</Text>
          </>
        )}
      </View>

      <Card style={{ gap: spacing.space3 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.space3, minHeight: MIN_TAP }}>
          <Text variant="bodyStrong" style={{ flex: 1 }} importantForAccessibility="no" accessibilityElementsHidden>
            Help Ball Boi get smarter
          </Text>
          <Toggle
            value={training}
            onValueChange={setTraining}
            accessibilityLabel="Help Ball Boi get smarter"
            accessibilityHint={TRAINING_COPY}
          />
        </View>
        <Text tone="inkMuted">{TRAINING_COPY}</Text>
      </Card>

      {error ? (
        <Text tone="danger" accessibilityRole="alert">
          {error}
        </Text>
      ) : null}

      <View style={{ flex: 1 }} />
      {asking ? (
        <>
          <Button label="Yes" accessibilityLabel="Yes, that was me" onPress={join} loading={saving} />
          <Button variant="destructiveOutline" label="Not me" onPress={confirmNotMe} disabled={saving} />
          <TextButton label="Decide later" onPress={close} disabled={saving} accessibilityHint="The match stays off your profile until you answer" />
        </>
      ) : (
        <>
          <Button label="Add to my matches" onPress={join} loading={saving} />
          <Button variant="secondary" label="Not now" onPress={close} disabled={saving} />
        </>
      )}
    </Sheet>
  );
}
