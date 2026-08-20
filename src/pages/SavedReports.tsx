import AdminReportingTab from '../components/Settings/AdminReportingTab';

// ===========================================================================
// ★★★ fix-367 §1 — Saved Reports is not a setting
// ===========================================================================
//
// Bobby: *"In the ribbon, Saved Reports shows up, and when you click Saved
// Reports under the Reporting tab it shows Account, Team, Projects, Permits,
// Schedule. But the moment you click any of those it takes you to Settings. I
// think Saved Reports should just be the reporting feature, and then system
// settings would lose the Reporting tab."*
//
// ★★ NOTHING WAS BROKEN — the page was in the wrong place. It lived at
// `/settings/reporting`, which renders <SettingsPage />, so the entire Settings
// rail rendered beside it and every item in that rail is a Settings link. It
// was behaving exactly as its address said.
//
// ★ So this is the same component at a reporting address, with its own heading.
// fix-319 retired a wrapper called ReportingHubPage on the reasoning that the
// Settings page "now supplies the heading it existed for" — which was true, and
// is why moving out needs the heading back. The SHELF itself is untouched:
// `AdminReportingTab` is the same component it has always been, and fix-317's
// decision that the Reports group reads *Overview + Saved reports* stands.
//
// ★ Admin-gated at the router exactly as it was before, per fix-234.

export default function SavedReports() {
  return (
    <div className="p-4" data-testid="saved-reports-page">
      <div className="mb-4">
        <div className="text-base font-display font-extrabold text-text mb-0.5">
          📊 Saved reports
        </div>
        <div className="text-xs text-dim">
          The library of reports you can run, by category.
        </div>
      </div>
      <AdminReportingTab />
    </div>
  );
}
