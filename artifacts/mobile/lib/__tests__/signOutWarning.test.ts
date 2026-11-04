import { describe, expect, it } from "vitest";

import { signOutWarning } from "@/lib/signOutWarning";

describe("signOutWarning", () => {
  it("doesn't warn when nothing is waiting to upload", () => {
    expect(signOutWarning(0)).toBeNull();
    expect(signOutWarning(-1)).toBeNull();
    expect(signOutWarning(Number.NaN)).toBeNull();
  });

  it("names one recording in the singular", () => {
    expect(signOutWarning(1)).toEqual({
      title: "Recordings haven't uploaded",
      message: "1 recording hasn't uploaded. Signing out deletes it.",
      confirmLabel: "Sign out anyway",
    });
  });

  it("counts several recordings", () => {
    expect(signOutWarning(2)?.message).toBe("2 recordings haven't uploaded. Signing out deletes them.");
  });
});
