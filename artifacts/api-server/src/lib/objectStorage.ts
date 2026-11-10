import {
  AbortMultipartUploadCommand,
  CompleteMultipartUploadCommand,
  CreateMultipartUploadCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListPartsCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
  UploadPartCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";
import { Readable } from "stream";

// S3-compatible object storage: SeaweedFS locally (docker-compose), R2 or S3 in production.
// Object paths stored in the database look like "/objects/uploads/<uuid>"; the S3 key is
// the part after "/objects/".

const OBJECT_PATH_PREFIX = "/objects/";

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

/** A part already in storage for a multipart upload. */
export interface UploadedPart {
  partNumber: number;
  etag: string;
  size: number;
}

export interface StoredObject {
  body: Readable;
  contentType: string;
  contentLength?: number;
}

interface StorageConfig {
  client: S3Client;
  bucket: string;
}

let config: StorageConfig | null = null;

// Read lazily so the API boots without storage configured; only video routes need it.
function getConfig(): StorageConfig {
  if (config) return config;

  const bucket = process.env.S3_BUCKET;
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  if (!bucket || !accessKeyId || !secretAccessKey) {
    throw new Error(
      "Object storage is not configured. Set S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY (see .env.example).",
    );
  }

  const endpoint = process.env.S3_ENDPOINT || undefined;
  config = {
    bucket,
    client: new S3Client({
      endpoint,
      region: process.env.S3_REGION || "auto",
      credentials: { accessKeyId, secretAccessKey },
      // Custom endpoints (SeaweedFS, R2) are addressed as <endpoint>/<bucket>/<key>.
      forcePathStyle: Boolean(endpoint),
      // By default the SDK signs a CRC32 of the (empty) body into presigned PUT URLs,
      // so every real upload fails with BadDigest.
      requestChecksumCalculation: "WHEN_REQUIRED",
      responseChecksumValidation: "WHEN_REQUIRED",
    }),
  };
  return config;
}

export function objectKeyFromPath(objectPath: string): string {
  if (!objectPath.startsWith(OBJECT_PATH_PREFIX)) {
    throw new ObjectNotFoundError();
  }
  const key = objectPath.slice(OBJECT_PATH_PREFIX.length);
  if (!key || key.split("/").some((part) => part === "" || part === "." || part === "..")) {
    throw new ObjectNotFoundError();
  }
  return key;
}

function isNotFound(err: unknown): boolean {
  return (
    err instanceof S3ServiceException &&
    (err.name === "NoSuchKey" || err.name === "NotFound" || err.$metadata?.httpStatusCode === 404)
  );
}

export class ObjectStorageService {
  /** Returns a presigned PUT URL for a new object and the object path to store in the database. */
  async createUploadURL(ttlSec = 900): Promise<{ uploadURL: string; objectPath: string }> {
    const { client, bucket } = getConfig();
    const key = `uploads/${randomUUID()}`;
    const uploadURL = await getSignedUrl(client, new PutObjectCommand({ Bucket: bucket, Key: key }), {
      expiresIn: ttlSec,
    });
    return { uploadURL, objectPath: `${OBJECT_PATH_PREFIX}${key}` };
  }

  /** Returns a presigned GET URL, or throws ObjectNotFoundError if the object doesn't exist. */
  async getObjectEntityViewURL(objectPath: string, ttlSec = 3600): Promise<string> {
    const { client, bucket } = getConfig();
    const key = objectKeyFromPath(objectPath);
    try {
      await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    } catch (err) {
      if (isNotFound(err)) throw new ObjectNotFoundError();
      throw err;
    }
    return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: key }), { expiresIn: ttlSec });
  }

  /** An object's stored type and size, or throws ObjectNotFoundError. */
  async headObject(objectPath: string): Promise<{ contentType: string; contentLength: number | null }> {
    const { client, bucket } = getConfig();
    const key = objectKeyFromPath(objectPath);
    try {
      const res = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return { contentType: res.ContentType || "application/octet-stream", contentLength: res.ContentLength ?? null };
    } catch (err) {
      if (isNotFound(err)) throw new ObjectNotFoundError();
      throw err;
    }
  }

  async getObject(objectPath: string): Promise<StoredObject> {
    const { client, bucket } = getConfig();
    const key = objectKeyFromPath(objectPath);
    try {
      const res = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      return {
        body: res.Body as Readable,
        contentType: res.ContentType || "application/octet-stream",
        contentLength: res.ContentLength,
      };
    } catch (err) {
      if (isNotFound(err)) throw new ObjectNotFoundError();
      throw err;
    }
  }

  /** Writes a small object (a recording's sidecar JSON), replacing any earlier copy. */
  async putObject(objectPath: string, body: string, contentType = "application/json"): Promise<void> {
    const { client, bucket } = getConfig();
    const key = objectKeyFromPath(objectPath);
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: contentType }));
  }

  /** Permanently deletes an object. A missing object is not an error (S3 delete is idempotent). */
  async deleteObject(objectPath: string): Promise<void> {
    const { client, bucket } = getConfig();
    const key = objectKeyFromPath(objectPath);
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }

  // ── Multipart uploads (Wave 1 review D4) ────────────────────────────────
  // A single PUT is capped at 5 GB on S3 and R2, and a 2.5-hour match is
  // bigger than that. The phone sends long recordings in parts instead; each
  // part goes up on its own presigned URL, and a part that's already in
  // storage is never sent again, so a dropped connection or a closed app
  // only costs the part that was in flight.

  /** Starts a multipart upload for a new object. */
  async createMultipartUpload(contentType = "video/quicktime"): Promise<{ uploadId: string; objectPath: string }> {
    const { client, bucket } = getConfig();
    const key = `uploads/${randomUUID()}`;
    const res = await client.send(new CreateMultipartUploadCommand({ Bucket: bucket, Key: key, ContentType: contentType }));
    if (!res.UploadId) throw new Error("Storage didn't start the upload.");
    return { uploadId: res.UploadId, objectPath: `${OBJECT_PATH_PREFIX}${key}` };
  }

  /** A presigned PUT URL for one part (numbered from 1). */
  async createUploadPartURL(objectPath: string, uploadId: string, partNumber: number, ttlSec = 3600): Promise<string> {
    const { client, bucket } = getConfig();
    const key = objectKeyFromPath(objectPath);
    return getSignedUrl(
      client,
      new UploadPartCommand({ Bucket: bucket, Key: key, UploadId: uploadId, PartNumber: partNumber }),
      { expiresIn: ttlSec },
    );
  }

  /**
   * Every part storage has for this upload, in order. Throws
   * ObjectNotFoundError when the upload no longer exists (completed or aborted).
   */
  async listUploadedParts(objectPath: string, uploadId: string): Promise<UploadedPart[]> {
    const { client, bucket } = getConfig();
    const key = objectKeyFromPath(objectPath);
    const parts: UploadedPart[] = [];
    let marker: string | undefined;
    try {
      for (;;) {
        const res = await client.send(
          new ListPartsCommand({ Bucket: bucket, Key: key, UploadId: uploadId, PartNumberMarker: marker }),
        );
        for (const p of res.Parts ?? []) {
          if (p.PartNumber != null && p.ETag) parts.push({ partNumber: p.PartNumber, etag: p.ETag, size: p.Size ?? 0 });
        }
        if (!res.IsTruncated || !res.NextPartNumberMarker) break;
        marker = String(res.NextPartNumberMarker);
      }
    } catch (err) {
      if (isNotFound(err) || (err instanceof S3ServiceException && err.name === "NoSuchUpload")) throw new ObjectNotFoundError();
      throw err;
    }
    return parts.sort((a, b) => a.partNumber - b.partNumber);
  }

  /** Joins the parts into the finished object. */
  async completeMultipartUpload(objectPath: string, uploadId: string, parts: UploadedPart[]): Promise<void> {
    const { client, bucket } = getConfig();
    const key = objectKeyFromPath(objectPath);
    await client.send(
      new CompleteMultipartUploadCommand({
        Bucket: bucket,
        Key: key,
        UploadId: uploadId,
        MultipartUpload: { Parts: parts.map((p) => ({ PartNumber: p.partNumber, ETag: p.etag })) },
      }),
    );
  }

  /** Throws away an unfinished upload and its parts. A missing upload is not an error. */
  async abortMultipartUpload(objectPath: string, uploadId: string): Promise<void> {
    const { client, bucket } = getConfig();
    const key = objectKeyFromPath(objectPath);
    try {
      await client.send(new AbortMultipartUploadCommand({ Bucket: bucket, Key: key, UploadId: uploadId }));
    } catch (err) {
      if (isNotFound(err) || (err instanceof S3ServiceException && err.name === "NoSuchUpload")) return;
      throw err;
    }
  }
}
