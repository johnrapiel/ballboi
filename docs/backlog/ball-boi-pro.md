# Ball Boi Pro (parked)

**Status:** parked on Nov 7, 2026 (spec decision 82). Nothing here ships at launch. Everything Pro would have covered (shot analysis, replay, trends, career stats) is free for everyone until John decides there's enough traction to charge.

**Why:** a small early group shouldn't be put off by a price before the app has proven itself. The plan below is kept intact so it can come back without redoing the work.

**When it comes back:** decide the trigger first (active players, recorded matches, or retention), then revisit price, the free period (existing users will already have had months of free analysis), and whether early users get grandfathered or a founding price. Session I in `claude/waves.md` is the build scope to restore.

## The plan as of Nov 2, 2026

Playing is free forever. Ball Boi Pro is $7.99/month or $59.99/year after 3 free months that start the first time a player uses any Pro feature.

- **What Pro includes at launch:** shot analysis, the simulated replay, trends, and full career stats. Travel mode, deeper head-to-head, and AI insights join Pro as each ships, at the same price
- **3 free months for everyone:** the clock starts at the first use of any Pro feature (recording, trends, or career stats), and the screen that starts it says "Your 3 free months of Pro start today." No paywall and no trial sheet during it. Tracked server-side by account so reinstalling doesn't reset it
- **Paywall ships at launch:** no free-until-X-users period and no founding member price. After the free months it appears the next time the user sets up a recording or opens a Pro feature ("Your 3 free months are up"), during setup and never at the fence
- **"Not now" still records and uploads:** analysis waits until they subscribe, unless the opponent has Pro (see Who sees what in a match); unanalyzed matches expire after 30 days
- **Sold through Apple In-App Purchase** as a plain auto-renewing subscription (no introductory offer, since the free period runs outside Apple), managed with RevenueCat's free tier. An external Stripe link is revisited after the Supreme Court rules on Apple's appeal in Epic v. Apple
- **Paywall discloses** price, renewal terms, and links to Terms and Privacy
- **After a lapse:** users keep everything they already unlocked: past breakdowns and replays, past opponent breakdowns, career stats, card highlights, and recaps. New analysis and trends require Pro

**Who sees what in a match**

- **A match is analyzed if either player has Pro** (paid or in their free months), whoever's phone recorded it. Shot data is stored for both players
- **A free player sees the first 4 games:** full breakdown and replay for games 1 to 4; the rest shows locked ("Games 5 to 12 are ready. Subscribe to see them."). Subscribing later unlocks every past analyzed match
- **Unused free months:** a free player who hasn't started theirs sees "Start your 3 free months to see the whole match." Nothing starts without their tap
- **Opponent breakdowns are mutual:** a player sees an opponent's full breakdown for matches they played together only when both have Pro. The free player sees "Alex has Pro and can see your breakdown. Subscribe to see theirs."
- **Placeholder opponents who join later** see "<name> recorded your match on <date>" with their training toggle, then the same 4-game teaser and free-months offer

## Spec decisions this parks

| # | Decision |
| --- | --- |
| 3 | 3 months free from the first recording; soft paywall at the next use after; "Not now" records but analysis waits (replaces the free-first-match model, Oct 18) |
| 10 | Reviewer: password demo account, seeded data, live paywall, on-court screen recording |
| 14 | Apple IAP via RevenueCat at launch; Stripe link revisited after the Supreme Court rules |
| 32 | Playing stays free forever: leagues, Discover, match requests, scores, messaging, and the player card (Nov 2) |
| 33 | Pro at launch is shot analysis, replay, trends, and full career stats; travel mode, deeper head-to-head, and AI insights join Pro as they ship, at the same price (Nov 2) |
| 34 | Every account gets 3 free months of Pro, starting at the first use of any Pro feature with a "starts today" message. Replaces "from the first recording" in decision 3 (Nov 2) |
| 35 | The paywall ships at launch; no free-until-X-users period and no founding member price (Nov 2) |
| 36 | Pro costs $7.99/month or $59.99/year (replaces $5 / $40) (Nov 2) |
| 37 | A match is analyzed if either player has Pro (paid or in free months), no matter whose phone recorded it (Nov 2) |
| 38 | Free players get the full breakdown and replay for the first 4 games; the rest shows locked. Subscribing later unlocks every past analyzed match (Nov 2) |
| 39 | Free players with unused free months see "Start your 3 free months to see the whole match"; nothing starts without their tap (Nov 2) |
| 40 | Opponent breakdowns are mutual: a player sees an opponent's full breakdown for matches they played together only when both have Pro (Nov 2) |
| 41 | Placeholder opponents who join later get the "recorded your match" notice and training toggle, then the 4-game teaser and free-months offer (Nov 2) |
| 42 | When Pro lapses, players keep everything already unlocked, including past opponent breakdowns; new analysis and trends need Pro (Nov 2) |

