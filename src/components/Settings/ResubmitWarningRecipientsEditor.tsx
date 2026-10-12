import RecipientNamesEditor from './RecipientNamesEditor';
import { RESUBMIT_WARNING_RECIPIENTS_KEY } from '../../lib/resubmitBy';

// ===========================================================================
// ★★ fix-646 (P-011) — "Resubmit-by warning goes to"
// ===========================================================================
//
// Bobby 10-11: the warning reaches the permit's ENT lead and DM, plus Dave,
// Brittani and Bobby. The ENT and DM come from each permit; the fixed people
// are THIS list (seeded Dave, Brittani, Bobby by the migration) — no names in
// code. Not the DA: Bobby's choice.

export default function ResubmitWarningRecipientsEditor({ readOnly }: { readOnly: boolean }) {
  return (
    <RecipientNamesEditor
      readOnly={readOnly}
      configKey={RESUBMIT_WARNING_RECIPIENTS_KEY}
      testidPrefix="settings-resubmit-warning"
      intro={
        <>
          When a correction round passes its Resubmit-by date, a 7 AM email (weekdays)
          goes to the permit’s ENT lead and DM, and to everyone on this list. Each round
          is listed once, the morning after it passes; projects on hold are skipped.
          Anyone can turn it off for themselves under My account → Email notifications →
          Resubmit-by warnings.
        </>
      }
      addLabel="Add a person to the Resubmit-by warning"
    />
  );
}
