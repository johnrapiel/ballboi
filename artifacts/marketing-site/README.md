# Ball Boi marketing site

The one-page site at **ballboi.tennis**, plus the Privacy Policy and Terms of Use that App Store Connect links to. Plain static files: no build step, no packages, no framework.

ballboitennis.com and both `www` addresses serve or redirect to the same site.

## What's here

| File | What it is |
|---|---|
| `index.html` | Home page: roundel, headline, subhead, "Get early access" pill and sign-up form |
| `_worker.js` | Handles early-access sign-ups at `POST /api/early-access` and serves everything else. Drag-and-drop deploys support this file but not a `functions/` folder |
| `early-access.js` | Opens the sign-up form from the pill, validates, posts, and shows "You're on the list" |
| `balls.js` | The pill's ball animation. Desktop: hover the pill. Phones: plays once on load. Off under Reduce Motion |
| `privacy.html`, `terms.html`, `legal.css` | Legal pages, served at `/privacy` and `/terms` |
| `assets/roundel-ink.*` | The roundel with no paper (navy strokes, transparent), 888px from the 1024px master |
| `assets/og.jpg` | Share image for link previews (1200x630) |
| `assets/apple-touch-icon.png`, `assets/favicon-32.png`, `favicon.ico` | Browser and home-screen icons |

## Rules

- **Roundel:** ink only on the white page, never the paper tile (decided Nov 3, 2026; see `claude/design-decisions/brush-headers-and-roundel.md` in the Project). Never upscale it: the hero caps at 440px so it stays sharp on Retina.
- **Accessibility:** text clears 4.5:1, links are underlined, tap targets are 44px or more, and the animation respects Reduce Motion.
- **Copy:** "Matchmaker. League commissioner. Shot analyst." matches what the app does at launch. Don't promise features the spec doesn't ship (no live line calls, no video playback, no coaching tips).
- **Legal pages** must match the current spec (18+, no video playback, training toggle, analysis-only audio, processors). Update them in the same PR as any decision that changes them.
- **Cache-busting:** when you replace an image or `balls.js` under the same name, bump its `?v=` number where it's referenced.
- **At launch:** swap the pill for Apple's official "Download on the App Store" badge linked to the listing. Keep `id="soon"` on whatever the animation targets, or update `balls.js`.

## Early access sign-ups

The pill opens a form: email (required) and zip (optional, to invite local testers first). Sign-ups go to a Cloudflare D1 database. Free: D1 and the worker stay well inside Cloudflare's free limits.

- **Spam:** a hidden "website" field that only bots fill; those sign-ups are dropped silently. If spam gets through anyway, add Cloudflare Turnstile (free).
- **Duplicates:** signing up twice keeps one row.
- **Without JavaScript:** the form shows by default and posts normally; the worker redirects back with `?early-access=joined`.
- **Privacy:** covered in `privacy.html` under "Early access sign-up." Keep them in step.

**One-time setup (before the first deploy that includes `_worker.js`):**
1. Cloudflare dashboard > Storage & Databases > D1 > **Create database**, named `ballboi-early-access`.
2. Workers & Pages > `ballboi` > Settings > **Bindings** > Add > **D1 database**. Variable name `DB`, database `ballboi-early-access`, for Production (and Preview if you test there).
3. Deploy. The table is created on the first sign-up.

**See the list:** D1 > `ballboi-early-access` > Console, then run
`SELECT email, zip, created_at FROM early_access ORDER BY created_at;`

**Remove someone:** `DELETE FROM early_access WHERE email = 'name@example.com';`

## Check before deploying

Look at the page at four widths: phone (390), browser pane (about 735), tablet (900) and desktop (1280). The mid widths are where layouts break.

```sh
cd artifacts/marketing-site
python3 -m http.server 8000   # then open http://localhost:8000
```

## Deploy

Hosted on Cloudflare Pages (project `ballboi`), deployed by direct upload, not from Git.

1. Zip the contents of this folder (the files, not the folder itself): `cd artifacts/marketing-site && zip -r ../../ballboi-site.zip . -x README.md`
2. Cloudflare dashboard > Workers & Pages > `ballboi` > Create deployment.
3. Pick **Production**, drag the zip in, then **Save and deploy**.
4. Open ballboi.tennis and check the change is live.

Cloudflare caching is set to respect the site's own headers, so changes show up right away. Link previews in apps like iMessage and Slack can keep an old image for links they've already shown.
