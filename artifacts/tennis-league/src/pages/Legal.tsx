import type { ReactNode } from "react";
import { Link } from "wouter";

// Public pages. App Store guideline 5.1.1(i) requires a privacy policy linked
// in the app and in App Store Connect; 1.2 requires terms that forbid abusive
// content. Keep these in sync with the iOS privacy manifest and nutrition labels.

const SUPPORT_EMAIL = "support@ballboi.app";
const UPDATED = "October 16, 2026";

function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <main className="min-h-screen bg-background">
      <article className="mx-auto max-w-2xl px-4 py-10 space-y-6 text-foreground [&_h2]:text-lg [&_h2]:font-semibold [&_h2]:mt-8 [&_p]:text-[15px] [&_p]:leading-relaxed [&_li]:text-[15px] [&_li]:leading-relaxed [&_ul]:list-disc [&_ul]:pl-5 [&_ul]:space-y-1">
        <Link href="/" className="text-sm text-primary underline underline-offset-2">Back to Ball Boi</Link>
        <header>
          <h1 className="page-heading">{title}</h1>
          <p className="text-sm text-muted-foreground mt-1">Last updated {UPDATED}</p>
        </header>
        {children}
        <h2>Contact</h2>
        <p>
          Questions or requests: <a className="text-primary underline underline-offset-2" href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>.
        </p>
      </article>
    </main>
  );
}

export function PrivacyPolicy() {
  return (
    <LegalPage title="Privacy Policy">
      <p>Ball Boi helps you find players, run tennis leagues, track stats and analyze your matches on video. This policy explains what we collect, why, and the choices you have.</p>

      <h2>What we collect</h2>
      <ul>
        <li><strong>Account details:</strong> your name, email address, and sign-in method (Apple, Google or email). Sign-in is handled by our authentication provider, Clerk.</li>
        <li><strong>Player profile:</strong> skill rating, dominant hand, bio, and phone number if you add one.</li>
        <li><strong>League activity:</strong> leagues you join, availability, schedules, scores, standings and stats.</li>
        <li><strong>Match video:</strong> recordings you make with Ball Boi, plus the shot data and statistics we generate from them. Video may include other players on court.</li>
        <li><strong>Device data:</strong> push notification tokens, so we can send match reminders.</li>
      </ul>
      <p>We don't sell your data, use it for advertising, or track you across other companies' apps or websites.</p>

      <h2>How we use it</h2>
      <ul>
        <li>To run your account, leagues, schedules and standings.</li>
        <li>To analyze your match video, detect shots and build replays and stats.</li>
        <li>To send reminders and updates you've turned on.</li>
        <li>To keep the community safe, including reviewing reports of abuse.</li>
      </ul>

      <h2>Who can see it</h2>
      <ul>
        <li>League members see your name, rating, results and standings in leagues you join.</li>
        <li>Ball Boi replays are visible to you, the players in that match, and the league organizer.</li>
        <li>Service providers process data for us under contract: Clerk (sign-in), Cloudflare (video storage), and our hosting and database providers. They can't use it for their own purposes.</li>
        <li>We may disclose data if the law requires it.</li>
      </ul>

      <h2>Recording other players</h2>
      <p>Only record matches when the other players know they're being filmed. Any player in a recorded match can ask the recorder or us to remove the video.</p>

      <h2>Retention and deletion</h2>
      <p>We keep your data while your account is open. You can delete your account any time from <strong>Profile → Delete account</strong>. That permanently deletes your profile and every video you recorded. Past league results stay in standings under "Deleted player" so other players' records stay accurate.</p>

      <h2>Your rights</h2>
      <p>You can access, correct, export or delete your data. Email us and we'll respond within 30 days. Depending on where you live (for example, California or the EU), you may have additional rights under local law.</p>

      <h2>Children</h2>
      <p>Ball Boi isn't directed to children under 13, and we don't knowingly collect their data. If you believe a child has created an account, contact us and we'll delete it.</p>

      <h2>Changes</h2>
      <p>If we make material changes, we'll notify you in the app before they take effect.</p>
    </LegalPage>
  );
}

export function TermsOfUse() {
  return (
    <LegalPage title="Terms of Use">
      <p>By using Ball Boi you agree to these terms. If you don't agree, please don't use the app.</p>

      <h2>Your account</h2>
      <p>Keep your sign-in secure and your profile accurate. You're responsible for activity on your account.</p>

      <h2>Community rules: zero tolerance</h2>
      <p>Ball Boi has zero tolerance for objectionable content or abusive users. You may not:</p>
      <ul>
        <li>Harass, threaten, bully or demean anyone.</li>
        <li>Post sexual, violent, hateful or otherwise objectionable names, photos, bios or video.</li>
        <li>Impersonate someone or misrepresent your rating.</li>
        <li>Submit false scores or manipulate standings.</li>
        <li>Record people who haven't agreed to be filmed.</li>
      </ul>
      <p>You can report any player or content from their profile, and block anyone you don't want to interact with. We review reports within 24 hours and may remove content or suspend accounts that break these rules.</p>

      <h2>Your content</h2>
      <p>You own the video and information you add. You give us permission to store, process and display it to run Ball Boi for you and your leagues. You can delete it any time.</p>

      <h2>Safety on court</h2>
      <p>Tennis is a physical sport. You play at your own risk, and you're responsible for meeting up safely with other players.</p>

      <h2>Apple App Store</h2>
      <p>If you downloaded Ball Boi from the App Store, these terms are between you and Ball Boi, not Apple. Apple has no obligation to provide support or maintenance and isn't responsible for claims about the app. Apple's Licensed Application End User License Agreement also applies.</p>

      <h2>Disclaimers</h2>
      <p>Ball Boi is provided "as is." Shot detection and stats are estimates and may contain errors. To the extent the law allows, we aren't liable for indirect or consequential damages.</p>

      <h2>Changes and termination</h2>
      <p>We may update these terms and will notify you of material changes. You can stop using Ball Boi and delete your account at any time.</p>
    </LegalPage>
  );
}
