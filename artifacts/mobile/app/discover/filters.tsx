import { useGetDiscoverPlayers } from "@workspace/api-client-react";
import { useRouter } from "expo-router";
import React from "react";
import { ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { ChoiceGroup } from "@/components/Choice";
import { Button, Text, TextButton } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { resetDiscoverFilters, setDiscoverFilters, useDiscoverFilters } from "@/hooks/useDiscoverFilters";
import { countAt, FREE_LABEL, FREE_TIMES, levelRangeLabel, RADII, radiusOption, type LevelRange } from "@/lib/discover";

// Discover's Filters sheet (spec: Discover, "Radius: 10 miles by default,
// 5 / 10 / 15 / 30 options, 30 maximum, with a count at each step"; "Players
// near you: filtered by level range, singles or doubles, availability").
// Changes apply as they're picked; Done closes the sheet.

export default function DiscoverFiltersSheet() {
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const filters = useDiscoverFilters();
  const query = useGetDiscoverPlayers(filters);
  const counts = query.data?.counts ?? [];
  const myRating = query.data?.myRating ?? null;

  const levelOption = (value: LevelRange, word: string) => {
    const range = levelRangeLabel(value, myRating);
    return value === "any" || myRating == null
      ? { value, label: word }
      : { value, label: `${word}, ${range}`, accessibilityLabel: `${word}, ${range.replace(" to ", " to level ")}` };
  };

  return (
    <ScrollView
      style={{ backgroundColor: c.linen }}
      contentContainerStyle={{ padding: spacing.space4, paddingBottom: insets.bottom + spacing.space4, gap: spacing.space6 }}
    >
      <Text variant="title" accessibilityRole="header">
        Filters
      </Text>

      <ChoiceGroup
        label="Distance from your home area"
        value={filters.radius}
        onChange={(radius) => setDiscoverFilters({ radius })}
        options={RADII.map((r) => {
          const o = radiusOption(r, countAt(counts, r));
          return { value: r, label: o.label, accessibilityLabel: o.spoken };
        })}
        hint="Distances are approximate. Nobody sees where you live."
      />

      <ChoiceGroup
        label="Level"
        value={filters.level}
        onChange={(level) => setDiscoverFilters({ level })}
        options={[levelOption("near", "Near my level"), levelOption("wider", "Wider"), levelOption("any", "Any level")]}
        hint={myRating == null ? "Set your level in Edit profile to see players near it." : undefined}
      />

      <ChoiceGroup
        label="Plays"
        value={filters.plays}
        onChange={(plays) => setDiscoverFilters({ plays })}
        options={[
          { value: "any", label: "Any" },
          { value: "singles", label: "Singles" },
          { value: "doubles", label: "Doubles" },
        ]}
      />

      <ChoiceGroup
        label="Usually free"
        value={filters.free}
        onChange={(free) => setDiscoverFilters({ free })}
        options={[{ value: "any" as const, label: "Any time" }, ...FREE_TIMES.map((t) => ({ value: t, label: FREE_LABEL[t] }))]}
      />

      <View style={{ gap: spacing.space2 }}>
        <Button label="Done" onPress={() => router.back()} />
        <TextButton label="Reset filters" onPress={resetDiscoverFilters} />
      </View>
    </ScrollView>
  );
}
