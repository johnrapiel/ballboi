// Quick match (spec: Ball Boi > Recording): format first, singles by default,
// then any opponent. Someone not on Ball Boi becomes a placeholder, and you
// get a link to send them. Nothing counts toward league standings.
//
// Wave 1 review: Record wording throughout (D27); leaving before anything is
// recorded removes the match, so it doesn't linger under Record a match
// (Q18); offline says so (D21); a failed player list says so, with Try
// again (D32). Finding #15 (John, Nov 6): "Someone not on Ball Boi" comes
// first, then a search bar, then the player list. Search finds any visible
// player (the shared player search), never a blocked one.

import { useAuth } from "@clerk/expo";
import { useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import React, { useEffect, useRef, useState } from "react";
import { ActivityIndicator, Pressable, ScrollView, Share, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ChoiceGroup } from "@/components/Choice";
import { SearchField } from "@/components/players/SearchField";
import { Button, Card, Field, KeyboardScreen, Text } from "@/components/ui";
import { MIN_TAP, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { usePlayerSearch } from "@/hooks/usePlayerSearch";
import { isOfflineError, OFFLINE_MESSAGE } from "@/lib/api";
import {
  noResultsMessage,
  personKey,
  quickMatchOpponent,
  relationLabel,
  type PlayerSearchResult,
} from "@/lib/playerSearch";
import { abandonQuickMatch, createQuickMatch, DOUBLES_MESSAGE, type QuickMatchCreated } from "@/lib/recording/api";

type Format = "singles" | "doubles";
/** A picked player, or "new" for someone not on Ball Boi. */
type Pick = PlayerSearchResult | "new" | null;

function OptionRow({
  label,
  detail,
  selected,
  onPress,
}: {
  label: string;
  /** A second line, like "In your leagues". Read after the name. */
  detail?: string | null;
  selected: boolean;
  onPress: () => void;
}) {
  const c = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="radio"
      accessibilityState={{ checked: selected }}
      accessibilityLabel={detail ? `${label}, ${detail}` : label}
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
      <View style={{ flex: 1 }}>
        <Text>{label}</Text>
        {detail ? (
          <Text variant="small" tone="inkMuted">
            {detail}
          </Text>
        ) : null}
      </View>
    </Pressable>
  );
}

export default function QuickMatchScreen() {
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { getToken } = useAuth();
  const [query, setQuery] = useState("");
  const search = usePlayerSearch(query);
  const [format, setFormat] = useState<Format>("singles");
  const [pick, setPick] = useState<Pick>(null);
  const [name, setName] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [created, setCreated] = useState<QuickMatchCreated | null>(null);
  const [sent, setSent] = useState(false);
  // The match made here, until the camera opens with it. Leaving before then removes it (Q18).
  const pending = useRef<number | null>(null);
  const tokenRef = useRef(getToken);
  tokenRef.current = getToken;

  useEffect(
    () => () => {
      if (pending.current != null) abandonQuickMatch(pending.current, tokenRef.current);
    },
    [],
  );

  const results = search.data?.players ?? [];
  const picked = pick !== "new" ? pick : null;
  // Keep the picked player on screen even when a new search doesn't include them.
  const shown = picked && !results.some((r) => personKey(r) === personKey(picked)) ? [picked, ...results] : results;
  const none = noResultsMessage(search.query, "quickMatch");

  const ready = format === "singles" && (pick === "new" ? name.trim().length > 0 : pick != null);

  async function start() {
    if (!ready || pick == null) return;
    setSaving(true);
    setError(null);
    try {
      const opponent = pick === "new" ? { opponentName: name.trim() } : quickMatchOpponent(pick);
      if (!opponent) throw new Error("Pick someone else, or add someone not on Ball Boi.");
      const result = await createQuickMatch(opponent, getToken);
      pending.current = result.matchId;
      if (result.invite) setCreated(result);
      else openCamera(result);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Couldn't start the match. Try again.");
    } finally {
      setSaving(false);
    }
  }

  function openCamera(m: QuickMatchCreated) {
    // The camera takes it from here; closing the camera unrecorded removes it there.
    pending.current = null;
    router.replace({ pathname: "/record/[matchId]", params: { matchId: String(m.matchId), opponent: m.opponentName } });
  }

  async function shareInvite(m: QuickMatchCreated) {
    if (!m.invite) return;
    try {
      const result = await Share.share({
        message: `I'm recording our match with Ball Boi. Join to see your stats and replay: ${m.invite.url}`,
      });
      if (result.action === Share.sharedAction) setSent(true);
    } catch {
      // Closing the share sheet is fine.
    }
  }

  // After creating a match with someone not on Ball Boi: send them the link,
  // then record. The main button is always the next step (D27).
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
        {sent ? (
          <>
            <Button label="Record" onPress={() => openCamera(created)} />
            <Button variant="secondary" label="Send invite again" onPress={() => shareInvite(created)} />
          </>
        ) : (
          <>
            <Button label="Send invite" onPress={() => shareInvite(created)} />
            <Button variant="secondary" label="Record without sending" onPress={() => openCamera(created)} />
          </>
        )}
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
            <Text variant="section" tone="inkMuted" accessibilityRole="header">
              Opponent
            </Text>
            <OptionRow label="Someone not on Ball Boi" selected={pick === "new"} onPress={() => setPick("new")} />
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

            <View style={{ marginTop: spacing.space2 }}>
              <SearchField
                value={query}
                onChangeText={setQuery}
                label="Search Ball Boi players"
                busy={search.searching && !!search.data}
              />
            </View>
            {search.isPending ? <ActivityIndicator color={c.ink} accessibilityLabel="Loading players" /> : null}
            {search.isError ? (
              <Card style={{ gap: spacing.space3 }}>
                <Text accessibilityRole="alert">
                  {isOfflineError(search.error) ? OFFLINE_MESSAGE : "Couldn't load players."}
                </Text>
                <Button
                  variant="secondary"
                  label="Try again"
                  loading={search.isRefetching}
                  onPress={() => search.refetch()}
                />
              </Card>
            ) : null}
            {shown.length ? (
              <View accessibilityRole="radiogroup" accessibilityLabel="Ball Boi players">
                {shown.map((o) => (
                  <OptionRow
                    key={personKey(o)}
                    label={o.name}
                    detail={relationLabel(o)}
                    selected={picked != null && personKey(picked) === personKey(o)}
                    onPress={() => setPick(o)}
                  />
                ))}
              </View>
            ) : null}
            {search.data && results.length === 0 && !search.searching ? (
              <Card style={{ gap: spacing.space3 }}>
                <View accessible accessibilityLabel={`${none.title}. ${none.message}`} style={{ gap: spacing.space1 }}>
                  <Text variant="bodyStrong">{none.title}</Text>
                  <Text tone="inkMuted">{none.message}</Text>
                </View>
                {pick !== "new" ? (
                  <Button
                    variant="secondary"
                    label="Someone not on Ball Boi"
                    accessibilityLabel={search.query ? `Add ${search.query}, someone not on Ball Boi` : "Someone not on Ball Boi"}
                    onPress={() => {
                      setPick("new");
                      if (search.query && !name) setName(search.query);
                    }}
                  />
                ) : null}
              </Card>
            ) : null}
            {search.data?.more ? (
              <Text variant="small" tone="inkMuted">
                Showing the first players found. Type more of a name to find someone else.
              </Text>
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
        <Button label="Record" onPress={start} disabled={!ready} loading={saving} />
      </View>
    </KeyboardScreen>
  );
}
