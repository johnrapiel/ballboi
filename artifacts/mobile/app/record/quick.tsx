// Quick match (spec: Ball Boi > Recording): format first, singles by default,
// then any opponent. Someone not on Ball Boi becomes a placeholder, and you
// get a link to send them. Nothing counts toward league standings.

import { useAuth } from "@clerk/expo";
import { useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import React, { useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Share, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ChoiceGroup } from "@/components/Choice";
import { Button, Card, Field, KeyboardScreen, Text } from "@/components/ui";
import { MIN_TAP, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import {
  createQuickMatch,
  DOUBLES_MESSAGE,
  useQuickMatchOpponents,
  type QuickMatchCreated,
} from "@/lib/recording/api";

type Format = "singles" | "doubles";
/** A picked player id, or "new" for someone not on Ball Boi. */
type Pick = number | "new" | null;

function OptionRow({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={label}
      style={({ pressed }) => ({
        minHeight: MIN_TAP,
        flexDirection: "row",
        alignItems: "center",
        gap: spacing.space3,
        paddingVertical: spacing.space2,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <SymbolView name={selected ? "checkmark.circle.fill" : "circle"} size={22} tintColor={c.ink} />
      <Text style={{ flex: 1 }}>{label}</Text>
    </Pressable>
  );
}

export default function QuickMatchScreen() {
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();
  const opponents = useQuickMatchOpponents();
  const [format, setFormat] = useState<Format>("singles");
  const [pick, setPick] = useState<Pick>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<QuickMatchCreated | null>(null);

  const ready = format === "singles" && (pick === "new" ? name.trim().length > 0 : pick != null);

  async function start() {
    if (!ready || pick == null) return;
    setSaving(true);
    setError(null);
    try {
      const result = await createQuickMatch(
        pick === "new" ? { opponentName: name.trim() } : { opponentPlayerId: pick },
        getToken,
      );
      if (result.invite) setCreated(result);
      else openCamera(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start the match. Try again.");
    } finally {
      setSaving(false);
    }
  }

  function openCamera(m: QuickMatchCreated) {
    router.replace({ pathname: "/record/[matchId]", params: { matchId: String(m.matchId), opponent: m.opponentName } });
  }

  async function shareInvite(m: QuickMatchCreated) {
    if (!m.invite) return;
    try {
      await Share.share({
        message: `I'm recording our match with Ball Boi. Join to see your stats and replay: ${m.invite.url}`,
      });
    } catch {
      // Closing the share sheet is fine.
    }
  }

  // After creating a match with someone not on Ball Boi: send them the link, then record.
  if (created?.invite) {
    return (
      <View style={{ flex: 1, backgroundColor: c.paper, padding: spacing.space4, paddingBottom: insets.bottom + spacing.space4, gap: spacing.space4 }}>
        <Text variant="title" accessibilityRole="header">
          Invite {created.opponentName}
        </Text>
        <Text tone="inkMuted">
          {created.opponentName} isn't on Ball Boi yet. Send them this link so the match shows up on their profile when they
          join. Until then, it doesn't count toward any standings and isn't used for training.
        </Text>
        <View style={{ flex: 1 }} />
        <Button label="Send invite" onPress={() => shareInvite(created)} />
        <Button variant="secondary" label="Record now" onPress={() => openCamera(created)} />
      </View>
    );
  }

  return (
    <KeyboardScreen>
      <ScrollView
        style={{ flex: 1, backgroundColor: c.paper }}
        contentContainerStyle={{ padding: spacing.space4, gap: spacing.space6 }}
        keyboardShouldPersistTaps="handled"
      >
        <ChoiceGroup<Format>
          label="Format"
          options={[
            { value: "singles", label: "Singles" },
            { value: "doubles", label: "Doubles" },
          ]}
          value={format}
          onChange={setFormat}
        />

        {format === "doubles" ? (
          <Card
            accessible
            accessibilityLabel={DOUBLES_MESSAGE}
            style={{ flexDirection: "row", gap: spacing.space2, alignItems: "flex-start" }}
          >
            <SymbolView name="info.circle" size={18} tintColor={c.ink} style={{ marginTop: 2 }} />
            <Text style={{ flex: 1 }}>{DOUBLES_MESSAGE}</Text>
          </Card>
        ) : (
          <View style={{ gap: spacing.space2 }}>
            <Text variant="label" accessibilityRole="header">
              Opponent
            </Text>
            {opponents.isLoading ? <ActivityIndicator color={c.ink} accessibilityLabel="Loading players" /> : null}
            <View accessibilityRole="radiogroup" accessibilityLabel="Opponent">
              {(opponents.data ?? []).map((o) => (
                <OptionRow key={o.playerId} label={o.name} selected={pick === o.playerId} onPress={() => setPick(o.playerId)} />
              ))}
              <OptionRow label="Someone not on Ball Boi" selected={pick === "new"} onPress={() => setPick("new")} />
            </View>
            {pick === "new" ? (
              <Field
                label="Their name"
                value={name}
                onChangeText={setName}
                autoCapitalize="words"
                autoComplete="name"
                maxLength={60}
                returnKeyType="done"
                hint="We'll give you a link to send them."
              />
            ) : null}
          </View>
        )}

        {error ? (
          <Text tone="danger" accessibilityRole="alert">
            {error}
          </Text>
        ) : null}
      </ScrollView>
      <View style={{ paddingHorizontal: spacing.space4, paddingTop: spacing.space3, paddingBottom: insets.bottom + spacing.space4, backgroundColor: c.paper }}>
        <Button label="Start recording" onPress={start} disabled={!ready} loading={saving} />
      </View>
    </KeyboardScreen>
  );
}
