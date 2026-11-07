# Wave 2, Session M: /beta-release page on ballboi.tennis

From the footage review (Nov 7), decision B13 (spec decision 96). Assigned by the Wave 2 coordinator to a marketing site session (M for marketing).

**Where the site lives:** not on `main`. The marketing site source, including `/privacy` (`privacy.html`, `legal.css`), is in `artifacts/marketing-site/` on the branch `marketing/site-source` (open PR #101; #102 is stacked on it). Branch from `marketing/site-source`, and open your PR **into `marketing/site-source`**, the way #102 does. Don't touch `main`, the app or the API. Read `artifacts/marketing-site/README.md` on that branch first: the site is plain static files deployed to Cloudflare Pages by direct upload, not from Git.

```
Project: Ball Boi (github.com/johnrapiel/ballboi). Read claude/beta-recording-and-release.md in the Project and artifacts/marketing-site/README.md on the marketing/site-source branch before writing anything.

Rules:
- Touch only artifacts/marketing-site/ on the marketing/site-source branch. Don't merge: the coordinator session does that after John says yes.
- Tell me the cost before any service signup and prefer free tiers. Never ask me to paste secrets in chat.
- Only ask when a decision is truly mine: one question at a time, with your recommendation first.
```

Add a `/beta-release` page to ballboi.tennis with the release text in section 4 of `claude/beta-recording-and-release.md`, word for word, styled like `/privacy` (same layout, type and footer, reusing `legal.css`). Title "Ball Boi Beta Footage Release", "Version 1 · November 2026" under it. Don't link it from the main nav; the app links to it. Make sure `/beta-release` resolves without `.html`, the same way `/privacy` does.

Acceptance criteria (Do / Expect):
1. Do: open ballboi.tennis/beta-release on an iPhone. Expect: the full text, matching /privacy's look, readable without zooming.
2. Do: compare the text with section 4. Expect: identical wording.
3. Do: tap support@ballboi.tennis. Expect: a new email to that address.
4. Do: run an accessibility check. Expect: one h1, headings in order, text contrast at least 4.5:1, works at 200% zoom, links underlined.
5. Do: load ballboi.tennis. Expect: no nav link to the page.

PR rules:
- Before commenting "ready", load /impeccable and run `audit` on the page. Fix what it finds and put the results in the PR.
- Check it at the README's four widths (390, about 735, 900, 1280) and include screenshots, or say why you couldn't.
- End the PR with John's exact deploy steps for this change (build the zip, Cloudflare dashboard, drag in, Save and deploy), since the site isn't deployed from Git.
- Comment "ready" on the PR when done, and don't push again after that comment.
