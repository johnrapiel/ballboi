// Filters (canvas W2_DiscoverFilters, W2_DiscoverFiltersDistance,
// W2_DiscoverFiltersNoTimes; F3, F8, F11). A bottom sheet by the sheet rule:
// left-aligned brush title, no Cancel, drag down to close, and "Discard
// changes?" when something changed.
//
// Distance lives here, never on the Discover tabs (John, Nov 7: "That should
// only live within filters"). Every tab's Filters starts with "Distance from
// [ZIP]": 5 / 10 / 15 / 30 / 50 mi and Custom, each with its count for that tab.
// One distance for Players, Open leagues and Open matches.
// Players also gets Level (every level from 2.5 to 5.0, pick any number,
// yours selected by default; John, Nov 7), Plays and "Free when I'm free".
// Open leagues and Open matches get Distance only, with a line saying so.
// The button shows a live count: "Show 14 players", "Show 3 open matches".

import { useRouter } from "expo-router";
import React, { useState } from "react";
import { View } from "react-native";

import { ChipRow, ChoiceChip, DistanceChips, LinkButton } from "@/components/discover/Controls";
import { SheetBody, useSheetClose } from "@/components/Sheet";
import { Toggle } from "@/components/Toggle";
import { Button, Text, TextButton } from "@/components/ui";
import { MIN_TAP, spacing } from "@/constants/tokens";
import { useDiscoverMe, useDiscoverPlayers, useSaveRadius } from "@/hooks/useDiscover";
import { discoverState, useDiscoverState } from "@/hooks/useDiscoverFilters";
import { useDiscoverLeagues } from "@/hooks/useDiscoverLeagues";
import { useOpenMatches } from "@/hooks/useDiscoverOpenMatches";
import {
  DEFAULT_FILTERS,
  DEFAULT_RADIUS,
  FILTER_LEVELS,
  levelChip,
  levelsText,
  pickedLevels,
  sameFilters,
  toggleLevel,
  type PlayerFilters,
  type PlaysFilter,
} from "@/lib/discover";

const PLAYS: { value: PlaysFilter; label: string }[] = [
  { value: "singles", label: "Singles" },
  { value: "doubles", label: "Doubles" },
  { value: "either", label: "Either" },
];

/** What each tab's list is called, singular and plural. */
const NOUNS = {
  players: ["player", "players"],
  leagues: ["Open league", "Open leagues"],
  matches: ["open match", "open matches"],
} as const;

