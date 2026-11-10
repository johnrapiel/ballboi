import { describe, expect, it } from "vitest";

import { inviteFromPath } from "@/lib/gate";
import { cleanCode, codeFromInput, inviteMessage, joinUrl } from "@/lib/joinLink";

describe("joinUrl", () => {
  it("is the ballboi.tennis join link with a clean code", () => {
    expect(joinUrl("qqbu4mby")).toBe("https://ballboi.tennis/join/QQBU4MBY");
    expect(joinUrl(" QQ-BU 4MBY ")).toBe("https://ballboi.tennis/join/QQBU4MBY");
  });

  it("is the link Share sends too", () => {
    expect(inviteMessage("Tuesday Flex", "QQBU4MBY")).toBe("Join Tuesday Flex on Ball Boi: https://ballboi.tennis/join/QQBU4MBY");
  });
});

describe("the copied link opens the league", () => {
  it("is read as a league invite, so it's kept through sign-in and onboarding", () => {
    const path = new URL(joinUrl("QQBU4MBY")).pathname;
    expect(inviteFromPath(path)).toEqual({ kind: "league", code: "QQBU4MBY" });
  });
});

describe("codeFromInput", () => {
  it("takes a typed code as it is", () => {
    expect(codeFromInput("beacon35")).toBe("BEACON35");
    expect(codeFromInput(" BEA-CON 35 ")).toBe(cleanCode("BEACON35"));
  });

  it("takes the code out of a pasted link", () => {
    expect(codeFromInput("https://ballboi.tennis/join/QQBU4MBY")).toBe("QQBU4MBY");
    expect(codeFromInput("https://ballboi.tennis/join/qqbu4mby/")).toBe("QQBU4MBY");
    expect(codeFromInput("ballboi.tennis/join/QQBU4MBY?ref=x")).toBe("QQBU4MBY");
    expect(codeFromInput("ballboi://join/QQBU4MBY")).toBe("QQBU4MBY");
  });

  it("takes the code out of a pasted share message", () => {
    expect(codeFromInput("Join Tuesday Flex on Ball Boi: https://ballboi.tennis/join/QQBU4MBY")).toBe("QQBU4MBY");
  });

  it("is empty for nothing", () => {
    expect(codeFromInput("   ")).toBe("");
  });
});
