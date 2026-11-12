import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AccessibilityInfo,
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useActionSheet } from "@/components/ActionSheet";
import { Avatar } from "@/components/Avatar";
import { HeaderIconButton, PlainIconButton } from "@/components/Choice";
import { MessageBubble, type BubbleStatus } from "@/components/messages/MessageBubble";
import { Button, Text } from "@/components/ui";
import { MIN_TAP, radius, spacing, type } from "@/constants/tokens";
import { useColors } from "@/hooks/useColors";
import { MessagesApiError, useMessagesActions, useFillScreen, useOlderMessages, useThread, type Message } from "@/hooks/useMessages";
import { useReportBlock } from "@/hooks/useReportBlock";
import { MatchCard, useMatchCardActions, type MatchCardItem } from "@/components/chat/MatchCard";
import { useMatchPlans } from "@/hooks/useDiscoverMatchPlans";
import { newClientMessageId } from "@/lib/messages";

// A conversation (spec: Messaging and moderation). Opens from Messages, from
// New message, and from a player card with id "new" plus playerId, or plus
// userId for a Discover player who may be in no league yet.
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

type Row = {
  key: string;
  text: string;
  at: string;
  fromMe: boolean;
  status: BubbleStatus;
  serverId?: string;
  clientId?: string;
  /** A match card step (Discover, F2), shown in time order with the messages. */
  card?: MatchCardItem;
};

