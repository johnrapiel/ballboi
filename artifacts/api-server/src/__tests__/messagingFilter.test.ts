import { describe, it, expect } from "vitest";
import { candidateWords, FirstMessageFilter, normalizeTerm } from "../messaging/filter";

const filter = new FirstMessageFilter(["badword"]);

describe("first-message filter: links", () => {
  it.each([
    "check https://example.com",
    "go to www.example.com",
    "my site is example.com",
    "dm me at example . io",
    "find me on t.me/someone",
    "example dot com",
  ])("blocks %s", (text) => {
    expect(filter.check(text)).toEqual({ ok: false, reason: "link" });
  });
});

describe("first-message filter: phone numbers", () => {
  it.each(["call 555-123-4567", "(555) 123 4567", "text me 555.123.4567", "+1 555 123 4567", "+44 20 7946 0958", "5551234567", "123-4567"])(
    "blocks %s",
    (text) => {
      expect(filter.check(text)).toEqual({ ok: false, reason: "phone" });
    },
  );

  it("lets tennis scores, times and courts through", () => {
    for (const text of ["Won 6-3 6-4 7-6(4)", "Court 12 at 9:30?", "We played 6-3, 2-6, 10-8", "I'm a 3.5, you?"]) {
      expect(filter.check(text)).toEqual({ ok: true });
    }
  });
});

describe("first-message filter: blocked terms", () => {
  it("catches look-alike spellings, spacing and plurals", () => {
    for (const text of ["you badword", "BADWORDS", "b4dw0rd", "baaadword", "b a d w o r d"]) {
      expect(filter.check(text)).toEqual({ ok: false, reason: "blocked_term" });
    }
  });

  it("doesn't match inside longer words", () => {
    expect(filter.check("notabadwordatall")).toEqual({ ok: true });
  });

  it("allows everything when no term list is set", () => {
    expect(new FirstMessageFilter().check("badword")).toEqual({ ok: true });
  });

  it("loads terms from a file and skips comments", async () => {
    const { mkdtempSync, writeFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const { tmpdir } = await import("node:os");
    const dir = mkdtempSync(join(tmpdir(), "bb-terms-"));
    const file = join(dir, "terms.txt");
    writeFileSync(file, "# comment\nbadword\n\n");
    const loaded = FirstMessageFilter.fromEnv({ MESSAGING_BLOCKED_TERMS_FILE: file });
    expect(loaded.termCount).toBe(1);
    expect(FirstMessageFilter.fromEnv({ MESSAGING_BLOCKED_TERMS_FILE: join(dir, "missing.txt") }).termCount).toBe(0);
  });

  it("normalizes consistently", () => {
    expect(normalizeTerm("BÁDD-w0rd")).toBe("badword");
    expect(candidateWords("hi x y z there")).toContain("xyz");
  });
});
