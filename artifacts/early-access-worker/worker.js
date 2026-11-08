// Ball Boi early-access digest (Cloudflare Worker, single file, no packages).
//
// Every morning: emails John the new sign-ups from ballboi.tennis, each with an
// Approve link, plus "Approve all". Approving adds the person to the TestFlight
// external group through the App Store Connect API, and Apple emails the invite.
// Until the Apple key and group are set, approvals wait and go out on a later run.
//
// Bindings and settings (Cloudflare dashboard > this worker > Settings):
//   DB               D1 database ballboi-early-access (shared with the site)
//   EMAIL            Send email binding, destination = DIGEST_TO
//   DIGEST_TO        John's email (variable)
//   DIGEST_FROM      sender on ballboi.tennis, default beta@ballboi.tennis (variable)
//   PUBLIC_URL       this worker's address, e.g. https://ballboi-beta.<you>.workers.dev (variable)
//   APPROVE_SECRET   long random string that signs Approve links (secret)
//   ASC_KEY_ID, ASC_ISSUER_ID, ASC_PRIVATE_KEY (.p8 text), ASC_BETA_GROUP_ID (secrets, add later)
// Cron trigger: "7 13 * * *" (13:07 UTC = 8:07 am Eastern in winter, 9:07 in summer).

const ASC = "https://api.appstoreconnect.apple.com";
const enc = new TextEncoder();

// ---------- database ----------

const NEW_COLUMNS = ["notified_at", "approved_at", "invited_at", "invite_error"];

