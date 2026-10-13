import RecipientNamesEditor from './RecipientNamesEditor';
import { SCRAPE_SILENCE_RECIPIENTS_KEY } from '../../lib/scrapeSilence';

// ===========================================================================
// ★★ fix-658 (P-343) — "Scraper-down alert goes to"
// ===========================================================================
//
// Bobby 10-12: when the permit scrape goes 36 weekday hours without running,
// an alert goes out. This is who it reaches (seeded Bobby by the migration).
// A work alert: no personal switch; leaving this list is how you stop it.

export default function ScrapeSilenceRecipientsEditor({ readOnly }: { readOnly: boolean }) {
  return (
    <RecipientNamesEditor
      readOnly={readOnly}
      configKey={SCRAPE_SILENCE_RECIPIENTS_KEY}
      testidPrefix="settings-scrape-silence"
      intro={
        <>
          When the permit scrape goes more than 36 weekday hours without running (weekends
          don’t count), one email goes to everyone on this list and one entry appears in
          Error triage. It happens once per outage and clears itself when a run lands.
        </>
      }
      addLabel="Add a person to the scraper-down alert"
    />
  );
}
