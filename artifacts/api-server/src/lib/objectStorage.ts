import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
  type HeadObjectCommandOutput,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { randomUUID } from "crypto";

/**
 * S3-compatible object storage. Production uses Cloudflare R2; local dev uses
 * MinIO from docker-compose. Any S3-compatible endpoint works.
 *
 * Env:
 *   STORAGE_BUCKET            bucket name (required)
 *   STORAGE_ACCESS_KEY_ID     access key (required)
 *   STORAGE_SECRET_ACCESS_KEY secret key (required)
 *   R2_ACCOUNT_ID             builds the R2 endpoint when STORAGE_ENDPOINT is unset
 *   STORAGE_ENDPOINT          explicit endpoint, e.g. http://localhost:9000 for MinIO
 *   STORAGE_PUBLIC_ENDPOINT   endpoint used in presigned URLs handed to clients,
 *                             when it differs from STORAGE_ENDPOINT (e.g. Docker)
 *   PRIVATE_OBJECT_DIR        key prefix for private objects (default "private")
 *   PUBLIC_OBJECT_SEARCH_PATHS comma-separated key prefixes for public assets (default "public")
 *
 * Object paths stored in the database keep the existing "/objects/<id>" shape,
 * so nothing in the database changes when storage moves.
 */

export interface StoredObject {
  bucket: string;
  key: string;
  head: HeadObjectCommandOutput;
}

export class ObjectNotFoundError extends Error {
  constructor() {
    super("Object not found");
    this.name = "ObjectNotFoundError";
    Object.setPrototypeOf(this, ObjectNotFoundError.prototype);
  }
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set. See .env.example for storage settings.`);
  return value;
}

function trimSlashes(s: string): string {
  return s.replace(/^\/+|\/+$/g, "");
}

function resolveEndpoint(): string {
  if (process.env.STORAGE_ENDPOINT) return process.env.STORAGE_ENDPOINT;
  const account = required("R2_ACCOUNT_ID");
  return `https://${account}.r2.cloudflarestorage.com`;
}

let internalClient: S3Client | null = null;
let signingClient: S3Client | null = null;

function makeClient(endpoint: string): S3Client {
  return new S3Client({
    region: process.env.STORAGE_REGION ?? "auto",
    endpoint,
    // Path-style keeps URLs as <endpoint>/<bucket>/<key>, which works for both
    // R2 and MinIO and lets normalizeObjectEntityPath parse them reliably.
    forcePathStyle: true,
    credentials: {
      accessKeyId: required("STORAGE_ACCESS_KEY_ID"),
      secretAccessKey: required("STORAGE_SECRET_ACCESS_KEY"),
    },
  });
}

/** Client the API server uses to read and stat objects. */
export function storageClient(): S3Client {
  internalClient ??= makeClient(resolveEndpoint());
  return internalClient;
}

/** Client used only to sign URLs that browsers and the iOS app will call. */
function urlSigningClient(): S3Client {
  const publicEndpoint = process.env.STORAGE_PUBLIC_ENDPOINT;
  if (!publicEndpoint) return storageClient();
  signingClient ??= makeClient(publicEndpoint);
  return signingClient;
}

function isNotFound(err: unknown): boolean {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === "NotFound" || e?.name === "NoSuchKey" || e?.$metadata?.httpStatusCode === 404;
}

export class ObjectStorageService {
  bucket(): string {
    return required("STORAGE_BUCKET");
  }

  getPrivateObjectDir(): string {
    return trimSlashes(process.env.PRIVATE_OBJECT_DIR || "private");
  }

  getPublicObjectSearchPaths(): string[] {
    const raw = process.env.PUBLIC_OBJECT_SEARCH_PATHS || "public";
    return Array.from(new Set(raw.split(",").map((p) => trimSlashes(p.trim())).filter(Boolean)));
  }

  private async head(key: string): Promise<StoredObject | null> {
    const bucket = this.bucket();
    try {
      const head = await storageClient().send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
      return { bucket, key, head };
    } catch (err) {
      if (isNotFound(err)) return null;
      throw err;
    }
  }

