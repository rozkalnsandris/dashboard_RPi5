import { OverviewPage } from "../App";
import { BackupOverviewStatus } from "./BackupOverviewStatus";
import { EndpointOverviewStatus } from "./EndpointOverviewStatus";
import { HistoryPanel } from "./HistoryPanel";

export function OverviewHistoryPage() {
  return (
    <div className="overview-composed">
      <OverviewPage />
      <EndpointOverviewStatus />
      <BackupOverviewStatus />
      <HistoryPanel />
    </div>
  );
}
