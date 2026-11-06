import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActionSheetIOS,
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { IconButton } from "@/components/Choice";
import { MessageBubble, type BubbleStatus } from "@/components/messages/MessageBubble";
import { Button, Text } from "@/components/ui";
import { MIN_TAP, radius, spacing, type } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { MessagesApiError, useMessagesActions, useOlderMessages, useThread, type Message } from "@/hooks/useMessages";
import { useReportBlock } from "@/hooks/useReportBlock";
import { newClientMessageId } from "@/lib/messages";

// A conversation (spec: Messaging and moderation). Opens from Messages, from
// New message, and later from a player card with id "new" plus playerId.
// - Every message goes straight to the inbox; there are no Message Requests
//   (finding 17).
// - Every message from the other player can be reported with a long press or
//   a VoiceOver action, and the More button in the header reports the player
//   without a gesture. Report is the only action; blocking is a checkbox in
//   the Report sheet (finding 20). A chat with someone you blocked stays,
//   read only, with an Unblock link.
// - New messages are announced to VoiceOver. Failed sends say "Not sent. Tap
//   to retry", keep their text, and are announced too. Retrying is always
//   safe: the server sends a message once per client id.
// - The latest 50 messages stay fresh; scrolling up loads earlier ones, a page
//   at a time, until the first.

interface Pending {
  clientId: string;
  text: string;
  at: string;
  status: Exclude<BubbleStatus, "sent">;
}

type Row = { key: string; text: string; at: string; fromMe: boolean; status: BubbleStatus; serverId?: string; clientId?: string };

function chooseIOS(title: string, options: string[], destructiveIndex: number | undefined, onPick: (i: number) => void) {
  if (Platform.OS === "ios") {
    ActionSheetIOS.showActionSheetWithOptions(
      { title, options: [...options, "Cancel"], cancelButtonIndex: options.length, destructiveButtonIndex: destructiveIndex },
      (i) => {
        if (i < options.length) onPick(i);
      },
    );
    return;
  }
  Alert.alert(title, undefined, [
    ...options.map((o, i) => ({ text: o, onPress: () => onPick(i), style: i === destructiveIndex ? ("destructive" as const) : undefined })),
    { text: "Cancel", style: "cancel" as const },
  ]);
}

