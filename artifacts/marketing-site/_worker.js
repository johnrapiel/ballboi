// Ball Boi marketing site worker (Cloudflare Pages advanced mode).
// Drag-and-drop deploys support this one file, not a functions/ folder.
//
// POST /api/early-access                 saves an early-access sign-up to D1 (binding: DB).
// GET /join/CODE, /record/invite/CODE     invite landing page (invite.html) for people
//                                          without the app; the code is saved with their email.
// GET /.well-known/apple-app-site-association  lets those same links open the app when installed.
// Everything else is served from the static files as usual.

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

const SCHEMA = `CREATE TABLE IF NOT EXISTS early_access (
  email TEXT PRIMARY KEY,
  created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
)`;

// Which invite brought someone here: "join:CODE" (league) or "match:CODE" (recorded match).
const REF_RE = /^(join|match):[A-Za-z0-9]{4,16}$/;
const INVITE_PATH_RE = /^\/(join|record\/invite)\/([A-Za-z0-9]{4,16})\/?$/;

// Universal links: the app (team AVAJZ56CBY, bundle tennis.ballboi) claims these paths.
const AASA = {
  applinks: {
    details: [
      {
        appIDs: ["AVAJZ56CBY.tennis.ballboi"],
        components: [{ "/": "/join/*" }, { "/": "/record/invite/*" }],
      },
    ],
  },
};

async function addRefColumn(db) {
  try {
    await db.prepare("ALTER TABLE early_access ADD COLUMN ref TEXT").run();
  } catch {
    // Already there.
  }
}

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
  const back = String(data.back || "");
  const backPath = INVITE_PATH_RE.test(back) ? back : "/";
  const done = (status) =>
    isForm ? Response.redirect(new URL(`${backPath}?early-access=${status}#early-access`, request.url).toString(), 303) : null;

  // Honeypot: real people never see or fill the "website" field. Pretend it worked.
  if (String(data.website || "").trim()) return done("joined") || json({ ok: true });

  const email = String(data.email || "").trim().toLowerCase();
  if (!email || email.length > 254 || !EMAIL_RE.test(email)) return done("invalid") || json({ ok: false, error: "email" }, 400);

  const refRaw = String(data.ref || "").trim();
  const ref = REF_RE.test(refRaw) ? refRaw : null;

  if (!env.DB) return done("error") || json({ ok: false, error: "not_configured" }, 503);

  try {
    await env.DB.prepare(SCHEMA).run();
    await addRefColumn(env.DB);
    // Signing up twice is fine: the first sign-up stays, and keeps the first invite code.
    await env.DB.prepare(
      "INSERT INTO early_access (email, ref) VALUES (?1, ?2) ON CONFLICT(email) DO UPDATE SET ref = COALESCE(early_access.ref, excluded.ref)",
    )
      .bind(email, ref)
      .run();
  } catch {
    return done("error") || json({ ok: false, error: "server" }, 500);
  }
  return done("joined") || json({ ok: true });
}

// Serve invite.html for /join/CODE and /record/invite/CODE, with the code filled in,
// so the sign-up works without JavaScript too.
async function invitePage(request, env, url, kind, code) {
  const page = await env.ASSETS.fetch(new Request(new URL("/invite", url), request));
  if (!page.ok) return page;
  const title = kind === "join" ? "You're invited to a league" : "Your match is waiting";
  const lede =
    kind === "join"
      ? "Someone invited you to their league on Ball Boi, a tennis app for finding players, running leagues and recording your matches."
      : "Someone recorded a tennis match with you on Ball Boi. Join to see it, along with your shots and stats once they're ready.";
  return new HTMLRewriter()
    .on("#invite-title", { element: (el) => el.setInnerContent(title) })
    .on("#invite-lede", { element: (el) => el.setInnerContent(lede) })
    .on("#ea-ref", { element: (el) => el.setAttribute("value", `${kind}:${code}`) })
    .on("#ea-back", { element: (el) => el.setAttribute("value", url.pathname) })
    .transform(new Response(page.body, { status: 200, headers: page.headers }));
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/api/early-access") return earlyAccess(request, env);
    if (url.pathname === "/.well-known/apple-app-site-association") {
      return new Response(JSON.stringify(AASA), {
        headers: { "content-type": "application/json", "cache-control": "public, max-age=3600" },
      });
    }
    const invite = url.pathname.match(INVITE_PATH_RE);
    if (invite) return invitePage(request, env, url, invite[1] === "join" ? "join" : "match", invite[2]);
    return env.ASSETS.fetch(request);
  },
};
