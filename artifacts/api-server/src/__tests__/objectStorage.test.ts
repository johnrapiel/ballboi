import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NoSuchKey, S3Client } from "@aws-sdk/client-s3";

const S3_ENV = {
  S3_ENDPOINT: "http://localhost:8333",
  S3_BUCKET: "ballboi",
  S3_ACCESS_KEY_ID: "key",
  S3_SECRET_ACCESS_KEY: "secret",
};

async function loadModule() {
  vi.resetModules();
  return import("../lib/objectStorage");
}

describe("objectKeyFromPath", () => {
  it("strips the /objects/ prefix", async () => {
    const { objectKeyFromPath } = await loadModule();
    expect(objectKeyFromPath("/objects/uploads/abc")).toBe("uploads/abc");
  });

  it.each(["/uploads/abc", "/objects/", "/objects/uploads/../secret", "/objects/uploads//abc", "/objects/./abc"])(
    "rejects %s",
    async (path) => {
      const { objectKeyFromPath, ObjectNotFoundError } = await loadModule();
      expect(() => objectKeyFromPath(path)).toThrow(ObjectNotFoundError);
    },
  );
});

describe("ObjectStorageService", () => {
  beforeEach(() => {
    for (const [key, value] of Object.entries(S3_ENV)) vi.stubEnv(key, value);
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  it("explains which env vars are missing when storage is not configured", async () => {
    vi.stubEnv("S3_BUCKET", "");
    const { ObjectStorageService } = await loadModule();
    await expect(new ObjectStorageService().createUploadURL()).rejects.toThrow(/S3_BUCKET/);
  });

  it("returns a presigned PUT URL and a matching object path", async () => {
    const { ObjectStorageService } = await loadModule();
    const { uploadURL, objectPath } = await new ObjectStorageService().createUploadURL();
    const key = objectPath.replace("/objects/", "");
    expect(objectPath).toMatch(/^\/objects\/uploads\/[0-9a-f-]{36}$/);
    expect(uploadURL.startsWith(`http://localhost:8333/ballboi/${key}?`)).toBe(true);
    expect(uploadURL).toContain("X-Amz-Signature=");
    // A signed checksum of the empty body would make every real upload fail.
    expect(uploadURL).not.toMatch(/x-amz-checksum|x-amz-sdk-checksum/i);
  });

  it("maps a missing object to ObjectNotFoundError", async () => {
    vi.spyOn(S3Client.prototype, "send").mockRejectedValue(
      new NoSuchKey({ message: "missing", $metadata: { httpStatusCode: 404 } }),
    );
    const { ObjectStorageService, ObjectNotFoundError } = await loadModule();
    await expect(new ObjectStorageService().getObject("/objects/uploads/abc")).rejects.toBeInstanceOf(
      ObjectNotFoundError,
    );
  });
});