async function ensureSchema(db) {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS early_access (
        email TEXT PRIMARY KEY,
        created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
      )`
    )
    .run();
  const { results } = await db.prepare("PRAGMA table_info(early_access)").all();
  const have = new Set(results.map((c) => c.name));
  for (const col of NEW_COLUMNS) {
    if (!have.has(col)) await db.prepare(`ALTER TABLE early_access ADD COLUMN ${col} TEXT`).run();
  }
}

const now = () => new Date().toISOString().replace(/\.\d+Z$/, "Z");

// ---------- signed links ----------

const b64url = (bytes) =>
  btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const b64urlText = (s) => b64url(enc.encode(s));
const fromB64urlText = (s) => {
  const bin = atob(s.replace(/-/g, "+").replace(/_/g, "/"));
  return new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0)));
};

async function sign(secret, message) {
  const key = await crypto.subtle.importKey("raw", enc.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(message)));
}

async function verify(secret, message, sig) {
  const expected = await sign(secret, message);
  if (expected.length !== sig.length) return false;
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ sig.charCodeAt(i);
  return diff === 0;
}

// A link carries the emails it approves (one, or a whole digest) and a signature over them.
async function approveLink(env, emails) {
  const list = emails.join("\n");
  return `${env.PUBLIC_URL.replace(/\/$/, "")}/approve?e=${b64urlText(list)}&s=${await sign(env.APPROVE_SECRET, "approve:" + list)}`;
}

async function readLink(env, e, s) {
  if (!e || !s) return null;
  let list;
  try {
    list = fromB64urlText(e);
  } catch {
    return null;
  }
  if (!(await verify(env.APPROVE_SECRET, "approve:" + list, s))) return null;
  return list.split("\n").filter(Boolean);
}

// ---------- App Store Connect ----------

const ascReady = (env) => Boolean(env.ASC_KEY_ID && env.ASC_ISSUER_ID && env.ASC_PRIVATE_KEY && env.ASC_BETA_GROUP_ID);

async function ascToken(env) {
  const pem = env.ASC_PRIVATE_KEY.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "");
  const der = Uint8Array.from(atob(pem), (c) => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("pkcs8", der, { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const iat = Math.floor(Date.now() / 1000);
  const head = b64urlText(JSON.stringify({ alg: "ES256", kid: env.ASC_KEY_ID, typ: "JWT" }));
  const body = b64urlText(JSON.stringify({ iss: env.ASC_ISSUER_ID, iat, exp: iat + 15 * 60, aud: "appstoreconnect-v1" }));
  // WebCrypto returns the raw r||s signature, which is what JWT ES256 expects.
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, key, enc.encode(`${head}.${body}`));
  return `${head}.${body}.${b64url(sig)}`;
}

async function ascErrorText(res) {
  const body = await res.json().catch(() => null);
  const first = body?.errors?.[0];
  return `Apple ${res.status}${first ? `: ${first.detail || first.title || first.code}` : ""}`.slice(0, 300);
}

// Adds one email to the external TestFlight group. Apple sends the invite.
async function inviteToTestFlight(env, token, email) {
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const group = env.ASC_BETA_GROUP_ID;
  const created = await fetch(`${ASC}/v1/betaTesters`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      data: {
        type: "betaTesters",
        attributes: { email },
        relationships: { betaGroups: { data: [{ type: "betaGroups", id: group }] } },
      },
    }),
  });
  if (created.ok) return { ok: true };
  if (created.status !== 409) return { ok: false, error: await ascErrorText(created) };

  // Already a tester in this app (another group, or an earlier try): add them to the group.
  const found = await fetch(`${ASC}/v1/betaTesters?filter[email]=${encodeURIComponent(email)}&limit=1`, { headers });
  if (!found.ok) return { ok: false, error: await ascErrorText(found) };
  const id = (await found.json())?.data?.[0]?.id;
  if (!id) return { ok: false, error: "Apple says this tester exists but returned no ID" };
  const added = await fetch(`${ASC}/v1/betaGroups/${group}/relationships/betaTesters`, {
    method: "POST",
    headers,
    body: JSON.stringify({ data: [{ type: "betaTesters", id }] }),
  });
  return added.ok ? { ok: true } : { ok: false, error: await ascErrorText(added) };
}

// Sends every approved-but-not-invited sign-up to TestFlight (or those listed).
async function sendApproved(env, only) {
  const { results } = await env.DB.prepare(
    "SELECT email FROM early_access WHERE approved_at IS NOT NULL AND invited_at IS NULL ORDER BY approved_at"
  ).all();
  const pending = results.map((r) => r.email).filter((e) => !only || only.includes(e));
  const outcome = {};
  if (!pending.length || !ascReady(env)) return outcome;
  let token;
  try {
    token = await ascToken(env);
  } catch {
    for (const email of pending) {
      outcome[email] = { ok: false, error: "The Apple key couldn't be read. Check ASC_PRIVATE_KEY." };
      await env.DB.prepare("UPDATE early_access SET invite_error = ?2 WHERE email = ?1").bind(email, outcome[email].error).run();
    }
    return outcome;
  }
  for (const email of pending) {
    let result;
    try {
      result = await inviteToTestFlight(env, token, email);
    } catch (err) {
      result = { ok: false, error: `Couldn't reach Apple: ${String(err).slice(0, 200)}` };
    }
    outcome[email] = result;
    if (result.ok) {
      await env.DB.prepare("UPDATE early_access SET invited_at = ?2, invite_error = NULL WHERE email = ?1").bind(email, now()).run();
    } else {
      await env.DB.prepare("UPDATE early_access SET invite_error = ?2 WHERE email = ?1").bind(email, result.error).run();
    }
  }
  return outcome;
}

// ---------- daily digest ----------

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const day = (iso) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "America/New_York" });

