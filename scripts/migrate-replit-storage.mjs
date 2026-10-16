#!/usr/bin/env node
/**
 * One-time copy of match videos and uploads from Replit Object Storage to R2.
 * Must run ON REPLIT: the old storage is only reachable through Replit's sidecar.
 *
 * Object keys keep the same relative path, so the "/objects/..." paths already
 * stored in Postgres keep working after the copy. Safe to re-run: objects that
 * already exist in R2 with the same size are skipped.
 *
 * Usage (in a Replit shell):
 *   mkdir -p /tmp/migrate && cd /tmp/migrate
 *   npm i --no-save @google-cloud/storage @aws-sdk/client-s3 @aws-sdk/lib-storage
 *   OLD_PRIVATE_OBJECT_DIR="$PRIVATE_OBJECT_DIR" \
 *   R2_ACCOUNT_ID=... STORAGE_BUCKET=... STORAGE_ACCESS_KEY_ID=... STORAGE_SECRET_ACCESS_KEY=... \
 *   NODE_PATH=/tmp/migrate/node_modules node /home/runner/workspace/scripts/migrate-replit-storage.mjs [--dry-run]
 */
import { createRequire } from "node:module";

const require = createRequire(process.env.NODE_PATH ? `${process.env.NODE_PATH}/` : import.meta.url);
const { Storage } = require("@google-cloud/storage");
const { S3Client, HeadObjectCommand } = require("@aws-sdk/client-s3");
const { Upload } = require("@aws-sdk/lib-storage");

const DRY_RUN = process.argv.includes("--dry-run");
const SIDECAR = "http://127.0.0.1:1106";

function env(name, fallback) {
  const v = process.env[name] ?? fallback;
  if (!v) throw new Error(`${name} is required`);
  return v;
}

const oldDir = env("OLD_PRIVATE_OBJECT_DIR").replace(/^\/+|\/+$/g, ""); // "<bucket>/<prefix>"
const [oldBucketName, ...oldPrefixParts] = oldDir.split("/");
const oldPrefix = oldPrefixParts.join("/");
const newPrefix = env("PRIVATE_OBJECT_DIR_NEW", "private").replace(/^\/+|\/+$/g, "");
const bucket = env("STORAGE_BUCKET");

const gcs = new Storage({
  credentials: {
    audience: "replit",
    subject_token_type: "access_token",
    token_url: `${SIDECAR}/token`,
    type: "external_account",
    credential_source: { url: `${SIDECAR}/credential`, format: { type: "json", subject_token_field_name: "access_token" } },
    universe_domain: "googleapis.com",
  },
  projectId: "",
});

const s3 = new S3Client({
  region: "auto",
  endpoint: process.env.STORAGE_ENDPOINT ?? `https://${env("R2_ACCOUNT_ID")}.r2.cloudflarestorage.com`,
  forcePathStyle: true,
  credentials: { accessKeyId: env("STORAGE_ACCESS_KEY_ID"), secretAccessKey: env("STORAGE_SECRET_ACCESS_KEY") },
});

async function existingSize(key) {
  try {
    const head = await s3.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    return head.ContentLength ?? -1;
  } catch {
    return null;
  }
}

const [files] = await gcs.bucket(oldBucketName).getFiles({ prefix: oldPrefix ? `${oldPrefix}/` : undefined });
let copied = 0, skipped = 0, bytes = 0;

for (const file of files) {
  const relative = oldPrefix ? file.name.slice(oldPrefix.length + 1) : file.name;
  const key = `${newPrefix}/${relative}`;
  const size = Number(file.metadata.size ?? 0);

  if ((await existingSize(key)) === size) {
    skipped++;
    continue;
  }
  console.log(`${DRY_RUN ? "[dry-run] " : ""}${file.name} -> ${key} (${(size / 1e6).toFixed(1)} MB)`);
  if (DRY_RUN) continue;

  await new Upload({
    client: s3,
    params: {
      Bucket: bucket,
      Key: key,
      Body: file.createReadStream(),
      ContentType: file.metadata.contentType ?? "application/octet-stream",
    },
    queueSize: 4,
    partSize: 16 * 1024 * 1024,
  }).done();
  copied++;
  bytes += size;
}

console.log(`\nDone. Copied ${copied}, skipped ${skipped} already present, ${(bytes / 1e9).toFixed(2)} GB moved.`);
