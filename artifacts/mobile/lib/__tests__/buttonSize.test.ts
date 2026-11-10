import { describe, expect, it } from "vitest";

import { BUTTON_HEIGHT, buttonHeight, buttonWidth, shouldStackButtons } from "../buttonSize";

// League detail's match card on a 393pt iPhone: 16pt page gutters and 16pt card padding.
const CARD_ROW = 393 - 32 - 32;

describe("buttonHeight", () => {
  it("is 48pt at the default text size", () => {
    expect(BUTTON_HEIGHT).toBe(48);
    expect(buttonHeight(1)).toBe(48);
  });

  it("stays 48pt at smaller text sizes", () => {
    expect(buttonHeight(0.82)).toBe(48);
  });

  it("grows only by the scaled line height", () => {
    // 22pt line at 1.35x is 29.7, rounded up to 30, plus 26pt padding.
    expect(buttonHeight(1.35)).toBe(56);
    // The largest accessibility size.
    expect(buttonHeight(3.1)).toBe(Math.ceil(22 * 3.1) + 26);
  });

  it("never drops below the 44pt target, even with a bad scale", () => {
    expect(buttonHeight(0)).toBe(48);
    expect(buttonHeight(Number.NaN)).toBe(48);
  });
});

describe("buttonWidth", () => {
  it("includes the 24pt padding on each side", () => {
    expect(buttonWidth("", 1)).toBe(48);
  });

  it("grows with the label and the text size", () => {
    expect(buttonWidth("Message Marcus", 1)).toBeGreaterThan(buttonWidth("Message", 1));
    expect(buttonWidth("Message", 2)).toBeGreaterThan(buttonWidth("Message", 1));
  });
});

describe("shouldStackButtons", () => {
  it("keeps Enter score and Message side by side at the default size", () => {
    expect(shouldStackButtons(["Enter score", "Message"], CARD_ROW, 1)).toBe(false);
  });

  it("would have stacked the old Message Marcus label rather than wrap it", () => {
    expect(shouldStackButtons(["Enter score", "Message Marcus"], CARD_ROW, 1)).toBe(true);
  });

  it("stacks the same row at the largest accessibility sizes", () => {
    expect(shouldStackButtons(["Enter score", "Message"], CARD_ROW, 2.35)).toBe(true);
  });

  it("never stacks a single button", () => {
    expect(shouldStackButtons(["Record with Ball Boi"], 100, 3)).toBe(false);
  });

  it("stays side by side until the row has been measured", () => {
    expect(shouldStackButtons(["Enter score", "Message"], 0, 3)).toBe(false);
  });

  it("stacks when one long label wouldn't fit its half", () => {
    expect(shouldStackButtons(["Team up with someone", "Find me a partner"], CARD_ROW, 1)).toBe(true);
  });
});