async function buildDigest(env, fresh, waiting) {
  const n = fresh.length;
  const subject = `${n} new Ball Boi beta sign-up${n === 1 ? "" : "s"}`;
  const rows = [];
  for (const r of fresh) rows.push({ ...r, link: await approveLink(env, [r.email]) });
  const all = n > 1 ? await approveLink(env, fresh.map((r) => r.email)) : null;

  const waitingLine = waiting
    ? `${waiting} approved ${waiting === 1 ? "person is" : "people are"} waiting for TestFlight. Invites go out once the Apple key and beta group are set up.`
    : "";

  const text = [
    `${subject}:`,
    "",
    ...rows.map((r) => `${r.email} (signed up ${day(r.created_at)})\nApprove: ${r.link}`),
    "",
    all ? `Approve all ${n}: ${all}` : "",
    waitingLine,
    "",
    "Approving sends them a TestFlight invite from Apple.",
  ]
    .filter((l, i, a) => l !== "" || a[i - 1] !== "")
    .join("\n");

  const button = (href, label) =>
    `<a href="${esc(href)}" style="display:inline-block;padding:10px 18px;border-radius:999px;background:#E9B949;color:#0A2447;font-weight:700;text-decoration:none">${esc(label)}</a>`;
  const html = `<!doctype html>
<html><body style="margin:0;padding:24px;font:16px/1.5 -apple-system,Helvetica,Arial,sans-serif;color:#0A2447;background:#fff">
<h1 style="margin:0 0 16px;font-size:22px">${esc(subject)}</h1>
<table role="presentation" style="border-collapse:collapse;width:100%;max-width:560px">
${rows
  .map(
    (r) => `<tr><td style="padding:12px 0;border-top:1px solid #D9DEE8"><strong>${esc(r.email)}</strong><br>
<span style="color:#4A5670;font-size:14px">Signed up ${esc(day(r.created_at))}</span></td>
<td style="padding:12px 0;border-top:1px solid #D9DEE8;text-align:right">${button(r.link, "Approve")}</td></tr>`
  )
  .join("\n")}
</table>
${all ? `<p style="margin:20px 0 0">${button(all, `Approve all ${n}`)}</p>` : ""}
${waitingLine ? `<p style="margin:20px 0 0;color:#4A5670;font-size:14px">${esc(waitingLine)}</p>` : ""}
<p style="margin:20px 0 0;color:#4A5670;font-size:14px">Approving sends them a TestFlight invite from Apple. You'll confirm on the next screen.</p>
</body></html>`;
  return { subject, text, html };
}

