import { describe, expect, it } from "vitest";

import { deviceLabel, exactDevice, feedbackError, FEEDBACK_PROBLEMS, noteLabel } from "@/lib/feedback";

describe("Something not working? (B3)", () => {
  it("lists the seven options in order, ending in Something else", () => {
    expect(FEEDBACK_PROBLEMS).toHaveLength(7);
    expect(FEEDBACK_PROBLEMS[6].label).toBe("Something else");
  });

  it("needs a pick, and text for Something else", () => {
    expect(feedbackError(null, "")).toBe("Pick what's not working.");
    expect(feedbackError("something_else", "  ")).toBe("Tell us what's not working.");
    expect(feedbackError("something_else", "The timer froze")).toBeNull();
    expect(feedbackError("upload_stuck", "")).toBeNull();
  });

  it("labels the box by whether it's required", () => {
    expect(noteLabel("something_else")).toBe("What's not working? (required)");
    expect(noteLabel("upload_stuck")).toContain("optional");
  });

  it("describes the phone from its screen", () => {
    expect(deviceLabel("phone", 852, 393, 3)).toBe("iPhone · 393×852 pt @3x");
  });
});

describe("exactDevice", () => {
  it("names the exact iPhone with its model id", () => {
    expect(exactDevice("iPhone 16 Pro", "iPhone17,1", "iPhone · 402×874 pt @3x")).toBe("iPhone 16 Pro (iPhone17,1)");
  });
  it("falls back to the screen size when the model is unknown", () => {
    expect(exactDevice(null, null, "iPhone · 393×852 pt @3x")).toBe("iPhone · 393×852 pt @3x");
    expect(exactDevice("", "  ", "x")).toBe("x");
  });
  it("uses whichever part it has", () => {
    expect(exactDevice(null, "iPhone17,1", "x")).toBe("iPhone17,1");
  });
});
