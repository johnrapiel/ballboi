import { Stack, useRouter } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import { AccessibilityInfo, ActionSheetIOS, ActivityIndicator, Alert, FlatList, KeyboardAvoidingView, Platform, Pressable, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { HeaderIconButton } from "@/components/Choice";
import { MessageBubble, type BubbleStatus } from "@/components/messages/MessageBubble";
import { Button, Text, useTypeStyle } from "@/components/ui";
import { MIN_TAP, radius, spacing } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { MessagesApiError, groupPage, useGroupThread, useMessagesActions, useOlderMessages, type GroupMessage } from "@/hooks/useMessages";
import { useReportBlock } from "@/hooks/useReportBlock";
import { newClientMessageId } from "@/lib/messages";

// A group chat (F15, John, Nov 8): an open match's chat once its last spot
// fills (canvas W2_GroupChat, W2_DropOut). It runs on the same messaging
// service as Messages and shows there, with the same safety:
// - Long-press any player's message (or the VoiceOver action) to report it;
//   the server keeps a snapshot of the chat with the report.
// - A first message from someone outside your leagues can't carry links,
//   phone numbers or emails; the server says why and the text comes back.
// - Players you have a block with are left out of your view.
// - Lines from Ball Boi ("All 4 spots filled") are centered.
// Players in the header opens the players sheet (Remove for the poster, Drop
// out for everyone else). While a spot is open again, or after a cancel, the
// chat is read only with the reason in words.

interface Pending {
  clientId: string;
  text: string;
  at: string;
  status: Exclude<BubbleStatus, "sent">;
}

type Row = {
  key: string;
  text: string;
  at: string;
  fromMe: boolean;
  status: BubbleStatus;
  /** Null: a line from Ball Boi. */
  senderName: string | null;
  message?: GroupMessage;
  clientId?: string;
};

export function GroupConversation({
  groupId,
  fallbackTitle,
  fallbackOpenMatchId,
}: {
  /** Null while the open match is still finding its chat. */
  groupId: number | null;
  fallbackTitle?: string;
  fallbackOpenMatchId?: number;
}) {
  const c = useColors();
  const body = useTypeStyle("body");
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const thread = useGroupThread(groupId);
  const history = useOlderMessages<GroupMessage>(groupId, thread.data, groupPage);
  const actions = useMessagesActions();
  const report = useReportBlock();
  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);

  const group = thread.data?.group;
  const title = group?.title ?? fallbackTitle ?? "Group chat";
  const openMatchId = group?.openMatchId ?? fallbackOpenMatchId ?? null;
  const subtitle = group ? `${group.memberCount} ${group.memberCount === 1 ? "player" : "players"}` : "";

  // Read new lines out as they arrive.
  const seen = useRef<Set<string> | null>(null);
  useEffect(() => {
    const messages = thread.data?.messages;
    if (!messages) return;
    if (!seen.current) {
      seen.current = new Set(messages.map((m) => m.id));
      return;
    }
    const fresh = messages.filter((m) => !seen.current!.has(m.id));
    fresh.forEach((m) => seen.current!.add(m.id));
    const incoming = fresh.filter((m) => !m.fromMe);
    if (incoming.length === 1) {
      const m = incoming[0];
      AccessibilityInfo.announceForAccessibility(m.senderName ? `New message from ${m.senderName}: ${m.text}` : m.text);
    } else if (incoming.length > 1) AccessibilityInfo.announceForAccessibility(`${incoming.length} new messages in ${title}`);
  }, [thread.data?.messages, title]);

  const serverMessages = useMemo(() => {
    const latest = thread.data?.messages ?? [];
    if (!history.older.length) return latest;
    const shown = new Set(history.older.map((m) => m.id));
    return [...history.older, ...latest.filter((m) => !shown.has(m.id))];
  }, [thread.data?.messages, history.older]);

  const rows: Row[] = useMemo(() => {
    const sent: Row[] = serverMessages.map((m) => ({
      key: m.id,
      text: m.text,
      at: m.at,
      fromMe: m.fromMe,
      status: "sent",
      senderName: m.senderName,
      message: m,
    }));
    // A pending message disappears once the server has it (its id ends with our client id).
    const waiting = pending
      .filter((p) => !serverMessages.some((m) => m.id.endsWith(`-${p.clientId}`)))
      .map<Row>((p) => ({ key: p.clientId, text: p.text, at: p.at, fromMe: true, status: p.status, senderName: "You", clientId: p.clientId }));
    // Inverted list: newest first.
    return [...sent, ...waiting].sort((a, b) => a.at.localeCompare(b.at)).reverse();
  }, [serverMessages, pending]);

  const showNotice = (text: string) => {
    setNotice(text);
    AccessibilityInfo.announceForAccessibility(text);
  };

  async function deliver(clientId: string, text: string) {
    if (!groupId) return;
    setPending((list) => list.map((p) => (p.clientId === clientId ? { ...p, status: "sending" } : p)));
    try {
      await actions.sendToGroup(groupId, text, clientId);
      await thread.refetch();
    } catch (e) {
      const err = e as MessagesApiError;
      if (err.status === 0 || err.status >= 500) {
        // Connection trouble: a failed bubble to retry, and VoiceOver hears it.
        setPending((list) => list.map((p) => (p.clientId === clientId ? { ...p, status: "failed" } : p)));
        AccessibilityInfo.announceForAccessibility("Message not sent. Double-tap it to retry.");
        return;
      }
      // The server said no (the filter, or the chat closed): put the text back and say why.
      setPending((list) => list.filter((p) => p.clientId !== clientId));
      setDraft((d) => (d ? d : text));
      showNotice(err.message);
      if (err.code === "closed") void thread.refetch();
    }
  }

  const send = () => {
    const text = draft.trim();
    if (!text || !groupId) return;
    const clientId = newClientMessageId();
    setNotice(null);
    setDraft("");
    setPending((list) => [...list, { clientId, text, at: new Date().toISOString(), status: "sending" }]);
    void deliver(clientId, text);
  };

  const retry = (clientId: string) => {
    const p = pending.find((x) => x.clientId === clientId);
    if (p) void deliver(clientId, p.text);
  };

  const canReport = (m?: GroupMessage) => !!m && !m.fromMe && m.senderName !== null && (m.senderPlayerId !== null || m.senderUserId !== null);

  const reportMessage = (m: GroupMessage) => {
    if (!groupId || !canReport(m)) return;
    report.open({ id: m.senderPlayerId, userId: m.senderUserId, name: m.senderName ?? "this player" }, { groupId, messageId: m.id });
  };

  // Long press: Report is the only action (finding 20).
  const messageMenu = (m: GroupMessage) => {
    const name = m.senderName ?? "Player";
    if (Platform.OS === "ios") {
      ActionSheetIOS.showActionSheetWithOptions({ title: name, options: ["Report message", "Cancel"], cancelButtonIndex: 1 }, (i) => {
        if (i === 0) reportMessage(m);
      });
      return;
    }
    Alert.alert(name, undefined, [
      { text: "Report message", onPress: () => reportMessage(m) },
      { text: "Cancel", style: "cancel" },
    ]);
  };

  const canSend = group?.canSend ?? false;
  const loading = groupId === null || thread.isPending;

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: c.paper }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={insets.top + 44}
    >
      <Stack.Screen
        options={{
          headerShown: true,
          headerBackButtonDisplayMode: "minimal",
          headerShadowVisible: false,
          headerTintColor: c.ink,
          headerStyle: { backgroundColor: c.paper },
          headerTitle: () => (
            <View accessible accessibilityRole="header" accessibilityLabel={subtitle ? `${title}. ${subtitle}` : title} style={{ alignItems: "center", maxWidth: 240 }}>
              <Text variant="bodyStrong" numberOfLines={1} maxFontSizeMultiplier={1.4}>
                {title}
              </Text>
              {subtitle ? (
                <Text variant="small" tone="inkMuted" numberOfLines={1} maxFontSizeMultiplier={1.4}>
                  {subtitle}
                </Text>
              ) : null}
            </View>
          ),
          headerRight: openMatchId
            ? () => (
                <HeaderIconButton
                  symbol="person.2"
                  label="Players"
                  hint="Who's in, and dropping out"
                  onPress={() => router.push({ pathname: "/discover/match/players/[id]", params: { id: String(openMatchId) } })}
                />
              )
            : undefined,
        }}
      />

      {thread.isError && !thread.data ? (
        <View style={{ flex: 1, padding: spacing.space6, gap: spacing.space4, alignItems: "center", justifyContent: "center" }}>
          <Text tone="inkMuted" style={{ textAlign: "center" }} accessibilityLiveRegion="polite">
            {thread.error.message}
          </Text>
          <Button label="Try again" variant="secondary" onPress={() => void thread.refetch()} />
        </View>
      ) : loading ? (
        <ActivityIndicator style={{ flex: 1 }} color={c.ink} accessibilityLabel="Loading the group chat" />
      ) : (
        <FlatList
          inverted
          data={rows}
          keyExtractor={(r) => r.key}
          contentContainerStyle={{ paddingVertical: spacing.space3 }}
          keyboardDismissMode="interactive"
          // Inverted: the end is the top, where earlier messages load.
          onEndReached={history.hasMore ? history.loadMore : undefined}
          onEndReachedThreshold={0.5}
          ListFooterComponent={
            history.loading ? (
              <ActivityIndicator style={{ paddingVertical: spacing.space4 }} color={c.ink} accessibilityLabel="Loading earlier messages" />
            ) : history.error && history.hasMore ? (
              <View style={{ alignItems: "center", gap: spacing.space2, paddingVertical: spacing.space4 }}>
                <Text variant="small" tone="inkMuted" style={{ textAlign: "center" }}>
                  Earlier messages didn't load. {history.error}
                </Text>
                <Button label="Try again" variant="secondary" onPress={history.loadMore} />
              </View>
            ) : undefined
          }
          renderItem={({ item, index }) => {
            if (item.senderName === null) {
              return (
                <View accessible accessibilityRole="text" style={{ paddingHorizontal: spacing.space8, paddingVertical: spacing.space2 }}>
                  <Text variant="small" tone="inkMuted" style={{ textAlign: "center" }}>
                    {item.text}
                  </Text>
                </View>
              );
            }
            // The sender's name over their first message in a run (the row after is the one before in time).
            // Keyed by account, so two players with the same name still each get theirs.
            const before = rows[index + 1];
            const who = (r?: Row) => (r ? (r.fromMe ? "me" : `${r.message?.senderUserId ?? r.message?.senderPlayerId ?? ""}:${r.senderName}`) : null);
            const showName = !item.fromMe && (!before || before.senderName === null || who(before) !== who(item));
            const m = item.message;
            return (
              <View>
                {showName ? (
                  <Text
                    variant="small"
                    tone="inkMuted"
                    style={{ paddingHorizontal: spacing.space4 + 4, marginTop: spacing.space2 }}
                    importantForAccessibility="no"
                    accessibilityElementsHidden
                  >
                    {item.senderName}
                  </Text>
                ) : null}
                <MessageBubble
                  text={item.text}
                  at={item.at}
                  fromMe={item.fromMe}
                  senderName={item.fromMe ? "You" : item.senderName}
                  status={item.status}
                  onRetry={item.clientId ? () => retry(item.clientId!) : undefined}
                  onReport={canReport(m) ? () => reportMessage(m!) : undefined}
                  onLongPress={canReport(m) ? () => messageMenu(m!) : undefined}
                />
              </View>
            );
          }}
          ListEmptyComponent={
            // Inverted lists flip their children; flip the empty state back.
            <View style={{ transform: [{ scaleY: -1 }], padding: spacing.space8, alignItems: "center" }}>
              <Text tone="inkMuted" style={{ textAlign: "center" }}>
                Say hi and settle the details.
              </Text>
            </View>
          }
        />
      )}

      <View
        style={{
          borderTopWidth: 1,
          borderTopColor: c.hairline,
          backgroundColor: c.linen,
          paddingHorizontal: spacing.space4,
          paddingTop: spacing.space2,
          paddingBottom: insets.bottom + spacing.space2,
          gap: spacing.space2,
        }}
      >
        {notice ? (
          <Text variant="small" tone="danger" accessibilityLiveRegion="polite">
            {notice}
          </Text>
        ) : null}
        {group && !canSend ? (
          <Text tone="inkMuted" style={{ textAlign: "center", paddingVertical: spacing.space3 }}>
            {group.sendBlockedReason ?? "This chat is closed."}
          </Text>
        ) : (
          <View style={{ flexDirection: "row", alignItems: "flex-end", gap: spacing.space2 }}>
            <TextInput
              value={draft}
              onChangeText={(t) => {
                setDraft(t);
                if (notice) setNotice(null);
              }}
              editable={!!group}
              placeholder="Message"
              placeholderTextColor={c.inkMuted}
              accessibilityLabel={`Message ${title}`}
              multiline
              maxLength={2000}
              maxFontSizeMultiplier={body.maxFontSizeMultiplier}
              style={[
                body.style,
                {
                  flex: 1,
                  minHeight: MIN_TAP,
                  maxHeight: 140,
                  paddingHorizontal: spacing.space3,
                  paddingTop: 11,
                  paddingBottom: 11,
                  borderRadius: radius.radiusLg,
                  borderWidth: 1,
                  borderColor: c.hairlineStrong,
                  backgroundColor: c.paper,
                  color: c.ink,
                },
              ]}
            />
            <Pressable
              onPress={send}
              disabled={!draft.trim() || !group}
              accessibilityRole="button"
              accessibilityLabel="Send"
              accessibilityState={{ disabled: !draft.trim() || !group }}
              style={({ pressed }) => ({
                minWidth: MIN_TAP,
                minHeight: MIN_TAP,
                paddingHorizontal: spacing.space4,
                borderRadius: radius.radiusPill,
                backgroundColor: c.ink,
                alignItems: "center",
                justifyContent: "center",
                opacity: !draft.trim() || !group ? 0.5 : pressed ? 0.85 : 1,
              })}
            >
              <Text variant="button" tone="onInk">
                Send
              </Text>
            </Pressable>
          </View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}
