import { describe, expect, it } from "vitest";
import { createMessageNotifier, MESSAGE_PUSH_MAX, messagePushContent } from "../services/push/messagePush";

// Message pushes (Session G acceptance 21 and 22; spec decision 128).

const event = { conversationId: 42, senderId: "sam", recipientId: "john", senderName: "Sam Whitfield", text: "Still on for 6?" };

describe("messagePushContent", () => {
  it("shows the sender and the text by default", () => {
    expect(messagePushContent(event, true)).toEqual({ title: "Sam Whitfield", body: "Still on for 6?", link: "/conversation/42" });
  });

  it("hides the text when previews are off", () => {
    expect(messagePushContent(event, false)).toEqual({ title: "", body: "New message from Sam Whitfield", link: "/conversation/42" });
  });

  it("cuts long messages and flattens line breaks", () => {
    const long = `${"a".repeat(200)}\n\nend`;
    const { body } = messagePushContent({ ...event, text: long }, true);
    expect(body.length).toBe(MESSAGE_PUSH_MAX);
    expect(body.endsWith("…")).toBe(true);
    expect(messagePushContent({ ...event, text: "Line one\n\nline two" }, true).body).toBe("Line one line two");
  });
});

describe("createMessageNotifier", () => {
  function setup(opts: { blocked?: string[]; previews?: boolean } = {}) {
    const sent: { userIds: string[]; title: string; body: string; link: string }[] = [];
    const notify = createMessageNotifier({
      blockedFor: async () => new Set(opts.blocked ?? []),
      previewsOn: async () => opts.previews ?? true,
      send: async (userIds, title, body, link) => void sent.push({ userIds, title, body, link }),
    });
    return { notify, sent };
  }

  it("sends to the recipient with the preview", async () => {
    const { notify, sent } = setup();
    expect(await notify(event)).toBe("sent");
    expect(sent).toEqual([{ userIds: ["john"], title: "Sam Whitfield", body: "Still on for 6?", link: "/conversation/42" }]);
  });

  it("honors Show message previews off", async () => {
    const { notify, sent } = setup({ previews: false });
    await notify(event);
    expect(sent[0]?.body).toBe("New message from Sam Whitfield");
    expect(sent[0]?.title).toBe("");
  });

  it("never pushes between blocked players, whichever side blocked", async () => {
    const { notify, sent } = setup({ blocked: ["sam"] });
    expect(await notify(event)).toBe("skipped");
    expect(sent).toEqual([]);
  });

  it("never pushes to yourself", async () => {
    const { notify, sent } = setup();
    expect(await notify({ ...event, recipientId: "sam" })).toBe("skipped");
    expect(sent).toEqual([]);
  });
});
