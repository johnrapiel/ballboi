import { describe, expect, it } from "vitest";

import { hasLinks, linkActionLabel, linkParts, linkTarget } from "../messageLinks";

describe("linkParts", () => {
  it("finds an https join link and keeps the text around it", () => {
    expect(linkParts("Try https://ballboi.tennis/join/QQBU4MBY now")).toEqual([
      { text: "Try " },
      { text: "https://ballboi.tennis/join/QQBU4MBY", url: "https://ballboi.tennis/join/QQBU4MBY" },
      { text: " now" },
    ]);
  });

  it("finds a bare ballboi.tennis link and adds https", () => {
    expect(linkParts("ballboi.tennis/join/ab12cd")).toEqual([
      { text: "ballboi.tennis/join/ab12cd", url: "https://ballboi.tennis/join/ab12cd" },
    ]);
  });

  it("finds http links and more than one link", () => {
    const parts = linkParts("See http://example.com and https://usta.com/a?b=1");
    expect(parts.filter((p) => p.url).map((p) => p.url)).toEqual(["http://example.com", "https://usta.com/a?b=1"]);
  });

  it("leaves sentence punctuation out of the link", () => {
    expect(linkParts("Join here: ballboi.tennis/join/AB12.")).toEqual([
      { text: "Join here: " },
      { text: "ballboi.tennis/join/AB12", url: "https://ballboi.tennis/join/AB12" },
      { text: "." },
    ]);
    expect(linkParts("(https://example.com/x)")[1]).toEqual({ text: "https://example.com/x", url: "https://example.com/x" });
  });

  it("keeps a closing bracket that belongs to the link", () => {
    expect(linkParts("https://en.wikipedia.org/wiki/Tennis_(sport)")[0].url).toBe("https://en.wikipedia.org/wiki/Tennis_(sport)");
  });

  it("leaves plain text alone", () => {
    expect(linkParts("Sounds good!")).toEqual([{ text: "Sounds good!" }]);
    expect(linkParts("")).toEqual([{ text: "" }]);
    expect(hasLinks("I don't see a league though")).toBe(false);
    expect(hasLinks("email me at me@ballboi.tennis")).toBe(false);
    expect(hasLinks("myballboi.tennis")).toBe(false);
  });

  it("never loses text", () => {
    const text = "a https://x.com/b, then ballboi.tennis/join/Z9 and (http://y.org).";
    expect(linkParts(text).map((p) => p.text).join("")).toBe(text);
  });
});

describe("linkTarget", () => {
  it("opens Ball Boi join links in the app", () => {
    expect(linkTarget("https://ballboi.tennis/join/qqbu4mby")).toEqual({ kind: "app", path: "/join/QQBU4MBY" });
    expect(linkTarget("https://www.ballboi.tennis/join/AB12/")).toEqual({ kind: "app", path: "/join/AB12" });
  });

  it("opens other links in Safari", () => {
    expect(linkTarget("https://ballboi.tennis/privacy")).toEqual({ kind: "web", url: "https://ballboi.tennis/privacy" });
    expect(linkTarget("https://example.com/join/AB12")).toEqual({ kind: "web", url: "https://example.com/join/AB12" });
  });
});

describe("linkActionLabel", () => {
  it("reads the address without the scheme", () => {
    expect(linkActionLabel("https://ballboi.tennis/join/AB12")).toBe("Open link ballboi.tennis/join/AB12");
  });
});
