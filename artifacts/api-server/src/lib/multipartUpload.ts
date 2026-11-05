// Recordings go to storage in parts (Wave 1 review D4).
//
// S3 and R2 cap a single PUT at 5 GB, and the app records 2.3 to 3.6 GB an
// hour, so a match over about 80 minutes couldn't upload. Each piece of a
// recording (a "segment": a match interrupted by a call has more than one)
// now goes up as a multipart upload: equal 64 MB parts, each on its own
// presigned URL. Storage remembers which parts it has, so after a dropped
// connection or a closed app the phone sends only the parts that are missing.
// Wi-Fi used stays about one file's size.
//
// R2 needs every part but the last to be the same size, and at least 5 MB.

export const MIB = 1024 * 1024;
/** Size of each part except the last. */
export const PART_SIZE_BYTES = 64 * MIB;
/** Storage allows at most this many parts in one upload. */
export const MAX_PARTS = 10_000;
/** Bigger than any 4-hour recording (about 15 GB at the high end), with room to spare. */
export const MAX_SEGMENT_BYTES = 48 * 1024 * MIB;
/** A match broken up by more interruptions than this is unusual; keeps metadata small. */
export const MAX_SEGMENTS = 40;

/** Part size for a file this big: 64 MB, or larger in whole MB if 10,000 parts wouldn't be enough. */
export function partSizeFor(sizeBytes: number): number {
  const needed = Math.ceil(sizeBytes / MAX_PARTS / MIB) * MIB;
  return Math.max(PART_SIZE_BYTES, needed);
}

/** How many parts a file of this size is sent in. Always at least 1. */
export function partCountFor(sizeBytes: number, partSize: number): number {
  return Math.max(1, Math.ceil(sizeBytes / partSize));
}

/** Part numbers (from 1) storage doesn't have yet, in order. */
export function missingParts(partCount: number, uploaded: number[]): number[] {
  const have = new Set(uploaded);
  const out: number[] = [];
  for (let n = 1; n <= partCount; n++) if (!have.has(n)) out.push(n);
  return out;
}

/** True when a size the phone sent is one we can take. */
export function validSegmentSize(sizeBytes: unknown): sizeBytes is number {
  return typeof sizeBytes === "number" && Number.isInteger(sizeBytes) && sizeBytes > 0 && sizeBytes <= MAX_SEGMENT_BYTES;
}

/** One segment's upload, kept in ball_boi_sessions.metadata.uploads[segment]. */
export interface SegmentUpload {
  uploadId: string;
  objectPath: string;
  sizeBytes: number;
  partSize: number;
  /** Set once storage has joined the parts into one object. */
  completedAt?: string;
}

/** Reads metadata.uploads safely. */
export function segmentUploads(metadata: unknown): Record<string, SegmentUpload> {
  const m = metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>) : {};
  const u = m.uploads;
  if (!u || typeof u !== "object") return {};
  const out: Record<string, SegmentUpload> = {};
  for (const [k, v] of Object.entries(u as Record<string, unknown>)) {
    const r = v as Partial<SegmentUpload> | null;
    if (r && typeof r.uploadId === "string" && typeof r.objectPath === "string" && typeof r.sizeBytes === "number" && typeof r.partSize === "number") {
      out[k] = { uploadId: r.uploadId, objectPath: r.objectPath, sizeBytes: r.sizeBytes, partSize: r.partSize, ...(r.completedAt ? { completedAt: r.completedAt } : {}) };
    }
  }
  return out;
}

/** A segment number the phone sent: 0, 1, 2... */
export function validSegment(segment: unknown): segment is number {
  return typeof segment === "number" && Number.isInteger(segment) && segment >= 0 && segment < MAX_SEGMENTS;
}

/**
 * Whether every part is in storage and the sizes add up, so the upload can be
 * joined into one object. `parts` is what storage listed.
 */
export function partsComplete(upload: Pick<SegmentUpload, "sizeBytes" | "partSize">, parts: { partNumber: number; size: number }[]): boolean {
  const count = partCountFor(upload.sizeBytes, upload.partSize);
  if (missingParts(count, parts.map((p) => p.partNumber)).length > 0) return false;
  const total = parts.filter((p) => p.partNumber <= count).reduce((sum, p) => sum + p.size, 0);
  return total === upload.sizeBytes;
}
