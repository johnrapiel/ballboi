# Early access digest

A small Cloudflare Worker that turns ballboi.tennis sign-ups into TestFlight testers, with John approving each one.

- **Twice a day (13:07 and 22:07 UTC, about 8 am and 5 pm Eastern):** if anyone new signed up, John gets one email listing them, each with an **Approve** button, plus **Approve all**. No new sign-ups, no email.
- **Approve:** opens a confirm page, and one more tap adds them to the external TestFlight group through the App Store Connect API. Apple emails them the invite. The confirm step is there because mail apps and link scanners open links on their own, but never press buttons.
- **Before TestFlight is ready** (no Apple key yet, or no approved build): approvals are saved and go out automatically on a later run once the Apple settings are in. Apple errors show on the result page and retry on the next run.
- **Links are signed**, so a forwarded or edited link can't approve anyone else.

One file, `worker.js`, no packages. It shares the `ballboi-early-access` D1 database with the site (`artifacts/marketing-site/_worker.js` writes sign-ups) and adds its own columns on first run: `notified_at`, `approved_at`, `invited_at`, `invite_error`.

Cost: free. Workers, D1, cron triggers and Email Routing all stay inside Cloudflare's free tier at this size. App Store Connect API access comes with the Apple Developer membership.

## Set up (Cloudflare dashboard, one time)

1. **Create the worker:** Workers & Pages > Create > Worker, name it `ballboi-beta`, Deploy, then **Edit code**, replace everything with `worker.js`, Deploy.
2. **Bindings** (Settings > Bindings):
   - D1 database: variable `DB`, database `ballboi-early-access`.
   - Send email: variable `EMAIL`, destination address = John's verified Email Routing address.
3. **Variables** (Settings > Variables and secrets):
   - `DIGEST_TO` (text): John's email. Must be a verified destination in Email Routing for ballboi.tennis.
   - `PUBLIC_URL` (text): the worker's own address, e.g. `https://ballboi-beta.<subdomain>.workers.dev`.
   - `DIGEST_FROM` (text, optional): defaults to `beta@ballboi.tennis`.
   - `APPROVE_SECRET` (secret): a long random string. Changing it breaks links in older digests.
4. **Cron** (Settings > Triggers > Cron Triggers): `7 13,22 * * *`.

## Add Apple later (when there's a TestFlight build)

1. App Store Connect > Users and Access > Integrations > App Store Connect API > generate a **Team key** with the **App Manager** role. Download the `.p8` file (Apple only lets you download it once).
2. TestFlight > External Testing > create the beta group, add the approved build. Copy the group's ID from its URL.
3. Add these as **secrets** on the worker (never paste them in chat or commit them): `ASC_KEY_ID`, `ASC_ISSUER_ID`, `ASC_PRIVATE_KEY` (the whole `.p8` text), `ASC_BETA_GROUP_ID`.

The next run sends everyone already approved.

## Useful queries (D1 > ballboi-early-access > Console)

- Everyone: `SELECT email, created_at, approved_at, invited_at, invite_error FROM early_access ORDER BY created_at;`
- Approved but not invited yet: `SELECT email, invite_error FROM early_access WHERE approved_at IS NOT NULL AND invited_at IS NULL;`
- Remove someone: `DELETE FROM early_access WHERE email = 'name@example.com';` (removing them from TestFlight is done in App Store Connect)
