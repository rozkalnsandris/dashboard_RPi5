import { describe, expect, it } from "vitest";

import { buildGrafanaHistoryHref } from "./grafana-link.js";

describe("Grafana history links", () => {
  it("builds only the configured dashboard path with server-owned time context", () => {
    expect(
      buildGrafanaHistoryHref(
        "https://grafana.rozkalns.net/",
        "/d/rpi5-host/rpi5-host",
        "24h",
      ),
    ).toBe(
      "https://grafana.rozkalns.net/d/rpi5-host/rpi5-host?from=now-24h&to=now",
    );
  });

  it("omits incomplete or invalid targets", () => {
    expect(buildGrafanaHistoryHref(undefined, "/d/rpi5-host/rpi5-host", "1h")).toBeNull();
    expect(buildGrafanaHistoryHref("https://grafana.rozkalns.net/", undefined, "1h")).toBeNull();
    expect(
      buildGrafanaHistoryHref(
        "https://user:secret@grafana.rozkalns.net/",
        "/d/rpi5-host/rpi5-host",
        "1h",
      ),
    ).toBeNull();
    expect(
      buildGrafanaHistoryHref(
        "https://grafana.rozkalns.net/",
        "https://evil.example/d/x/y",
        "1h",
      ),
    ).toBeNull();
    expect(
      buildGrafanaHistoryHref(
        "javascript:alert(1)",
        "/d/rpi5-host/rpi5-host",
        "1h",
      ),
    ).toBeNull();
  });
});
