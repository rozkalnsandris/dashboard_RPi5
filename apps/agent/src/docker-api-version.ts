export const DASHBOARD_DOCKER_API_MIN_VERSION = "1.40" as const;
export const DASHBOARD_DOCKER_API_MAX_VERSION = "1.55" as const;
export const DASHBOARD_DOCKER_API_PREFERRED_VERSION = "1.55" as const;

const VERSION_PATTERN = /^(0|[1-9]\d{0,2})\.(0|[1-9]\d{0,2})$/;

export class DockerApiVersionCompatibilityError extends Error {
  constructor() {
    super("Docker Engine API version is unsupported or malformed");
    this.name = "DockerApiVersionCompatibilityError";
  }
}

interface DockerApiVersionParts {
  major: number;
  minor: number;
}

function parseDockerApiVersion(value: unknown): DockerApiVersionParts {
  if (typeof value !== "string") throw new DockerApiVersionCompatibilityError();
  const match = VERSION_PATTERN.exec(value);
  if (match === null) throw new DockerApiVersionCompatibilityError();

  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (!Number.isSafeInteger(major) || !Number.isSafeInteger(minor)) {
    throw new DockerApiVersionCompatibilityError();
  }
  return { major, minor };
}

export function compareDockerApiVersions(left: string, right: string): number {
  const leftVersion = parseDockerApiVersion(left);
  const rightVersion = parseDockerApiVersion(right);
  if (leftVersion.major !== rightVersion.major) {
    return leftVersion.major - rightVersion.major;
  }
  return leftVersion.minor - rightVersion.minor;
}

function minimumVersion(left: string, right: string): string {
  return compareDockerApiVersions(left, right) <= 0 ? left : right;
}

function maximumVersion(left: string, right: string): string {
  return compareDockerApiVersions(left, right) >= 0 ? left : right;
}

export interface DockerDaemonVersionEvidence {
  ApiVersion: string;
  MinAPIVersion: string;
}

export function selectDockerApiVersion(value: unknown): string {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new DockerApiVersionCompatibilityError();
  }
  const record = value as Record<string, unknown>;
  if (typeof record.ApiVersion !== "string" || typeof record.MinAPIVersion !== "string") {
    throw new DockerApiVersionCompatibilityError();
  }

  const daemonMax = record.ApiVersion;
  const daemonMin = record.MinAPIVersion;
  parseDockerApiVersion(daemonMax);
  parseDockerApiVersion(daemonMin);
  if (compareDockerApiVersions(daemonMin, daemonMax) > 0) {
    throw new DockerApiVersionCompatibilityError();
  }

  const supportedMin = maximumVersion(daemonMin, DASHBOARD_DOCKER_API_MIN_VERSION);
  const supportedMax = minimumVersion(daemonMax, DASHBOARD_DOCKER_API_MAX_VERSION);
  if (compareDockerApiVersions(supportedMin, supportedMax) > 0) {
    throw new DockerApiVersionCompatibilityError();
  }

  return minimumVersion(DASHBOARD_DOCKER_API_PREFERRED_VERSION, supportedMax);
}

export function dockerApiPrefix(version: string): string {
  parseDockerApiVersion(version);
  if (
    compareDockerApiVersions(version, DASHBOARD_DOCKER_API_MIN_VERSION) < 0 ||
    compareDockerApiVersions(version, DASHBOARD_DOCKER_API_MAX_VERSION) > 0
  ) {
    throw new DockerApiVersionCompatibilityError();
  }
  return `/v${version}`;
}
