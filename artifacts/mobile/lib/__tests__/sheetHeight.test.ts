import { describe, expect, it } from "vitest";

import { fillSheetHeight, SHEET_TOP_GAP } from "@/lib/sheetHeight";

describe("fillSheetHeight", () => {
  it("fills the screen below the top safe area and the sheet's top gap", () => {
    // iPhone 16 Pro: 874pt tall, 62pt top inset.
    expect(fillSheetHeight({ windowHeight: 874, topInset: 62 })).toBe(874 - 62 - SHEET_TOP_GAP);
  });

  it("is a definite, positive height, never flex", () => {
    expect(fillSheetHeight({ windowHeight: 667, topInset: 20 })).toBeGreaterThan(0);
  });

  it("takes the keyboard off the bottom so the footer stays above it", () => {
    const open = fillSheetHeight({ windowHeight: 874, topInset: 62 });
    expect(fillSheetHeight({ windowHeight: 874, topInset: 62, keyboardHeight: 336 })).toBe(open - 336);
  });

  it("never goes below zero", () => {
    expect(fillSheetHeight({ windowHeight: 300, topInset: 62, keyboardHeight: 400 })).toBe(0);
    expect(fillSheetHeight({ windowHeight: 874, topInset: -5, keyboardHeight: -10 })).toBe(874 - SHEET_TOP_GAP);
  });
});