export default function FiltersSheet() {
  const router = useRouter();
  const { tab, radius, filters } = useDiscoverState();
  const me = useDiscoverMe();
  const noTimes = (me.data?.freeTimes ?? []).length === 0;
  // What the sheet opened with. "Changed" means changed from this, so opening
  // and closing without touching anything never asks to discard.
  const [opened] = useState<PlayerFilters>(() => ({ ...filters, free: filters.free && !noTimes }));
  const [draft, setDraft] = useState<PlayerFilters>(opened);
  const [draftRadius, setDraftRadius] = useState(radius);
  const dirty = !sameFilters(draft, opened) || draftRadius !== radius;
  const sheet = useSheetClose(dirty);
  const saveRadius = useSaveRadius();

  // The live count for the tab you came from, at the distance picked here.
  const players = useDiscoverPlayers(draftRadius, draft, !!me.data && tab === "players");
  const leagues = useDiscoverLeagues(draftRadius, !!me.data && tab === "leagues");
  const matches = useOpenMatches(draftRadius, !!me.data && tab === "matches");
  const live = tab === "players" ? players : tab === "leagues" ? leagues : matches;
  const n = live.data?.total;
  const counts = live.data?.counts ?? [];
  const [one, many] = NOUNS[tab];

  const mine = me.data?.rating ?? null;
  const picked = pickedLevels(draft.levels, mine);
  const set = (patch: Partial<PlayerFilters>) => setDraft((d) => ({ ...d, ...patch }));

  /** Keep what's picked here, then run `then` (or just close). */
  const commit = (then?: () => void) => {
    if (tab === "players") discoverState.setFilters(draft);
    if (draftRadius !== radius) {
      discoverState.setRadius(draftRadius);
      saveRadius.mutate(draftRadius);
    }
    sheet.finish(then);
  };
  const setTimes = () => commit(() => router.replace("/availability"));
  const custom = () => commit(() => router.replace("/discover/radius"));

  const zip = me.data?.area?.zip;
  const atDefaults = sameFilters(draft, DEFAULT_FILTERS) && draftRadius === DEFAULT_RADIUS;

  return (
    <SheetBody
      title="Filters"
      close={sheet.close}
      footer={
        <Button
          label={n == null ? (live.isError ? `Show ${many}` : `Counting ${many}…`) : `Show ${n} ${n === 1 ? one : many}`}
          onPress={() => commit()}
          loading={live.isFetching && n == null}
        />
      }
    >
      <View style={{ gap: spacing.space2 }}>
        <Text variant="label" importantForAccessibility="no" accessibilityElementsHidden>
          {zip ? `Distance from ${zip}` : "Distance"}
        </Text>
        <DistanceChips radius={draftRadius} counts={counts} noun={many} onPick={setDraftRadius} onCustom={custom} />
        {tab !== "players" ? (
          <Text variant="small" tone="inkMuted">
            One distance for Players, Open leagues and Open matches. Level and play filters are on Players.
          </Text>
        ) : null}
      </View>

      {tab === "players" ? (
        <>
          <View style={{ gap: spacing.space2 }}>
            <Text variant="label" importantForAccessibility="no" accessibilityElementsHidden>
              Level
            </Text>
            <ChipRow label="Level">
              {FILTER_LEVELS.map((l) => (
                <ChoiceChip
                  key={l}
                  label={l.toFixed(1)}
                  selected={picked.includes(l)}
                  onPress={() => set({ levels: toggleLevel(draft.levels, mine, l) })}
                  accessibilityLabel={`Level ${l.toFixed(1)}${mine != null && levelChip(mine) === l ? ", your level" : ""}`}
                />
              ))}
            </ChipRow>
            <Text variant="small" tone="inkMuted" accessibilityLiveRegion="polite">
              {levelsText(draft.levels, mine)}
            </Text>
          </View>

          <View style={{ gap: spacing.space2 }}>
            <Text variant="label" importantForAccessibility="no" accessibilityElementsHidden>
              Plays
            </Text>
            <ChipRow label="Plays">
              {PLAYS.map((p) => (
                <ChoiceChip key={p.value} label={p.label} selected={draft.plays === p.value} onPress={() => set({ plays: p.value })} />
              ))}
            </ChipRow>
          </View>

          <View style={{ gap: spacing.space1 }}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.space3, minHeight: MIN_TAP }}>
              <Text variant="bodyStrong" style={{ flex: 1 }} importantForAccessibility="no" accessibilityElementsHidden>
                Free when I'm free
              </Text>
              <Toggle
                value={draft.free}
                onValueChange={(free) => set({ free })}
                disabled={noTimes}
                accessibilityLabel="Free when I'm free"
                accessibilityHint={noTimes ? "Set your times first." : "Shows players free at the same times as you."}
              />
            </View>
            {noTimes ? (
              <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", columnGap: spacing.space2 }}>
                <Text variant="small" tone="inkMuted">
                  Set your times first.
                </Text>
                <LinkButton label="Set times" accessibilityLabel="Set times: when you can play" onPress={setTimes} />
              </View>
            ) : (
              <Text variant="small" tone="inkMuted">
                Shows players free at the same times as you.
              </Text>
            )}
          </View>
        </>
      ) : null}

      <TextButton
        label="Reset"
        accessibilityLabel="Reset filters"
        disabled={atDefaults}
        onPress={() => {
          setDraft(DEFAULT_FILTERS);
          setDraftRadius(DEFAULT_RADIUS);
        }}
        style={{ alignSelf: "flex-start", paddingHorizontal: 0 }}
      />
    </SheetBody>
  );
}
