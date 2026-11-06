import { describe, expect, it } from "vitest";

import {
  SIGN_IN_UNFINISHED,
  SIGN_UP_UNFINISHED,
  unfinishedAuthDetail,
  unfinishedAuthMessage,
} from "@/lib/authErrors";

describe("unfinished sign-up (finding #22)", () => {
  it("says sign-up couldn't finish, never the vague message", () => {
    expect(unfinishedAuthMessage("signUp")).toBe(SIGN_UP_UNFINISHED);
    expect(unfinishedAuthMessage("signUp")).not.toMatch(/Something went wrong/);
    expect(unfinishedAuthMessage("signIn")).toBe(SIGN_IN_UNFINISHED);
  });

  it("names the fields Clerk is missing in the log line", () => {
    expect(
      unfinishedAuthDetail({ status: "missing_requirements", missingFields: ["password"], unverifiedFields: [] }),
    ).toBe("missing_requirements (missing: password; unverified: none)");
    expect(
      unfinishedAuthDetail({ status: "missing_requirements", missingFields: ["first_name", "username"], unverifiedFields: ["phone_number"] }),
    ).toBe("missing_requirements (missing: first_name, username; unverified: phone_number)");
  });

  it("logs just the status for sign-in, which has no field lists", () => {
    expect(unfinishedAuthDetail({ status: "needs_second_factor" })).toBe("needs_second_factor");
    expect(unfinishedAuthDetail({})).toBe("unknown");
  });
});
