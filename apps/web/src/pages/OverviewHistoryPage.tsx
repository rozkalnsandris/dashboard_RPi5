import { BackupOverviewStatus } from "./BackupOverviewStatus";
import { EndpointOverviewStatus } from "./EndpointOverviewStatus";
import { HistoryPanel } from "./HistoryPanel";
import { LiveOverviewPage } from "./LiveOverviewPage";

export function OverviewHistoryPage() {
  return (
    <div className="overview-composed">
      <LiveOverviewPage />
      <EndpointOverviewStatus />
      <BackupOverviewStatus />
      <HistoryPanel />
    </div>
  );
}