export default function ConversationScreen() {
  const c = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const params = useLocalSearchParams<{ id: string; playerId?: string; userId?: string; name?: string }>();
  const startPlayerId = params.playerId ? Number(params.playerId) : null;
  const startUserId = params.userId ? Number(params.userId) : null;
  const startsNew = startPlayerId !== null || startUserId !== null;

  const [conversationId, setConversationId] = useState<number | null>(() => {
    const n = Number(params.id);
    return params.id !== "new" && Number.isInteger(n) && n > 0 ? n : null;
  });
  const [lookingUp, setLookingUp] = useState(params.id === "new" && startsNew);
  const thread = useThread(conversationId);
  const history = useOlderMessages(conversationId, thread.data);
  // Short chats: keep loading earlier pages until they fill the screen.
  const fill = useFillScreen(history);
  const actions = useMessagesActions();

  const conversation = thread.data?.conversation;
  const name = conversation?.other.name ?? params.name ?? "Player";
  const playerId = conversation?.other.playerId ?? startPlayerId;
  const userId = conversation?.other.userId ?? startUserId;
  /** Who Report and Unblock are about: their league player, else their account. */
  const reportable = playerId || userId ? { id: playerId ?? null, userId: userId ?? null, name } : null;
  // Match cards with this player (Discover, F2).
  const plans = useMatchPlans(userId ?? null);
  const cardActions = useMatchCardActions(name);
  // Back from a sheet or the score: refresh the cards, and find the chat a first card opened.
  useFocusEffect(
    useCallback(() => {
      void plans.refetch();
      if (conversationId === null && startUserId !== null) {
        actions
          .conversationWithUser(startUserId)
          .then((r) => r.conversationId && setConversationId(r.conversationId))
          .catch(() => undefined);
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [conversationId, startUserId]),
  );

  const [draft, setDraft] = useState("");
  const [notice, setNotice] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);

  const reportBlock = useReportBlock();
  const [unblocking, setUnblocking] = useState(false);

  // Opened from a player: reuse an existing conversation with them.
  useEffect(() => {
    if (params.id !== "new" || !startsNew) return;
    (startPlayerId !== null ? actions.conversationWithPlayer(startPlayerId) : actions.conversationWithUser(startUserId!))
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
    const cards: Row[] = (plans.data?.plans ?? []).flatMap((plan) =>
      plan.events.map((event) => ({ key: `card-${event.key}`, text: "", at: event.at, fromMe: event.by === "me", status: "sent" as const, card: { plan, event } })),
    );
    // Messages and match card steps in time order; inverted list: newest first.
    return [...sent, ...waiting, ...cards].sort((a, b) => a.at.localeCompare(b.at)).reverse();
  }, [serverMessages, pending, plans.data]);

  const showNotice = (text: string) => {
    setNotice(text);
    AccessibilityInfo.announceForAccessibility(text);
  };

  async function deliver(clientId: string, text: string) {
    setPending((list) => list.map((p) => (p.clientId === clientId ? { ...p, status: "sending" } : p)));
    try {
      if (conversationId) {
        await actions.send(conversationId, text, clientId);
      } else if (startsNew) {
        const res =
          startPlayerId !== null
            ? await actions.start(startPlayerId, text, clientId)
            : await actions.startWithUser(startUserId!, text, clientId);
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
    if (!conversationId || !reportable) return;
    reportBlock.open(reportable, { conversationId, messageId });
  };

  // Long press: Report is the only action (finding 20).
  // Menus open in a bottom sheet (decision 186).
  const sheet = useActionSheet();
  const who = { name, photo: conversation?.other.avatarUrl };
  const messageMenu = (messageId: string) =>
    sheet.show({ people: [who], rows: [{ label: "Report message", icon: "exclamationmark.circle", onPress: () => reportMessage(messageId) }] });
  const playerMenu = () => {
    if (!reportable) return;
    sheet.show({ people: [who], rows: [{ label: `Report ${name}`, icon: "exclamationmark.circle", onPress: () => reportBlock.open(reportable) }] });
  };

  const blocked = !!conversation?.blocked;
  const unblock = () => {
    if (!reportable || unblocking) return;
    setUnblocking(true);
    void reportBlock.unblock(reportable).finally(() => setUnblocking(false));
  };

  const canSend = conversation ? conversation.canSend : startsNew;
  const loading = lookingUp || (conversationId !== null && thread.isPending);

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: c.paper }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={insets.top + 44}
    >
      {sheet.element}
      <Stack.Screen
        options={{
          headerShown: true,
          title: name,
          // Their photo beside their name, as in Messages (John, Nov 11). Tapping it opens their player card.
          headerTitle: () => (
            <Pressable
              onPress={userId ? () => router.push({ pathname: "/discover/player/[userId]", params: { userId: String(userId) } }) : undefined}
              disabled={!userId}
              accessibilityRole={userId ? "button" : "header"}
              accessibilityLabel={name}
              accessibilityHint={userId ? "Opens their player card" : undefined}
              style={({ pressed }) => ({ flexDirection: "row", alignItems: "center", gap: spacing.space2, minHeight: MIN_TAP, maxWidth: 240, opacity: pressed ? 0.6 : 1 })}
            >
              <Avatar name={name} uri={conversation?.other.avatarUrl} size={28} />
              <Text variant="bodyStrong" numberOfLines={1} maxFontSizeMultiplier={1.4} style={{ flexShrink: 1 }}>
                {name}
              </Text>
            </Pressable>
          ),
          headerBackButtonDisplayMode: "minimal",
          headerShadowVisible: false,
          headerTintColor: c.ink,
          headerStyle: { backgroundColor: c.paper },
          headerTitleStyle: { fontFamily: "DMSans_600SemiBold", color: c.ink },
          headerRight: reportable ? () => <HeaderIconButton symbol="ellipsis" label={`More options for ${name}`} onPress={playerMenu} /> : undefined,
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
          onLayout={fill.onLayout}
          onContentSizeChange={fill.onContentSizeChange}
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
          renderItem={({ item }) =>
            item.card ? (
              <MatchCard item={item.card} otherName={name} devTools={plans.data?.devTools || __DEV__} onAction={cardActions.run} busy={cardActions.busy} />
            ) : (
            <MessageBubble
              text={item.text}
              at={item.at}
              fromMe={item.fromMe}
              senderName={item.fromMe ? "You" : name}
              status={item.status}
              onRetry={item.clientId ? () => retry(item.clientId!) : undefined}
              onReport={!item.fromMe && item.serverId && reportable ? () => reportMessage(item.serverId!) : undefined}
              onLongPress={!item.fromMe && item.serverId && reportable ? () => messageMenu(item.serverId!) : undefined}
            />
            )
          }
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
            {userId && !plans.data?.blocked ? (
              <PlainIconButton
                symbol="calendar.badge.plus"
                label="Add a match"
                hint={`Sends ${name} a match card with a day, time and court`}
                onPress={() => router.push({ pathname: "/discover/plan/[userId]", params: { userId: String(userId), name } })}
              />
            ) : null}
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
            <PlainIconButton
              symbol="arrow.up.circle"
              label="Send"
              onPress={send}
              disabled={!draft.trim()}
              size={26}
            />
          </View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}
