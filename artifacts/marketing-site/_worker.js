// Ball Boi marketing site worker (Cloudflare Pages advanced mode).
// Drag-and-drop deploys support this one file, not a functions/ folder.
//
// POST /api/early-access  saves an early-access sign-up to D1 (binding: DB).
// Everything else is served from the static files as usual.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const ZIP_RE = /^\d{5}$/;

const SCHEMA = `CREATE TABLE IF NOT EXISTS early_access (
  email TEXT PRIMARY KEY,
  zip TEXT,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
)`;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" },
  });
}

async function readBody(request) {
  const type = request.headers.get("content-type") || "";
  if (type.includes("application/json")) {
    return { data: await request.json(), isForm: false };
  }
  const form = await request.formData();
  return { data: Object.fromEntries(form), isForm: true };
}

async function earlyAccess(request, env) {
  if (request.method !== "POST") return json({ ok: false, error: "method" }, 405);
  if ((request.headers.get("content-length") || 0) > 4096) return json({ ok: false, error: "too_large" }, 413);

  let data, isForm;
  try {
    ({ data, isForm } = await readBody(request));
  } catch {
    return json({ ok: false, error: "bad_request" }, 400);
  }

  // Without JavaScript the form posts normally, so send people back to the page.
  const done = (status) =>
    isForm ? Response.redirect(new URL(`/?early-access=${status}#early-access`, request.url).toString(), 303) : null;

  // Honeypot: real people never see or fill the "website" field. Pretend it worked.
  if (String(data.website || "").trim()) return done("joined") || json({ ok: true });

  const email = String(data.email || "").trim().toLowerCase();
  const zip = String(data.zip || "").trim();
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) return done("invalid") || json({ ok: false, error: "email" }, 400);
  if (zip && !ZIP_RE.test(zip)) return done("invalid") || json({ ok: false, error: "zip" }, 400);

  if (!env.DB) return done("error") || json({ ok: false, error: "not_configured" }, 503);

  try {
    await env.DB.prepare(SCHEMA).run();
    // Signing up twice is fine: keep the first sign-up, add a zip if it was missing.
    await env.DB.prepare(
      "INSERT INTO early_access (email, zip) VALUES (?1, ?2) ON CONFLICT(email) DO UPDATE SET zip = COALESCE(early_access.zip, excluded.zip)"
    )
      .bind(email, zip || null)
      .run();
  } catch {
    return done("error") || json({ ok: false, error: "server" }, 500);
  }
  return done("joined") || json({ ok: true });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/early-access") return earlyAccess(request, env);
    return env.ASSETS.fetch(request);
  },
};
