import type {
  LogEntry,
  LogRange,
  LogSourceId,
  LogSourceKind,
} from "@dashboard-rpi5/contracts/logs";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ArrowDownToLine,
  Copy,
  Pause,
  Play,
  RefreshCw,
  Search,
  ShieldAlert,
  WrapText,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button } from "react-aria-components";

import { fetchLogs, fetchLogSources } from "../logs-api";

const LIVE_REFRESH_MS = 2_000;
const ranges: { value: LogRange; label: string }[] = [
  { value: "15m", label: "15 min" },
  { value: "1h", label: "1 hour" },
  { value: "6h", label: "6 hours" },
  { value: "24h", label: "24 hours" },
];
const sourceGroups: { kind: LogSourceKind; label: string }[] = [
  { kind: "DOCKER", label: "Docker" },
  { kind: "SYSTEMD", label: "Systemd" },
  { kind: "JOURNAL", label: "Journal" },
  { kind: "FILE", label: "Files" },
];

function entryKey(entry: LogEntry): string {
  return `${entry.timestamp ?? "none"}\u0000${entry.stream}\u0000${entry.message}`;
}

function formatLineTime(timestamp: string | null): string {
  if (timestamp === null) return "--:--:--";
  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) return "--:--:--";
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatCopyLine(entry: LogEntry): string {
  const timestamp = entry.timestamp ?? "untimestamped";
  return `${timestamp} ${entry.level} ${entry.stream} ${entry.message}`;
}

