# Ball Boi

iOS tennis app: find local players, run leagues, and record matches with Ball Boi shot analysis. Ships on the App Store, meets Apple's guidelines and WCAG 2.2 AA.

John (owner) is a product designer, not an engineer. Explain changes in plain language and lead with outcomes.

## Sources of truth

Build from these, in this order. If the repo disagrees with them, the live source wins; flag the gap and update the snapshot.

1. **Product spec** (live): https://claude.ai/code/artifact/ff76f66f-d4ec-49cb-b49a-7b9ad76fb102. Snapshot: `docs/product-spec.md`. The decision log at its end is the latest word.
2. **Design system** (live): https://claude.ai/artifact/XRuxb1uAfy18AQ1irQCkrf. Snapshot: `docs/design-system/README.md` and `docs/design-system/tokens.json`.
3. **Screen designs**: the "Ball Boi iOS" design canvas, https://claude.ai/artifact/LCm9Q9eKeRypqioMcTqDBU.
4. **App Store checklist**: `docs/app-store-checklist.md`. Update its status column in the same PR that changes an item.

Don't invent product behavior. If the spec doesn't cover something, ask John.

## Design rules

- Colors, type, spacing, and radii come from the design system tokens only: `paper`, `linen`, `sand`, `ink`, `ink-muted`, `on-ink`, `pool`, `clay`, `sun`, `danger`. Cormorant Garamond for display and scores, DM Sans for everything else.
- The old palette (Ink Navy, Court Cream, Teal Ace, Playfair Display, DM Mono) is retired. Don't add new uses of it.
- Every text pair clears 4.5:1 (3:1 for 24px+ text, focus rings, and control borders) in both Day and Night themes. `sun` is never text.
- Color is never the only signal: pair it with an icon or text.
- Touch targets are at least 44×44pt. Dynamic Type stays on. Respect Reduce Motion.
- Voice cues always have a text caption. Gestures always have a non-gesture alternative.

## Platform

- **App:** `artifacts/ios-app` (Expo / React Native). This is the product.
- **API:** `artifacts/api-server` (Express). **Database:** Postgres via Drizzle (`lib/db`), migrations in `scripts/migrations`.
- **Shot analysis:** `artifacts/ml-server` (Python).
- **Infrastructure:** Cloudflare. Video in R2; domains ballboi.tennis and ballboitennis.com. Keep new services in Cloudflare where possible, and keep costs near zero for the MVP.
- **Retired:** Replit (hosting, storage, secrets, tooling) and the web app in `artifacts/tennis-league`. Don't add Replit dependencies or build new features in the web app; it's slated for removal, with the privacy policy and terms moving to ballboi.tennis.

## How work ships

- Every change goes through a pull request. Never push to `main`.
- One feature per PR, with a plain-English description: what changed, which checklist item it covers, how to test it.
- Any `package.json` change must commit the regenerated `pnpm-lock.yaml`. Run `pnpm install` and commit the lockfile in the same PR.
- Before calling a PR ready, run `pnpm typecheck` and `pnpm test` and say what passed.
- Use merge commits for stacked PRs; squash is fine otherwise.
- Don't run destructive database migrations without John's go-ahead.
- Never commit secrets. Keys live in `.env` locally and in Cloudflare secrets in production.
