import AdminReportingTab from '../components/Settings/AdminReportingTab';

// fix-68: standalone /settings/reporting route. Renders the same Reporting
// hub panel the Settings modal shows, so the hub is deep-linkable (and Run
// navigation works without the modal-close dance). The modal section and
// this page share AdminReportingTab — single source of truth.

export default function ReportingHubPage() {
  return (
    <div className="space-y-4" data-testid="reporting-hub-page">
      <div className="flex items-center gap-2">
        <span className="text-base">📊</span>
        <h1 className="text-xl font-extrabold text-text">Reporting</h1>
      </div>
      <AdminReportingTab />
    </div>
  );
}