export function LogsPage() {
  const [sourceId, setSourceId] = useState<LogSourceId | null>(null);
  const [range, setRange] = useState<LogRange>("1h");
  const [queryText, setQueryText] = useState("");
  const [live, setLive] = useState(true);
  const [wrap, setWrap] = useState(true);
  const [stickToBottom, setStickToBottom] = useState(true);
  const [newLineCount, setNewLineCount] = useState(0);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">("idle");
  const viewerRef = useRef<HTMLDivElement | null>(null);
  const previousKeysRef = useRef<Set<string>>(new Set());
  const queryClient = useQueryClient();

  const sourcesQuery = useQuery({
    queryKey: ["log-sources"],
    queryFn: ({ signal }) => fetchLogSources(signal),
    staleTime: 60_000,
    refetchInterval: false,
    refetchOnReconnect: live,
  });

  const resolvedSourceId =
    sourceId ?? sourcesQuery.data?.sources[0]?.sourceId ?? null;
  const selectedSource = sourcesQuery.data?.sources.find(
    (source) => source.sourceId === resolvedSourceId,
  );
  const logsQueryKey = ["logs", resolvedSourceId, range] as const;

  const logsQuery = useQuery({
    queryKey: logsQueryKey,
    enabled: resolvedSourceId !== null,
    queryFn: ({ signal }) => {
      if (resolvedSourceId === null) throw new Error("Log source unavailable");
      return fetchLogs(resolvedSourceId, range, signal);
    },
    staleTime: 0,
    refetchInterval: live ? LIVE_REFRESH_MS : false,
    refetchIntervalInBackground: false,
    refetchOnReconnect: live,
    retry: 1,
  });

  const filteredEntries = useMemo(() => {
    const normalized = queryText.trim().toLowerCase();
    const entries = logsQuery.data?.entries ?? [];
    if (normalized.length === 0) return entries;
    return entries.filter((entry) =>
      `${entry.level} ${entry.stream} ${entry.message}`.toLowerCase().includes(normalized),
    );
  }, [logsQuery.data?.entries, queryText]);

  useEffect(() => {
    const entries = logsQuery.data?.entries;
    if (entries === undefined) return;

    const nextKeys = new Set(entries.map(entryKey));
    let added = 0;
    for (const key of nextKeys) {
      if (!previousKeysRef.current.has(key)) added += 1;
    }
    previousKeysRef.current = nextKeys;

    if (stickToBottom) {
      setNewLineCount(0);
      const frame = requestAnimationFrame(() => {
        const viewer = viewerRef.current;
        if (viewer !== null) viewer.scrollTop = viewer.scrollHeight;
      });
      return () => cancelAnimationFrame(frame);
    }
    if (added > 0) setNewLineCount((current) => Math.min(999, current + added));
    return undefined;
  }, [logsQuery.data?.observedAt, logsQuery.data?.entries, stickToBottom]);

  const toggleLive = () => {
    if (live) {
      setLive(false);
      void queryClient.cancelQueries(
        { queryKey: logsQueryKey, exact: true },
        { silent: true },
      );
      return;
    }
    setLive(true);
  };

  const jumpToNewest = () => {
    const viewer = viewerRef.current;
    if (viewer !== null) viewer.scrollTop = viewer.scrollHeight;
    setStickToBottom(true);
    setNewLineCount(0);
  };

  const copyVisible = async () => {
    try {
      if (navigator.clipboard === undefined) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(filteredEntries.map(formatCopyLine).join("\n"));
      setCopyState("copied");
    } catch {
      setCopyState("failed");
    }
  };

  const sourceFailure =
    (sourcesQuery.isError && sourcesQuery.data === undefined) ||
    (logsQuery.isError && logsQuery.data === undefined);
  const degraded = logsQuery.isRefetchError && logsQuery.data !== undefined;
  const isLoading =
    sourcesQuery.isPending ||
    (resolvedSourceId !== null && logsQuery.isPending);

  return (
    <section className="page-stack log-page-shell logs-live-page" aria-labelledby="logs-title">
      <div className="page-heading page-heading--compact">
        <div>
          <p className="eyebrow">Registered sources only</p>
          <h1 id="logs-title">Logs</h1>
          <p>Bounded read-only Docker, systemd, journal and registered-file evidence. Paths, units and container selectors stay server-owned.</p>
        </div>
      </div>

      <div className="log-toolbar" aria-label="Log controls">
        <label>
          <span>Source</span>
          <select
            value={resolvedSourceId ?? ""}
            disabled={sourcesQuery.data === undefined}
            onChange={(event) => {
              setSourceId(event.target.value as LogSourceId);
              previousKeysRef.current = new Set();
              setNewLineCount(0);
              setStickToBottom(true);
            }}
          >
            {sourceGroups.map((group) => {
              const sources = sourcesQuery.data?.sources.filter((source) => source.kind === group.kind) ?? [];
              if (sources.length === 0) return null;
              return (
                <optgroup key={group.kind} label={group.label}>
                  {sources.map((source) => (
                    <option key={source.sourceId} value={source.sourceId}>{source.label}</option>
                  ))}
                </optgroup>
              );
            })}
          </select>
        </label>

        <label>
          <span>Range</span>
          <select
            value={range}
            onChange={(event) => {
              setRange(event.target.value as LogRange);
              previousKeysRef.current = new Set();
              setNewLineCount(0);
              setStickToBottom(true);
            }}
          >
            {ranges.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}
          </select>
        </label>

        <Button className="toolbar-button" onPress={toggleLive}>
          {live ? <Pause size={16} aria-hidden="true" /> : <Play size={16} aria-hidden="true" />}
          {live ? "Pause" : "Live"}
        </Button>

        <label className="log-search">
          <span>Search visible snapshot</span>
          <span className="input-shell">
            <Search size={16} aria-hidden="true" />
            <input
              value={queryText}
              onChange={(event) => setQueryText(event.target.value)}
              placeholder="Search logs"
              inputMode="search"
            />
          </span>
        </label>

        <div className="log-toolbar-actions" aria-label="Viewer controls">
          <Button
            className={`toolbar-button${wrap ? " toolbar-button--active" : ""}`}
            onPress={() => setWrap((value) => !value)}
          >
            <WrapText size={16} aria-hidden="true" />
            {wrap ? "Wrap on" : "Wrap off"}
          </Button>
          <Button className="toolbar-button" onPress={() => void copyVisible()}>
            <Copy size={16} aria-hidden="true" />
            Copy
          </Button>
          <Button className="toolbar-button" onPress={jumpToNewest}>
            <ArrowDownToLine size={16} aria-hidden="true" />
            Newest
          </Button>
        </div>
      </div>

      <div className="log-status" role="status" aria-live="polite">
        <span className={`status-dot${live ? "" : " status-dot--paused"}`} aria-hidden="true" />
        <span>{live ? "Live · 2s visible refresh" : "Paused · snapshot frozen"}</span>
        <span>·</span>
        <span>{filteredEntries.length} visible / {logsQuery.data?.entries.length ?? 0} bounded lines</span>
        {logsQuery.data?.truncated ? <><span>·</span><span>Source output truncated to safety limits</span></> : null}
        {selectedSource?.rangeMode === "TAIL" ? <><span>·</span><span>Tail-only source · time range not asserted</span></> : null}
        {copyState === "copied" ? <><span>·</span><span>Copied</span></> : null}
        {copyState === "failed" ? <><span>·</span><span>Copy unavailable</span></> : null}
      </div>

      {sourceFailure ? (
        <div className="logs-message logs-message--warning" role="status">
          <ShieldAlert size={18} aria-hidden="true" />
          <div><strong>Log evidence unavailable</strong><span>No missing source is represented as an empty healthy stream.</span></div>
        </div>
      ) : null}

      {degraded ? (
        <div className="logs-message logs-message--warning" role="status">
          <ShieldAlert size={18} aria-hidden="true" />
          <div><strong>Latest log refresh failed</strong><span>Showing the last validated bounded snapshot.</span></div>
        </div>
      ) : null}

      {isLoading && !sourceFailure ? (
        <div className="logs-message" role="status">
          <RefreshCw size={18} aria-hidden="true" />
          <div><strong>Loading registered logs…</strong><span>Waiting for bounded local-agent evidence.</span></div>
        </div>
      ) : null}

      {newLineCount > 0 && live ? (
        <Button className="log-new-lines" onPress={jumpToNewest}>
          {newLineCount} new {newLineCount === 1 ? "line" : "lines"} · jump to newest
        </Button>
      ) : null}

      {logsQuery.data !== undefined ? (
        <div
          ref={viewerRef}
          className={`log-viewer${wrap ? "" : " log-viewer--nowrap"}`}
          tabIndex={0}
          aria-label={`Logs for ${logsQuery.data.source.label}`}
          onScroll={(event) => {
            const element = event.currentTarget;
            const nearBottom = element.scrollHeight - element.scrollTop - element.clientHeight <= 24;
            setStickToBottom(nearBottom);
            if (nearBottom) setNewLineCount(0);
          }}
        >
          {filteredEntries.length === 0 ? (
            <p className="empty-state">{queryText.trim().length === 0 ? "No log entries in this bounded snapshot." : "No lines match this search."}</p>
          ) : filteredEntries.map((entry) => (
            <div className="log-line" key={`${entry.sequence}-${entryKey(entry)}`}>
              <time dateTime={entry.timestamp ?? undefined}>{formatLineTime(entry.timestamp)}</time>
              <strong data-level={entry.level}>{entry.level}</strong>
              <span className="log-source">{entry.stream.toLowerCase()}</span>
              <span className="log-message">{entry.message}</span>
            </div>
          ))}
        </div>
      ) : null}
    </section>
  );
}
