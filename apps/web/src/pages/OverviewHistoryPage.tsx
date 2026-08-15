import { OverviewPage } from "../App";
import { HistoryPanel } from "./HistoryPanel";

export function OverviewHistoryPage() {
  return (
    <div className="overview-composed">
      <OverviewPage />
      <HistoryPanel />
    </div>
  );
}
