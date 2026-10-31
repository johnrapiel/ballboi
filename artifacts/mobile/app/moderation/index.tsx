import { Stack, useRouter } from "expo-router";
import { SymbolView } from "expo-symbols";
import React, { useState } from "react";
import { ActivityIndicator, Alert, FlatList, Pressable, RefreshControl, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { EmptyState } from "@/components/EmptyState";
import { Segmented } from "@/components/moderation/Segmented";
import { Button, Card, Text } from "@/components/ui";
import { spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import {
  useIsAdmin,
  useModerationActions,
  useOpenAppeals,
  useOpenReports,
  usePendingDecisions,
  type AgentDecision,
  type Appeal,
  type Report,
} from "@/hooks/useModeration";
import { agentActionLabel, ago, reasonLabel, sourceLabel } from "@/lib/moderation";

// Moderation (admin only). Spec: Enforcement ladder. Three lists:
// - Reports: everything open in /api/admin/reports, oldest problems first in
//   the queue the server returns. Opening one shows the conversation and actions.
// - Agent: the Claude agent's decisions, each to confirm or undo.
// - Appeals: the one appeal per ban or suspension, to keep or overturn.

type Box = "reports" | "agent" | "appeals";

const headerOptions = (c: ReturnType<typeof useColors>) =>
  ({
    headerShown: true,
    title: "Moderation",
    headerBackButtonDisplayMode: "minimal",
    headerShadowVisible: false,
    headerTintColor: c.ink,
    headerStyle: { backgroundColor: c.paper },
    headerTitleStyle: { fontFamily: "DMSans_600SemiBold", color: c.ink },
  }) as const;

export default function ModerationScreen() {
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { isAdmin, isPending: checkingAdmin } = useIsAdmin();
  const [box, setBox] = useState<Box>("reports");
  const reports = useOpenReports(isAdmin);
  const decisions = usePendingDecisions(isAdmin);
  const appeals = useOpenAppeals(isAdmin);
  const actions = useModerationActions();
  const [busy, setBusy] = useState<string | null>(null);

  if (checkingAdmin) {
    return (
      <View style={{ flex: 1, backgroundColor: c.paper }}>
        <Stack.Screen options={headerOptions(c)} />
        <ActivityIndicator style={{ marginTop: spacing.space12 }} color={c.ink} accessibilityLabel="Loading" />
      </View>
    );
  }
  if (!isAdmin) {
    return (
      <View style={{ flex: 1, backgroundColor: c.paper }}>
        <Stack.Screen options={headerOptions(c)} />
        <EmptyState symbol="lock" title="Moderators only" message="This screen is for the Ball Boi moderator." />
      </View>
    );
  }

  const run = (key: string, p: () => Promise<unknown>) => {
    setBusy(key);
    p()
      .catch((e: Error) => Alert.alert("Didn't work", e.message))
      .finally(() => setBusy(null));
  };

  const confirmDecision = (d: AgentDecision) => run(`d${d.id}`, () => actions.decide(d.id, "confirm"));
  const undoDecision = (d: AgentDecision) =>
    Alert.alert("Undo this decision?", "This reverses what the agent did and puts the report back in your queue.", [
      { text: "Cancel", style: "cancel" },
      { text: "Undo", style: "destructive", onPress: () => run(`d${d.id}`, () => actions.decide(d.id, "undo")) },
    ]);

  const decideAppeal = (a: Appeal, outcome: "upheld" | "overturned") => {
    const what = a.sanction?.kind === "suspend" ? "suspension" : "ban";
    const title = outcome === "overturned" ? `Overturn the ${what}?` : `Keep the ${what}?`;
    const body =
      outcome === "overturned"
        ? `${a.name ?? "They"} can use Ball Boi again right away. Reply to their email to let them know.`
        : `The ${what} stays and they can't appeal again. Reply to their email to let them know.`;
    Alert.alert(title, body, [
      { text: "Cancel", style: "cancel" },
      {
        text: outcome === "overturned" ? "Overturn" : `Keep ${what}`,
        onPress: () => run(`a${a.id}`, () => actions.decideAppeal(a.id, outcome)),
      },
    ]);
  };

  const active = box === "reports" ? reports : box === "agent" ? decisions : appeals;
  const refreshing = active.isRefetching;

  return (
    <View style={{ flex: 1, backgroundColor: c.paper }}>
      <Stack.Screen options={headerOptions(c)} />
      <View style={{ paddingTop: spacing.space3 }}>
        <Segmented<Box>
          value={box}
          onChange={setBox}
          segments={[
            { key: "reports", label: "Reports", count: reports.data?.length },
            { key: "agent", label: "Agent", count: decisions.data?.length },
            { key: "appeals", label: "Appeals", count: appeals.data?.length },
          ]}
        />
      </View>

      {active.isPending ? (
        <ActivityIndicator style={{ marginTop: spacing.space12 }} color={c.ink} accessibilityLabel="Loading" />
      ) : active.isError ? (
        <View style={{ padding: spacing.space6, gap: spacing.space4, alignItems: "center" }}>
          <Text tone="inkMuted" style={{ textAlign: "center" }}>
            {active.error.message}
          </Text>
          <Button label="Try again" variant="secondary" onPress={() => void active.refetch()} />
        </View>
      ) : (
        <FlatList<Report | AgentDecision | Appeal>
          data={(active.data ?? []) as (Report | AgentDecision | Appeal)[]}
          keyExtractor={(item) => String(item.id)}
          refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void active.refetch()} tintColor={c.ink} />}
          contentContainerStyle={{ flexGrow: 1, gap: spacing.space3, paddingHorizontal: spacing.space4, paddingBottom: insets.bottom + spacing.space6 }}
          renderItem={({ item }) =>
            box === "reports" ? (
              <ReportRow report={item as Report} onPress={() => router.push({ pathname: "/moderation/report/[id]", params: { id: String(item.id) } })} />
            ) : box === "agent" ? (
              <DecisionRow
                decision={item as AgentDecision}
                busy={busy === `d${item.id}`}
                onConfirm={() => confirmDecision(item as AgentDecision)}
                onUndo={() => undoDecision(item as AgentDecision)}
                onOpen={() =>
                  router.push({ pathname: "/moderation/report/[id]", params: { id: String((item as AgentDecision).reportId) } })
                }
              />
            ) : (
              <AppealRow
                appeal={item as Appeal}
                busy={busy === `a${item.id}`}
                onKeep={() => decideAppeal(item as Appeal, "upheld")}
                onOverturn={() => decideAppeal(item as Appeal, "overturned")}
              />
            )
          }
          ListEmptyComponent={
            <View style={{ flex: 1, minHeight: 320 }}>
              {box === "reports" ? (
                <EmptyState symbol="checkmark.shield" title="No open reports" message="Every report has been handled." />
              ) : box === "agent" ? (
                <EmptyState symbol="checkmark.circle" title="Nothing to review" message="The agent's decisions show up here for you to confirm or undo." />
              ) : (
                <EmptyState symbol="envelope" title="No open appeals" message="Banned and suspended players can appeal once by email." />
              )}
            </View>
          }
        />
      )}
    </View>
  );
}

