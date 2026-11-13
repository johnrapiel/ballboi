import { describe, expect, it } from "vitest";

import { MATCH_CARD_HINT, matchActionLayout, matchCardSpoken } from "@/lib/matchActions";
import { editWindowLine } from "@/lib/playoffView";

// Wave 2 finding 54 (John, Nov 12): one match card, the same actions
// everywhere (Home, the league page, Match detail): Record with Ball Boi,
// then Message and Enter score. No Details button; the card itself opens
// Match detail. Finding 55: the 24-hour edit is a visible line on Enter score.

const keys = (input: Parameters<typeof matchActionLayout>[0]) => matchActionLayout(input).map((s) => `${s.key}:${s.as}:${s.variant}:${s.place}`);

describe("matchActionLayout", () => {
  it("before play: Record leads, then Message and Enter score side by side", () => {
    expect(keys({ record: true, message: true, enterScore: true, pastDue: false })).toEqual([
      "record:button:primary:lead",
      "message:button:secondary:row",
      "enterScore:button:secondary:row",
    ]);
  });

  it("past due: Enter score leads beside Message, Record is a link under them (finding 47)", () => {
    expect(keys({ record: true, message: true, enterScore: true, pastDue: true })).toEqual([
      "enterScore:button:primary:row",
      "message:button:secondary:row",
      "record:link:secondary:under",
    ]);
  });

  it("without Record, Message is the one primary and Enter score sits beside it", () => {
    expect(keys({ record: false, message: true, enterScore: true, pastDue: false })).toEqual([
      "message:button:primary:row",
      "enterScore:button:secondary:row",
    ]);
  });

  it("doubles' dimmed Record keeps the pair secondary, as before", () => {
    expect(keys({ record: false, recordPlaceholder: true, message: true, enterScore: true, pastDue: false })).toEqual([
      "message:button:secondary:row",
      "enterScore:button:secondary:row",
    ]);
  });

  it("Enter score is primary when it's the only button", () => {
    expect(keys({ record: false, message: false, enterScore: true, pastDue: false })).toEqual(["enterScore:button:primary:row"]);
  });

  it("never more than one primary, and there is no Details action", () => {
    for (const record of [true, false])
      for (const message of [true, false])
        for (const enterScore of [true, false])
          for (const pastDue of [true, false]) {
            const slots = matchActionLayout({ record, message, enterScore, pastDue });
            expect(slots.filter((s) => s.as === "button" && s.variant === "primary").length).toBeLessThanOrEqual(1);
            expect(slots.map((s) => s.key as string)).not.toContain("details");
          }
  });
});

describe("matchCardSpoken", () => {
  it("reads the match as one line", () => {
    expect(
      matchCardSpoken({ dateLabel: "Today", time: "6:30 PM", versus: "You vs. Elena Ortiz", location: "Memorial Park · Beacon", league: "Test League 1" }),
    ).toBe("Today, 6:30 PM, You vs. Elena Ortiz, Memorial Park, Beacon, Test League 1");
    expect(MATCH_CARD_HINT).toBe("Opens match details");
  });

  it("skips what's missing and says 'and' for doubles teams", () => {
    expect(matchCardSpoken({ dateLabel: "Saturday, Nov 14", time: null, versus: "You and Sam vs. Jo & Lee", league: "Test League 1" })).toBe(
      "Saturday, Nov 14, You and Sam vs. Jo and Lee, Test League 1",
    );
  });
});

describe("editWindowLine", () => {
  it("singles and doubles", () => {
    expect(editWindowLine({ doubles: false })).toBe("Either of you can edit it for 24 hours.");
    expect(editWindowLine({ doubles: true })).toBe("Any of the four can edit it for 24 hours.");
  });

  it("a playoff match before the final also locks once the next round is played", () => {
    expect(editWindowLine({ doubles: false, playoffRound: "semifinal" })).toBe("Either of you can edit it for 24 hours, until the next round is played.");
    expect(editWindowLine({ doubles: false, playoffRound: "final" })).toBe("Either of you can edit it for 24 hours.");
  });
});