export default function ConversationScreen() {
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id: string; playerId?: string; name?: string }>();
  const startPlayerId = params.playerId ? Number(params.playerId) : null;

  const [conversationId, setConversationId] = useState<number | null>(() => {
    const n = Number(params.id);
    return params.id !== "new" && Number.isInteger(n) && n > 0 ? n : null;
  });
  const [lookingUp, setLookingUp] = useState(params.id === "new" && startPlayerId !== null);
  const thread = useThread(conversationId);
  const history = useOlderMessages(conversationId, thread.data);
  const actions = useMessagesActions();

  const conversation = thread.data?.conversation;
  const name = conversation?.other.name ?? params.name ?? "Player";
  const playerId = conversation?.other.playerId ?? startPlayerId;

  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);

  const reportBlock = useReportBlock();
  const [unblocking, setUnblocking] = useState(false);

  // Opened from a player: reuse an existing conversation with them.
  useEffect(() => {
    if (params.id !== "new" || startPlayerId === null) return;
    actions
      .conversationWithPlayer(startPlayerId)
      .then((r) => {
        if (r.conversationId) setConversationId(r.conversationId);
      })
      .catch(() => undefined)
      .finally(() => setLookingUp(false));
    // Only on open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Announce messages that arrive while the conversation is open.
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
    if (incoming.length === 1) AccessibilityInfo.announceForAccessibility(`New message from ${name}: ${incoming[0].text}`);
    else if (incoming.length > 1) AccessibilityInfo.announceForAccessibility(`${incoming.length} new messages from ${name}`);
  }, [thread.data?.messages, name]);

  const serverMessages: Message[] = useMemo(() => {
    const latest = thread.data?.messages ?? [];
    if (!history.older.length) return latest;
    const shown = new Set(history.older.map((m) => m.id));
    return [...history.older, ...latest.filter((m) => !shown.has(m.id))];
  }, [thread.data?.messages, history.older]);
  const rows: Row[] = useMemo(() => {
    const sent: Row[] = serverMessages.map((m) => ({ key: m.id, text: m.text, at: m.at, fromMe: m.fromMe, status: "sent", serverId: m.id }));
    // A pending message disappears once the server has it (its id ends with our client id).
    const waiting = pending
      .filter((p) => !serverMessages.some((m) => m.id.endsWith(`-${p.clientId}`)))
      .map<Row>((p) => ({ key: p.clientId, text: p.text, at: p.at, fromMe: true, status: p.status, clientId: p.clientId }));
    return [...sent, ...waiting].reverse(); // inverted list: newest first
  }, [serverMessages, pending]);

  const showNotice = (text: string) => {
    setNotice(text);
    AccessibilityInfo.announceForAccessibility(text);
  };

  async function deliver(clientId: string, text: string) {
    setPending((list) => list.map((p) => (p.clientId === clientId ? { ...p, status: "sending" } : p)));
    try {
      if (conversationId) {
        await actions.send(conversationId, text, clientId);
      } else if (startPlayerId !== null) {
        const res = await actions.start(startPlayerId, text, clientId);
        setConversationId(res.conversationId);
        router.setParams({ id: String(res.conversationId) });
      }
      await actions.refresh();
    } catch (e) {
      const err = e as MessagesApiError;
      if (err.status === 0 || err.status >= 500) {
        // Connection trouble: keep it as a failed bubble the player can retry, and tell VoiceOver.
        setPending((list) => list.map((p) => (p.clientId === clientId ? { ...p, status: "failed" } : p)));
        AccessibilityInfo.announceForAccessibility("Message not sent. Double-tap it to retry.");
        return;
      }
      // The server said no (filter, blocked, limits): put the text back and say why.
      setPending((list) => list.filter((p) => p.clientId !== clientId));
      setDraft((d) => (d ? d : text));
      showNotice(err.message);
      if (err.code === "blocked") actions.refresh();
    }
  }

  const send = () => {
    const text = draft.trim();
    if (!text) return;
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

  const reportMessage = (messageId: string) => {
    if (!conversationId || !playerId) return;
    reportBlock.open({ id: playerId, name }, { conversationId, messageId });
  };

  // Long press: Report is the only action (finding 20).
  const messageMenu = (messageId: string) => chooseIOS(name, ["Report message"], undefined, () => reportMessage(messageId));
  const playerMenu = () => {
    if (playerId) chooseIOS(name, [`Report ${name}`], undefined, () => reportBlock.open({ id: playerId, name }));
  };

  const blocked = !!conversation?.blocked;
  const unblock = () => {
    if (!playerId || unblocking) return;
    setUnblocking(true);
    void reportBlock.unblock({ id: playerId, name }).finally(() => setUnblocking(false));
  };

  const canSend = conversation ? conversation.canSend : startPlayerId !== null;
  const loading = lookingUp || (conversationId !== null && thread.isPending);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: c.paper }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={insets.top + 44}
    >
      <Stack.Screen
        options={{
          headerShown: true,
          title: name,
          headerBackButtonDisplayMode: "minimal",
          headerShadowVisible: false,
          headerTintColor: c.ink,
          headerStyle: { backgroundColor: c.paper },
          headerTitleStyle: { fontFamily: "DMSans_600SemiBold", color: c.ink },
          headerRight: playerId ? () => <IconButton symbol="ellipsis" label={`More options for ${name}`} onPress={playerMenu} /> : undefined,
        }}
      />

      {loading ? (
        <ActivityIndicator style={{ flex: 1 }} color={c.ink} accessibilityLabel="Loading messages" />
      ) : thread.isError && !thread.data ? (
        <View style={{ flex: 1, padding: spacing.space6, gap: spacing.space4, alignItems: "center", justifyContent: "center" }}>
          <Text tone="inkMuted" style={{ textAlign: "center" }}>
            {thread.error.message}
          </Text>
          <Button label="Try again" variant="secondary" onPress={() => thread.refetch()} />
        </View>
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
          renderItem={({ item }) => (
            <MessageBubble
              text={item.text}
              at={item.at}
              fromMe={item.fromMe}
              senderName={item.fromMe ? "You" : name}
              status={item.status}
              onRetry={item.clientId ? () => retry(item.clientId!) : undefined}
              onReport={!item.fromMe && item.serverId && playerId ? () => reportMessage(item.serverId!) : undefined}
              onLongPress={!item.fromMe && item.serverId && playerId ? () => messageMenu(item.serverId!) : undefined}
            />
          )}
          ListEmptyComponent={
            // Inverted lists flip their children; flip the empty state back.
            <View style={{ transform: [{ scaleY: -1 }], padding: spacing.space8, alignItems: "center" }}>
              <Text tone="inkMuted" style={{ textAlign: "center" }}>
                {`Say hi to ${name}.`}
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
        {blocked ? (
          // A blocked chat: read only, with a small Unblock link to undo it (finding 20).
          <View style={{ flexDirection: "row", flexWrap: "wrap", alignItems: "center", justifyContent: "center", columnGap: spacing.space2 }}>
            <Text tone="inkMuted" style={{ textAlign: "center" }}>
              {conversation?.sendBlockedReason ?? `You blocked ${name}.`}
            </Text>
            <Pressable
              onPress={unblock}
              disabled={unblocking}
              accessibilityRole="link"
              accessibilityLabel={`Unblock ${name}`}
              accessibilityHint="Asks first"
              hitSlop={spacing.space1}
              style={({ pressed }) => ({ minHeight: MIN_TAP, minWidth: MIN_TAP, justifyContent: "center", opacity: pressed || unblocking ? 0.6 : 1 })}
            >
              <Text tone="court" style={{ textDecorationLine: "underline" }}>
                Unblock
              </Text>
            </Pressable>
          </View>
        ) : !canSend && conversation?.sendBlockedReason ? (
          <Text tone="inkMuted" style={{ paddingVertical: spacing.space3, textAlign: "center" }}>
            {conversation.sendBlockedReason}
          </Text>
        ) : (
          <View style={{ flexDirection: "row", alignItems: "flex-end", gap: spacing.space2 }}>
            <TextInput
              value={draft}
              onChangeText={(t) => {
                setDraft(t);
                if (notice) setNotice(null);
              }}
              placeholder="Message"
              placeholderTextColor={c.inkMuted}
              accessibilityLabel="Message"
              multiline
              maxLength={2000}
              style={[
                type.body,
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
              disabled={!draft.trim()}
              accessibilityRole="button"
              accessibilityLabel="Send"
              accessibilityState={{ disabled: !draft.trim() }}
              style={({ pressed }) => ({
                minWidth: MIN_TAP,
                minHeight: MIN_TAP,
                paddingHorizontal: spacing.space4,
                borderRadius: radius.radiusPill,
                backgroundColor: c.ink,
                alignItems: "center",
                justifyContent: "center",
                opacity: !draft.trim() ? 0.5 : pressed ? 0.85 : 1,
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
