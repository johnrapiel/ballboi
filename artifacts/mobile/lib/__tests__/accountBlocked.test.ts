import { describe, expect, it, vi } from "vitest";

import { checkForAccountBlock, isAccountBlockedError, onAccountBlocked } from "@/lib/accountBlocked";

describe("isAccountBlockedError", () => {
  it("matches the server's banned and suspended answers", () => {
    expect(isAccountBlockedError(403, { code: "account_banned", error: "This account is banned." })).toBe(true);
    expect(isAccountBlockedError(403, { code: "account_suspended" })).toBe(true);
  });

  it("ignores other refusals", () => {
    expect(isAccountBlockedError(403, { error: "Only this league's admins can do that" })).toBe(false);
    expect(isAccountBlockedError(401, { code: "account_banned" })).toBe(false);
    expect(isAccountBlockedError(403, null)).toBe(false);
    expect(isAccountBlockedError(undefined, "account_banned")).toBe(false);
  });
});

describe("checkForAccountBlock", () => {
  it("tells the listener about a generated-client error with a block code", () => {
    const heard = vi.fn();
    const stop = onAccountBlocked(heard);
    checkForAccountBlock({ status: 403, data: { code: "account_suspended" } });
    checkForAccountBlock({ status: 500, data: { code: "account_banned" } });
    checkForAccountBlock(new Error("network"));
    expect(heard).toHaveBeenCalledTimes(1);
    stop();
    checkForAccountBlock({ status: 403, data: { code: "account_banned" } });
    expect(heard).toHaveBeenCalledTimes(1);
  });
});
