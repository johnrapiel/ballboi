import { describe, expect, it } from "vitest";

import { deviceLabel, feedbackError, FEEDBACK_PROBLEMS, noteLabel } from "@/lib/feedback";

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
