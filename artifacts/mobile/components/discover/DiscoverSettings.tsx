import {
  getGetDiscoverPlayersQueryKey,
  getGetMyDiscoverSettingsQueryKey,
  useGetMyDiscoverSettings,
  useUpdateMyDiscoverSettings,
  type DiscoverSettings,
  type DiscoverSettingsInput,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import React from "react";
import { ActivityIndicator, Alert, View } from "react-native";

import { CheckboxCard } from "@/components/CheckboxCard";
import { ChoiceGroup } from "@/components/Choice";
import { Toggle } from "@/components/Toggle";
import { Button, Card, Text } from "@/components/ui";
import { MIN_TAP, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { FREE_LABEL, FREE_TIMES, PLAYS_LABEL, toggleFreeTime, type Plays } from "@/lib/discover";

// Settings > Discover (spec: Discover, "Hidden profile: opt out of discovery
// while keeping leagues and Ball Boi"; "Players near you: filtered by ...
// singles or doubles, availability"). Saved to the account, so other players'
// filters can use them. Each change saves at once and shows at once.

const PLAYS: Plays[] = ["singles", "doubles", "both"];

export function DiscoverSettingsSection() {
  const c = useColors();
  const queryClient = useQueryClient();
  const key = getGetMyDiscoverSettingsQueryKey();
  const settings = useGetMyDiscoverSettings();
  const update = useUpdateMyDiscoverSettings();

  const save = (change: DiscoverSettingsInput) => {
    const before = queryClient.getQueryData<DiscoverSettings>(key);
    if (before) queryClient.setQueryData<DiscoverSettings>(key, { ...before, ...change } as DiscoverSettings);
    update.mutate(
      { data: change },
      {
        onSuccess: (saved) => {
          queryClient.setQueryData(key, saved);
          void queryClient.invalidateQueries({ queryKey: getGetDiscoverPlayersQueryKey() });
        },
        onError: () => {
          if (before) queryClient.setQueryData(key, before);
          Alert.alert("Couldn't save", "Check your connection and try again.");
        },
      },
    );
  };

  if (settings.isPending) return <ActivityIndicator color={c.ink} accessibilityLabel="Loading Discover settings" />;
  if (!settings.data)
    return (
      <Card style={{ gap: spacing.space3 }}>
        <Text accessibilityRole="alert">Couldn't load your Discover settings.</Text>
        <Button variant="secondary" label="Try again" loading={settings.isRefetching} onPress={() => void settings.refetch()} />
      </Card>
    );

  const s = settings.data;
  const shown = !s.hidden;
  const showBody = "Players near you can find you, see your level and approximate distance, and message you. Your leagues and Ball Boi work either way.";

  return (
    <View style={{ gap: spacing.space4 }}>
      <Card style={{ gap: spacing.space3 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.space3, minHeight: MIN_TAP }}>
          <Text variant="bodyStrong" style={{ flex: 1 }} importantForAccessibility="no" accessibilityElementsHidden>
            Show me in Discover
          </Text>
          <Toggle
            value={shown}
            onValueChange={(on) => save({ hidden: !on })}
            accessibilityLabel="Show me in Discover"
            accessibilityHint={showBody}
          />
        </View>
        <Text tone="inkMuted">{showBody}</Text>
      </Card>

      <Card style={{ gap: spacing.space3 }}>
        <ChoiceGroup<Plays | "unset">
          label="What you play"
          value={s.plays ?? "unset"}
          onChange={(v) => v !== "unset" && save({ plays: v })}
          options={PLAYS.map((p) => ({ value: p, label: PLAYS_LABEL[p] }))}
          hint="Players filtering for singles or doubles see you when it matches."
        />
      </Card>

      <Card style={{ gap: spacing.space3 }}>
        <Text variant="label" accessibilityRole="header">
          Usually free
        </Text>
        <View style={{ gap: spacing.space2 }}>
          {FREE_TIMES.map((t) => (
            <CheckboxCard
              key={t}
              title={FREE_LABEL[t]}
              checked={s.freeTimes.includes(t)}
              onPress={() => save({ freeTimes: toggleFreeTime(s.freeTimes, t) })}
            />
          ))}
        </View>
        <Text variant="small" tone="inkMuted">
          Shown on your Discover profile, and used when players filter by when they're free.
        </Text>
      </Card>
    </View>
  );
}
