import {
  PUBLIC_ENDPOINT_STATUS_MAX_ENDPOINTS,
  parsePublicEndpointStatusSnapshot,
  type PublicEndpointHealth,
  type PublicEndpointStatusItem,
  type PublicEndpointStatusSnapshot,
} from "@dashboard-rpi5/contracts/endpoints";

import type { EndpointEvidenceReader } from "./agent-endpoint-evidence-client.js";

export type PublicEndpointsReader = () => Promise<PublicEndpointStatusSnapshot>;

interface PublicEndpointsReaderOptions {
  endpointEvidenceReader: EndpointEvidenceReader;
  now?: () => Date;
}

export class PublicEndpointsSourceUnavailableError extends Error {
  constructor() {
    super("Public endpoint status source unavailable");
    this.name = "PublicEndpointsSourceUnavailableError";
  }
}

const STATE_RANK = {
  DOWN: 0,
  DEGRADED: 1,
  UNKNOWN: 2,
  UP: 3,
} as const;

function deriveHealth(endpoints: readonly PublicEndpointStatusItem[]): PublicEndpointHealth {
  if (endpoints.length === 0) return "UNKNOWN";
  if (endpoints.some(({ state }) => state === "DOWN" || state === "DEGRADED")) return "ATTENTION";
  if (endpoints.some(({ state }) => state === "UNKNOWN")) return "UNKNOWN";
  return "HEALTHY";
}

export function createPublicEndpointsReader(
  options: PublicEndpointsReaderOptions,
): PublicEndpointsReader {
  const now = options.now ?? (() => new Date());

  return async () => {
    try {
      const evidence = await options.endpointEvidenceReader();
      const observedDate = now();
      if (!Number.isFinite(observedDate.getTime())) {
        throw new PublicEndpointsSourceUnavailableError();
      }
      const observedAt = observedDate.toISOString();
      const observedMs = observedDate.getTime();
      const latestByEndpoint = new Map<string, PublicEndpointStatusItem>();

      for (const event of evidence.events) {
        const occurredMs = Date.parse(event.occurredAt);
        if (!Number.isFinite(occurredMs) || occurredMs > observedMs) {
          throw new PublicEndpointsSourceUnavailableError();
        }
        if (latestByEndpoint.has(event.endpointId)) continue;

        latestByEndpoint.set(event.endpointId, {
          endpointId: event.endpointId,
          label: event.label,
          state: event.toState,
          lastChangedAt: new Date(occurredMs).toISOString(),
          statusCode: event.statusCode,
          latencyMs: event.latencyMs,
        });
      }

      if (latestByEndpoint.size > PUBLIC_ENDPOINT_STATUS_MAX_ENDPOINTS) {
        throw new PublicEndpointsSourceUnavailableError();
      }

      const endpoints = [...latestByEndpoint.values()].sort((left, right) => {
        const byState = STATE_RANK[left.state] - STATE_RANK[right.state];
        if (byState !== 0) return byState;
        const byLabel = left.label.localeCompare(right.label);
        return byLabel !== 0 ? byLabel : left.endpointId.localeCompare(right.endpointId);
      });

      return parsePublicEndpointStatusSnapshot({
        observedAt,
        health: deriveHealth(endpoints),
        endpoints,
      });
    } catch (error) {
      if (error instanceof PublicEndpointsSourceUnavailableError) throw error;
      throw new PublicEndpointsSourceUnavailableError();
    }
  };
}
