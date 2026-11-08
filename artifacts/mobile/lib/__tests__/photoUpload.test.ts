import { describe, expect, it } from "vitest";

import { photoContentType } from "@/lib/photos";

describe("photoContentType (finding #23)", () => {
  it("keeps an image type the picker reports", () => {
    expect(photoContentType("image/heic", "file:///x/IMG_0001.HEIC")).toBe("image/heic");
    expect(photoContentType("image/png", "file:///x/a.png")).toBe("image/png");
    expect(photoContentType("IMAGE/JPEG; charset=binary", "file:///x/a")).toBe("image/jpeg");
  });

  it("falls back to the extension when the picker gives no type", () => {
    expect(photoContentType(null, "file:///x/IMG_0001.HEIC")).toBe("image/heic");
    expect(photoContentType(undefined, "file:///x/crop.jpg?v=1")).toBe("image/jpeg");
    expect(photoContentType("", "file:///x/a.webp")).toBe("image/webp");
  });

  it("ignores a type the API won't take and defaults to JPEG", () => {
    expect(photoContentType("application/octet-stream", "file:///x/a.heif")).toBe("image/heif");
    expect(photoContentType("application/octet-stream", "file:///x/noext")).toBe("image/jpeg");
  });
});