## App Store checklist rows this parks

| Item | Guideline | Status | Notes |
|---|---|---|---|
| Plain IAP subscription after 3 free months, RevenueCat | 3.1.1, 3.1.2 | ❌ | Decided Nov 2: $7.99/month or $59.99/year (replaces $5 / $40), one subscription group, plain auto-renewing subscription with no introductory offer (the free period runs outside Apple). Ships at launch, no founding price. Managed with RevenueCat's free tier. External Stripe link revisited after the Supreme Court rules on Apple's appeal in Epic v. Apple. Leagues, Discover, match requests, scores, messaging, player cards stay free |
| What Pro unlocks | 3.1.1 | ❌ | At launch: shot analysis, simulated replay, trends, full career stats. Travel mode, deeper head-to-head, and AI insights join Pro as they ship, same price |
| 3 free months from first use of any Pro feature, then paywall | 3.1.1, 3.1.2 | ❌ | Clock starts the first time a player records, opens trends, or opens career stats, with "Your 3 free months of Pro start today." Tracked server-side by account. No paywall and no trial sheet during it. After it ends, paywall shows the next time the user sets up a recording or opens a Pro feature ("Your 3 free months are up"), during setup, never at the fence. "Not now" still records and uploads; analysis waits until they subscribe unless the opponent has Pro; unanalyzed matches expire after 30 days |
| Mixed matchups (one player has Pro) | 3.1.1 | ❌ | Match analyzed if either player has Pro (paid or free months), whoever recorded. Free player sees full breakdown and replay for games 1 to 4, the rest locked ("Games 5 to 12 are ready. Subscribe to see them."); subscribing unlocks every past analyzed match. Unused free months: "Start your 3 free months to see the whole match," never automatic. Opponent breakdowns are mutual: visible only when both have Pro. Locked games say so in text and to VoiceOver, never just blurred |
| Paywall disclosure | 3.1.2 | ❌ | Price, renewal price and period, how to cancel, links to Terms and Privacy, all near the subscribe button |
| Restore Purchases | 3.1.1 | ❌ | Not in the spec but required. On the paywall and in Profile > Subscription |
| Lapsed state | 3.1.2 | ❌ | Keep everything already unlocked: past breakdowns and replays, past opponent breakdowns, career stats, card highlights, recaps. New analysis and trends need Pro |
| Subscription metadata | 3.1.2 | ❌ | Terms of Use (EULA) and privacy policy links in the App Store description or custom EULA field. Subscription products ($7.99/month, $59.99/year) submitted with the build |
| Locked games and paywall teaser accessible | 1.1.1, 1.4.1, 4.1.2 | ❌ | Locked games carry a text label and lock icon ("Games 5 to 12 locked"), read by VoiceOver; never blur alone. Subscribe and Start free months buttons 44pt |

## Build scope (Wave 2, Session I, as planned)

| Session | Scope |
|---|---|
| I. Ball Boi Pro | RevenueCat (free tier) and IAP ($7.99/month, $59.99/year, one group, no intro offer; pricing changed Nov 2, spec decision 36), paywall ships at launch; 3 free months for everyone from first use of any Pro feature ("Your 3 free months of Pro start today"), tracked server-side; paywall at setup with disclosures, Restore Purchases, "Not now" records with 30-day expiry; mixed matchups: a match is analyzed if either player has Pro, the free player sees games 1 to 4 plus a free-months offer, opponent breakdowns only when both have Pro, placeholder opponents get the same teaser; lapsed users keep what they already unlocked (spec decisions 32 to 43). Playing stays free; the Organizer plan waits until after launch |

Session G was also going to install RevenueCat's native SDK for Session I.
