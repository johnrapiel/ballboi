import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  S3ServiceException,
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

  /** Permanently deletes an object. A missing object is not an error (S3 delete is idempotent). */
  async deleteObject(objectPath: string): Promise<void> {
    const { client, bucket } = getConfig();
    const key = objectKeyFromPath(objectPath);
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
  }
}