  async searchPublicObject(filePath: string): Promise<StoredObject | null> {
    for (const prefix of this.getPublicObjectSearchPaths()) {
      const found = await this.head(`${prefix}/${trimSlashes(filePath)}`);
      if (found) return found;
    }
    return null;
  }

  async downloadObject(obj: StoredObject, cacheTtlSec = 3600, isPublic = false): Promise<Response> {
    const res = await storageClient().send(new GetObjectCommand({ Bucket: obj.bucket, Key: obj.key }));
    if (!res.Body) throw new ObjectNotFoundError();
    const headers: Record<string, string> = {
      "Content-Type": res.ContentType || "application/octet-stream",
      "Cache-Control": `${isPublic ? "public" : "private"}, max-age=${cacheTtlSec}`,
    };
    if (res.ContentLength != null) headers["Content-Length"] = String(res.ContentLength);
    return new Response(res.Body.transformToWebStream(), { headers });
  }

  /** Presigned PUT for a new private object. Valid for 15 minutes. */
  async getObjectEntityUploadURL(): Promise<string> {
    const key = `${this.getPrivateObjectDir()}/uploads/${randomUUID()}`;
    return getSignedUrl(urlSigningClient(), new PutObjectCommand({ Bucket: this.bucket(), Key: key }), {
      expiresIn: 900,
    });
  }

  /** "/objects/uploads/<id>" -> storage key. */
  private keyForEntityPath(objectPath: string): string {
    if (!objectPath.startsWith("/objects/")) throw new ObjectNotFoundError();
    const entityId = objectPath.slice("/objects/".length);
    if (!entityId) throw new ObjectNotFoundError();
    return `${this.getPrivateObjectDir()}/${entityId}`;
  }

  async getObjectEntityFile(objectPath: string): Promise<StoredObject> {
    const found = await this.head(this.keyForEntityPath(objectPath));
    if (!found) throw new ObjectNotFoundError();
    return found;
  }

  /**
   * Converts a presigned upload URL into the stable "/objects/<id>" path the
   * database stores. Anything that isn't one of our storage URLs passes through.
   */
  normalizeObjectEntityPath(rawPath: string): string {
    let url: URL;
    try {
      url = new URL(rawPath);
    } catch {
      return rawPath;
    }
    const bucketPrefix = `/${this.bucket()}/`;
    if (!url.pathname.startsWith(bucketPrefix)) return rawPath;
    const key = decodeURIComponent(url.pathname.slice(bucketPrefix.length));
    const privatePrefix = `${this.getPrivateObjectDir()}/`;
    if (!key.startsWith(privatePrefix)) return rawPath;
    return `/objects/${key.slice(privatePrefix.length)}`;
  }

  /** Permanently deletes a private object. Missing objects are not an error. */
  async deleteObjectEntity(objectPath: string): Promise<void> {
    await storageClient().send(new DeleteObjectCommand({ Bucket: this.bucket(), Key: this.keyForEntityPath(objectPath) }));
  }

  /** Presigned GET for streaming a private object, e.g. a match replay. */
  async getObjectEntityViewURL(objectPath: string, ttlSec = 3600): Promise<string> {
    const obj = await this.getObjectEntityFile(objectPath);
    return getSignedUrl(urlSigningClient(), new GetObjectCommand({ Bucket: obj.bucket, Key: obj.key }), {
      expiresIn: ttlSec,
    });
  }
}

/**
 * Local dev only: create the bucket in MinIO on first boot so `pnpm dev` works
 * with zero setup. Never runs against R2 or in production.
 */
export async function ensureLocalBucket(log: { info: (o: object, m: string) => void }): Promise<void> {
  if (process.env.NODE_ENV === "production" || !process.env.STORAGE_ENDPOINT) return;
  const Bucket = process.env.STORAGE_BUCKET;
  if (!Bucket) return;
  try {
    await storageClient().send(new HeadBucketCommand({ Bucket }));
  } catch (err) {
    if (!isNotFound(err)) throw err;
    await storageClient().send(new CreateBucketCommand({ Bucket }));
    log.info({ bucket: Bucket }, "Created local storage bucket");
  }
}
