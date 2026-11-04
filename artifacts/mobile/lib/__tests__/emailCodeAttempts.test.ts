import { describe, expect, it } from "vitest";

import { NO_ATTEMPTS, afterSend, sendCodeSecondsLeft } from "@/lib/emailCodeAttempts";

describe("sendCodeSecondsLeft", () => {
  const sentAt = 1_000_000;
  const sent = afterSend(NO_ATTEMPTS, "alex@example.com");

  it("keeps the 30-second wait after Back for the same address", () => {
    expect(sendCodeSecondsLeft(sent, "alex@example.com", sentAt, sentAt + 6_000)).toBe(24);
    expect(sendCodeSecondsLeft(sent, " Alex@Example.com ", sentAt, sentAt + 6_000)).toBe(24);
  });

  it("lets a different address send right away", () => {
    expect(sendCodeSecondsLeft(sent, "sam@example.com", sentAt, sentAt + 6_000)).toBe(0);
  });

  it("is ready once the wait is over, or before any code was sent", () => {
    expect(sendCodeSecondsLeft(sent, "alex@example.com", sentAt, sentAt + 31_000)).toBe(0);
    expect(sendCodeSecondsLeft(NO_ATTEMPTS, "alex@example.com", null, sentAt)).toBe(0);
  });
});
