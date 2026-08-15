import { OverviewPage } from "../App";
import { BackupOverviewStatus } from "./BackupOverviewStatus";
import { HistoryPanel } from "./HistoryPanel";

export function OverviewHistoryPage() {
  return (
    <div className="overview-composed">
      <OverviewPage />
      <BackupOverviewStatus />
      <HistoryPanel />
    </div>
  );
}
