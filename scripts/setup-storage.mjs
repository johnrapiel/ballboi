// Creates the S3 bucket for local development if it doesn't exist. Safe to run repeatedly.
// Usage: pnpm storage:setup (runs automatically as part of pnpm db:up)
import { createRequire } from "node:module";

const require = createRequire(new URL("../artifacts/api-server/package.json", import.meta.url));
const { S3Client, HeadBucketCommand, CreateBucketCommand } = require("@aws-sdk/client-s3");

const { S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY } = process.env;

if (!S3_BUCKET || !S3_ACCESS_KEY_ID || !S3_SECRET_ACCESS_KEY) {
  console.log("S3 storage not configured in .env; skipping bucket setup.");
  process.exit(0);
}

const client = new S3Client({
  endpoint: S3_ENDPOINT || undefined,
  region: S3_REGION || "auto",
  credentials: { accessKeyId: S3_ACCESS_KEY_ID, secretAccessKey: S3_SECRET_ACCESS_KEY },
  forcePathStyle: Boolean(S3_ENDPOINT),
});

try {
  await client.send(new HeadBucketCommand({ Bucket: S3_BUCKET }));
  console.log(`Bucket "${S3_BUCKET}" already exists.`);
} catch (err) {
  if (err?.$metadata?.httpStatusCode !== 404) throw err;
  await client.send(new CreateBucketCommand({ Bucket: S3_BUCKET }));
  console.log(`Created bucket "${S3_BUCKET}".`);
}