function ReportRow({ report, onPress }: { report: Report; onPress: () => void }) {
  const c = useColors();
  const who = report.subjectName ?? "Unknown player";
  const lines = [reasonLabel(report.reason), `${sourceLabel(report.source)} · ${ago(report.createdAt)}`];
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${who}. ${lines.join(". ")}`}
      accessibilityHint="Opens the report"
      style={({ pressed }) => ({ opacity: pressed ? 0.8 : 1 })}
    >
      <Card style={{ flexDirection: "row", alignItems: "center", gap: spacing.space3 }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text variant="bodyStrong">{who}</Text>
          <Text>{lines[0]}</Text>
          <Text variant="small" tone="inkMuted">
            {lines[1]}
          </Text>
        </View>
        <SymbolView name="chevron.right" size={13} tintColor={c.inkMuted} />
      </Card>
    </Pressable>
  );
}

function DecisionRow({
  decision,
  busy,
  onConfirm,
  onUndo,
  onOpen,
}: {
  decision: AgentDecision;
  busy: boolean;
  onConfirm: () => void;
  onUndo: () => void;
  onOpen: () => void;
}) {
  return (
    <Card style={{ gap: spacing.space3 }}>
      <Pressable
        onPress={onOpen}
        accessibilityRole="button"
        accessibilityLabel={`${agentActionLabel(decision.action)}. ${decision.reason}. Report ${decision.reportId}, ${ago(decision.createdAt)}`}
        accessibilityHint="Opens the report"
        style={{ gap: 2, minHeight: 44 }}
      >
        <Text variant="bodyStrong">{agentActionLabel(decision.action)}</Text>
        <Text>{decision.reason}</Text>
        <Text variant="small" tone="inkMuted">
          Report {decision.reportId} · {ago(decision.createdAt)}
        </Text>
      </Pressable>
      <View style={{ flexDirection: "row", gap: spacing.space2 }}>
        <Button label="Confirm" loading={busy} onPress={onConfirm} style={{ flex: 1 }} accessibilityLabel={`Confirm: ${agentActionLabel(decision.action)}`} />
        <Button label="Undo" variant="secondary" disabled={busy} onPress={onUndo} style={{ flex: 1 }} accessibilityLabel={`Undo: ${agentActionLabel(decision.action)}`} />
      </View>
    </Card>
  );
}

function AppealRow({ appeal, busy, onKeep, onOverturn }: { appeal: Appeal; busy: boolean; onKeep: () => void; onOverturn: () => void }) {
  const what = appeal.sanction?.kind === "suspend" ? "suspension" : "ban";
  const who = appeal.name ?? "A player";
  return (
    <Card style={{ gap: spacing.space3 }}>
      <View accessible accessibilityLabel={`${who} appealed a ${what}. Reference ${appeal.reference}. ${appeal.sanction?.reason ?? ""}. ${ago(appeal.createdAt)}`} style={{ gap: 2 }}>
        <Text variant="bodyStrong">
          {who} appealed a {what}
        </Text>
        <Text>Find their email to support with “Appeal {appeal.reference}” in the subject.</Text>
        {appeal.sanction ? (
          <Text variant="small" tone="inkMuted">
            Reason for the {what}: {appeal.sanction.reason}
          </Text>
        ) : null}
        <Text variant="small" tone="inkMuted">
          {ago(appeal.createdAt)}
        </Text>
      </View>
      <View style={{ flexDirection: "row", gap: spacing.space2 }}>
        <Button label={`Keep ${what}`} loading={busy} onPress={onKeep} style={{ flex: 1 }} />
        <Button label="Overturn" variant="secondary" disabled={busy} onPress={onOverturn} style={{ flex: 1 }} />
      </View>
    </Card>
  );
}
