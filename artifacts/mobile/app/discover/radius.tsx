// Custom distance (canvas W2_DiscoverRadius; brief: 1 to 50 miles, decision 196). A slider,
// with a typed value as the non-drag alternative, and a live count. One
// distance for Players, Open leagues and Open matches. A bottom sheet by the
// sheet rule.

import React, { useState } from "react";
import { View } from "react-native";

import { RadiusSlider } from "@/components/discover/RadiusSlider";
import { SheetBody, useSheetClose } from "@/components/Sheet";
import { Button, Field, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useDiscoverMe, useDiscoverPlayers, useSaveRadius } from "@/hooks/useDiscover";
import { discoverState, useDiscoverState } from "@/hooks/useDiscoverFilters";
import { useDiscoverLeagues } from "@/hooks/useDiscoverLeagues";
import { useOpenMatches } from "@/hooks/useDiscoverOpenMatches";
import { MAX_RADIUS, MIN_RADIUS, clampRadius } from "@/lib/discover";

export default function RadiusSheet() {
  const { tab, radius, filters } = useDiscoverState();
  const me = useDiscoverMe();
  const [value, setValue] = useState(radius);
  const [typed, setTyped] = useState(String(radius));
  const sheet = useSheetClose(value !== radius);
  // Counts what the tab you came from lists.
  const players = useDiscoverPlayers(value, filters, !!me.data && tab === "players");
  const leagues = useDiscoverLeagues(value, !!me.data && tab === "leagues");
  const matches = useOpenMatches(value, !!me.data && tab === "matches");
  const live = tab === "players" ? players : tab === "leagues" ? leagues : matches;
  const n = live.data && !live.isFetching ? live.data.total : null;
  const [one, many] = tab === "players" ? ["player", "players"] : tab === "leagues" ? ["Open league", "Open leagues"] : ["open match", "open matches"];
  const save = useSaveRadius();

  const pick = (v: number) => {
    setValue(v);
    setTyped(String(v));
  };

  const apply = () => {
    discoverState.setRadius(value);
    save.mutate(value);
    sheet.finish();
  };

  const typedNumber = Number(typed);
  const typedOk = typed !== "" && Number.isInteger(typedNumber) && typedNumber >= MIN_RADIUS && typedNumber <= MAX_RADIUS;

  return (
    <SheetBody
      title="Distance"
      close={sheet.close}
      footer={
        <Button label={n == null ? `Show ${many} within ${value} mi` : `Show ${n} ${n === 1 ? one : many}`} onPress={apply} />
      }
    >
      <Text accessibilityLiveRegion="polite" variant="bodyStrong" style={{ fontVariant: ["tabular-nums"] }}>
        {n == null ? `${value} mi` : `${value} mi · ${n} ${n === 1 ? one : many}`}
      </Text>
      <View style={{ gap: spacing.space1 }}>
        <RadiusSlider value={value} onChange={pick} label="Distance" />
        <View
          style={{ flexDirection: "row", justifyContent: "space-between" }}
          importantForAccessibility="no-hide-descendants"
          accessibilityElementsHidden
        >
          <Text variant="small" tone="inkMuted">
            {`${MIN_RADIUS} mi`}
          </Text>
          <Text variant="small" tone="inkMuted">
            {`${MAX_RADIUS} mi`}
          </Text>
        </View>
      </View>
      <Field
        label="Miles"
        value={typed}
        onChangeText={(v) => {
          const digits = v.replace(/\D/g, "").slice(0, 2);
          setTyped(digits);
          const n2 = Number(digits);
          if (digits && n2 >= MIN_RADIUS && n2 <= MAX_RADIUS) setValue(clampRadius(n2));
        }}
        keyboardType="number-pad"
        maxLength={2}
        returnKeyType="done"
        error={typed !== "" && !typedOk}
        hint={
          typed !== "" && !typedOk
            ? `Pick ${MIN_RADIUS} to ${MAX_RADIUS} miles.`
            : `Type any distance from ${MIN_RADIUS} to ${MAX_RADIUS} miles.`
        }
      />
    </SheetBody>
  );
}