function mime({ from, to, subject, text, html }) {
  const boundary = "bb-" + crypto.randomUUID();
  const id = `<${crypto.randomUUID()}@${from.split("@")[1]}>`;
  return [
    `From: Ball Boi Beta <${from}>`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `Message-ID: ${id}`,
    `Date: ${new Date().toUTCString()}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    text,
    `--${boundary}`,
    "Content-Type: text/html; charset=utf-8",
    "Content-Transfer-Encoding: 8bit",
    "",
    html,
    `--${boundary}--`,
    "",
  ].join("\r\n");
}

async function sendEmail(env, message) {
  const from = env.DIGEST_FROM || "beta@ballboi.tennis";
  const EmailMessage = env.__EmailMessage || (await import("cloudflare:email")).EmailMessage;
  await env.EMAIL.send(new EmailMessage(from, env.DIGEST_TO, mime({ from, to: env.DIGEST_TO, ...message })));
}

async function dailyRun(env) {
  await ensureSchema(env.DB);
  await sendApproved(env); // retry anyone approved earlier who isn't invited yet

  const { results: fresh } = await env.DB.prepare(
    "SELECT email, created_at FROM early_access WHERE notified_at IS NULL ORDER BY created_at"
  ).all();
  if (!fresh.length) return { sent: false, count: 0 };

  const { results: w } = await env.DB.prepare(
    "SELECT COUNT(*) AS n FROM early_access WHERE approved_at IS NOT NULL AND invited_at IS NULL"
  ).all();
  await sendEmail(env, await buildDigest(env, fresh, w[0].n));

  const stamp = now();
  for (const r of fresh) {
    await env.DB.prepare("UPDATE early_access SET notified_at = ?2 WHERE email = ?1").bind(r.email, stamp).run();
  }
  return { sent: true, count: fresh.length };
}

// ---------- approve pages ----------

function page(title, body, status = 200) {
  return new Response(
    `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex"><title>${esc(title)}</title>
<style>
body{margin:0;padding:32px 24px;font:17px/1.5 -apple-system,Helvetica,Arial,sans-serif;color:#0A2447;background:#fff}
main{max-width:520px;margin:0 auto}h1{font-size:26px;line-height:1.2;margin:0 0 16px}
ul{padding:0;list-style:none;margin:0 0 24px}li{padding:12px 0;border-top:1px solid #D9DEE8}li:last-child{border-bottom:1px solid #D9DEE8}
.muted{color:#4A5670;font-size:15px}
button{min-height:56px;padding:0 32px;border:0;border-radius:999px;background:#E9B949;color:#0A2447;font-family:inherit;font-size:17px;font-weight:700;line-height:1;cursor:pointer}
button:focus-visible{outline:3px solid #0A2447;outline-offset:3px}
</style></head><body><main>${body}</main></body></html>`,
    { status, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "x-robots-tag": "noindex" } }
  );
}

const badLink = () =>
  page("Link doesn't work", `<h1>This link doesn't work</h1><p>It may have been changed or copied incompletely. Open the Approve button from the latest digest email.</p>`, 400);

async function approveGet(env, url) {
  const emails = await readLink(env, url.searchParams.get("e"), url.searchParams.get("s"));
  if (!emails) return badLink();
  const n = emails.length;
  // Confirm first: mail apps and link scanners open links on their own, but never press buttons.
  return page(
    "Send to TestFlight?",
    `<h1>Send ${n === 1 ? "this person" : `these ${n} people`} to TestFlight?</h1>
<ul>${emails.map((e) => `<li>${esc(e)}</li>`).join("")}</ul>
<form method="post" action="/approve">
<input type="hidden" name="e" value="${esc(url.searchParams.get("e"))}">
<input type="hidden" name="s" value="${esc(url.searchParams.get("s"))}">
<button type="submit">Send to TestFlight</button>
</form>
<p class="muted">Apple emails each person an invite to test Ball Boi.</p>`
  );
}

async function approvePost(env, request) {
  const form = await request.formData();
  const emails = await readLink(env, form.get("e"), form.get("s"));
  if (!emails) return badLink();
  await ensureSchema(env.DB);

  const known = [];
  for (const email of emails) {
    const r = await env.DB.prepare(
      "UPDATE early_access SET approved_at = COALESCE(approved_at, ?2) WHERE email = ?1"
    )
      .bind(email, now())
      .run();
    if (r.meta?.changes) known.push(email);
  }
  const { results } = await env.DB.prepare(
    `SELECT email, invited_at FROM early_access WHERE email IN (${known.map((_, i) => `?${i + 1}`).join(",") || "''"})`
  )
    .bind(...known)
    .all();
  const already = new Set(results.filter((r) => r.invited_at).map((r) => r.email));
  const outcome = await sendApproved(env, known);

  const line = (email) => {
    if (!known.includes(email)) return `<strong>${esc(email)}</strong><br><span class="muted">Not on the list anymore. Nothing sent.</span>`;
    if (already.has(email)) return `<strong>${esc(email)}</strong><br><span class="muted">Already invited earlier.</span>`;
    const o = outcome[email];
    if (o?.ok) return `<strong>${esc(email)}</strong><br><span class="muted">&#10003; Invited. Apple is emailing them now.</span>`;
    if (o && !o.ok) return `<strong>${esc(email)}</strong><br><span class="muted">&#10005; Approved, but Apple said no: ${esc(o.error)}. Tomorrow's run tries again.</span>`;
    return `<strong>${esc(email)}</strong><br><span class="muted">&#10003; Approved. The invite goes out once TestFlight is set up.</span>`;
  };
  return page("Approved", `<h1>Done</h1><ul>${emails.map((e) => `<li>${line(e)}</li>`).join("")}</ul>`);
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (url.pathname === "/approve") {
      if (!env.APPROVE_SECRET) return page("Not set up", "<h1>Not set up yet</h1><p>APPROVE_SECRET is missing.</p>", 503);
      if (request.method === "GET") return approveGet(env, url);
      if (request.method === "POST") return approvePost(env, request);
      return new Response("Method not allowed", { status: 405 });
    }
    return new Response("Not found", { status: 404 });
  },

  async scheduled(event, env, ctx) {
    ctx.waitUntil(dailyRun(env));
  },
};

// For tests only.
export const _test = { dailyRun, approveLink, ensureSchema };
