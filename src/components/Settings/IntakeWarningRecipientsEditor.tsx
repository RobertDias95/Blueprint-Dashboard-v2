import RecipientNamesEditor from './RecipientNamesEditor';
import { INTAKE_WARNING_RECIPIENTS_KEY } from '../../lib/intakeWarning';

// ===========================================================================
// ★★ fix-637 (P-180) — "Seattle intake warning goes to"
// ===========================================================================
//
// Bobby named the people (Miles and Brianna); the brief made it a Settings
// value rather than a hard-coded pair, so a change of desk is an edit here.
// Stored as ROSTER NAMES in app_config — the database resolves each one to a
// single login email (fix-634's `bp_notify_person_for_name`), and the pop-up
// matches the signed-in person by the same name.
//
// ★ fix-646: the control itself is now the shared RecipientNamesEditor (the
//   Resubmit-by warning uses the same one). Same test ids, same behaviour.

export default function IntakeWarningRecipientsEditor({ readOnly }: { readOnly: boolean }) {
  return (
    <RecipientNamesEditor
      readOnly={readOnly}
      configKey={INTAKE_WARNING_RECIPIENTS_KEY}
      testidPrefix="settings-intake-warning"
      intro={
        <>
          Each business day these people get a pop-up and a 7 AM email listing Seattle
          intake slots within 7 business days (weekends skipped), until each one is
          accepted, moved or released. It is a work alert, so the mention/assignment
          email switches don’t turn it off — take a person off this list instead.
        </>
      }
      addLabel="Add a person to the Seattle intake warning"
    />
  );
}
