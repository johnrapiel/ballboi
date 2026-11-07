// Filters (canvas W2_DiscoverFilters, W2_DiscoverFiltersNoTimes; F3, F8,
// F11). A bottom sheet by the sheet rule: left-aligned brush title, no
// Cancel, drag down to close, and "Discard changes?" when something changed.
// Level (range spelled out), Plays, "Free when I'm free", Reset, and
// "Show N players" with a live count. Distance lives on the tab itself.

import { useRouter } from "expo-router";
import React, { useState } from "react";
import { View } from "react-native";

import { ChipRow, ChoiceChip, LinkButton } from "@/components/discover/Controls";
import { SheetBody, useSheetClose } from "@/components/Sheet";
import { Toggle } from "@/components/Toggle";
import { Button, Text, TextButton } from "@/components/ui";
import { MIN_TAP, spacing } from "@/constants/tokens";
import { useDiscoverMe, useDiscoverPlayers } from "@/hooks/useDiscover";
import { discoverState, useDiscoverState } from "@/hooks/useDiscoverFilters";
import { DEFAULT_FILTERS, levelRangeText, sameFilters, type LevelRange, type PlayerFilters, type PlaysFilter } from "@/lib/discover";

const LEVELS: { value: LevelRange; label: string }[] = [
  { value: "close", label: "Close to mine" },
  { value: "wider", label: "Wider" },
  { value: "any", label: "Any" },
];
const PLAYS: { value: PlaysFilter; label: string }[] = [
  { value: "singles", label: "Singles" },
  { value: "doubles", label: "Doubles" },
  { value: "either", label: "Either" },
];

export default function FiltersSheet() {
  const router = useRouter();
  const { radius, filters } = useDiscoverState();
  const me = useDiscoverMe();
  const noTimes = (me.data?.hoursFree ?? 0) === 0;
  const [draft, setDraft] = useState<PlayerFilters>(() => ({ ...filters, free: filters.free && !noTimes }));
  const dirty = !sameFilters(draft, filters);
  const sheet = useSheetClose(dirty);
  const live = useDiscoverPlayers(radius, draft, !!me.data);
  const n = live.data?.total;

  const set = (patch: Partial<PlayerFilters>) => setDraft((d) => ({ ...d, ...patch }));
  const apply = () => {
    discoverState.setFilters(draft);
    sheet.finish();
  };
  const setTimes = () => sheet.finish(() => router.replace("/availability"));

  return (
    <SheetBody
      title="Filters"
      close={sheet.close}
      footer={
        <Button
          label={n == null ? (live.isError ? "Show players" : "Counting players…") : `Show ${n} ${n === 1 ? "player" : "players"}`}
          onPress={apply}
          loading={live.isFetching && n == null}
        />
      }
    >
      <View style={{ gap: spacing.space2 }}>
        <Text variant="label" importantForAccessibility="no" accessibilityElementsHidden>
          Level
        </Text>
        <ChipRow label="Level">
          {LEVELS.map((l) => (
            <ChoiceChip key={l.value} label={l.label} selected={draft.level === l.value} onPress={() => set({ level: l.value })} />
          ))}
        </ChipRow>
        <Text variant="small" tone="inkMuted">
          {levelRangeText(me.data?.rating ?? null, draft.level)}
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
            accessibilityHint={noTimes ? "Set your times first." : "Shows players whose hours overlap yours."}
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
            Shows players whose hours overlap yours.
          </Text>
        )}
      </View>

      <TextButton
        label="Reset"
        accessibilityLabel="Reset filters"
        disabled={sameFilters(draft, DEFAULT_FILTERS)}
        onPress={() => setDraft(DEFAULT_FILTERS)}
        style={{ alignSelf: "flex-start", paddingHorizontal: 0 }}
      />
    </SheetBody>
  );
}
