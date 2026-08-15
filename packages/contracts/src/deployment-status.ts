import { Static, Type } from "@sinclair/typebox";

export const DEPLOYMENT_PROJECT_ID = "rpi5-main" as const;
export const DEPLOYMENT_PROJECT_LABEL = "RPi5 host configuration" as const;
export const DEPLOYMENT_REPOSITORY = "rozkalnsandris/RPi5_main" as const;

export const DEPLOYMENT_IMPACT_PATHS = [
  "ops/bin/rpi5-backup",
  "ops/cron.d/rpi5-backup",
  "ops/logrotate.d/rpi5-backup",
  "ops/deploy/targets.json",
  "scripts/rpi5-deploy",
  "scripts/rpi5_deploy.py",
  "scripts/rpi5_deploy_lib.py",
  "scripts/rpi5_deploy_tx.py",
] as const;

export const DeploymentClassificationSchema = Type.Union([
  Type.Literal("IN_SYNC"),
  Type.Literal("MAIN_AHEAD_NO_DEPLOY"),
  Type.Literal("DEPLOY_REQUIRED"),
  Type.Literal("DEPLOY_PENDING_AUTH"),
  Type.Literal("UNKNOWN"),
]);
export type DeploymentClassification = Static<typeof DeploymentClassificationSchema>;

const DeploymentImpactPathSchema = Type.Union(
  DEPLOYMENT_IMPACT_PATHS.map((path) => Type.Literal(path)),
);
export type DeploymentImpactPath = (typeof DEPLOYMENT_IMPACT_PATHS)[number];

const NullableFullShaSchema = Type.Union([
  Type.String({ pattern: "^[0-9a-f]{40}$" }),
  Type.Null(),
]);
const NullableShortShaSchema = Type.Union([
  Type.String({ pattern: "^[0-9a-f]{12}$" }),
  Type.Null(),
]);
const NullableTimestampSchema = Type.Union([
  Type.String({ format: "date-time" }),
  Type.Null(),
]);

export const DeploymentProjectStateSchema = Type.Object(
  {
    projectId: Type.Literal(DEPLOYMENT_PROJECT_ID),
    label: Type.Literal(DEPLOYMENT_PROJECT_LABEL),
    repository: Type.Literal(DEPLOYMENT_REPOSITORY),
    classification: DeploymentClassificationSchema,
    productionCommit: NullableShortShaSchema,
    productionSha: NullableFullShaSchema,
    mainSha: NullableFullShaSchema,
    lastVerifiedDeployAt: NullableTimestampSchema,
    aheadBy: Type.Union([
      Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
      Type.Null(),
    ]),
    productionImpact: Type.Union([Type.Boolean(), Type.Null()]),
    impactPaths: Type.Array(DeploymentImpactPathSchema, {
      maxItems: DEPLOYMENT_IMPACT_PATHS.length,
    }),
  },
  { additionalProperties: false },
);
export type DeploymentProjectState = Static<typeof DeploymentProjectStateSchema>;

export const DeploymentStatusSnapshotSchema = Type.Object(
  {
    observedAt: Type.String({ format: "date-time" }),
    project: DeploymentProjectStateSchema,
  },
  { additionalProperties: false },
);
export type DeploymentStatusSnapshot = Static<typeof DeploymentStatusSnapshotSchema>;

export const DeploymentStatusQuerySchema = Type.Object({}, { additionalProperties: false });
export const DeploymentStatusApiErrorSchema = Type.Object(
  { error: Type.Union([Type.Literal("INVALID_REQUEST"), Type.Literal("SOURCE_UNAVAILABLE")]) },
  { additionalProperties: false },
);

const SHORT_SHA = /^[0-9a-f]{12}$/;
const FULL_SHA = /^[0-9a-f]{40}$/;
const CLASSIFICATIONS = new Set<DeploymentClassification>([
  "IN_SYNC",
  "MAIN_AHEAD_NO_DEPLOY",
  "DEPLOY_REQUIRED",
  "DEPLOY_PENDING_AUTH",
  "UNKNOWN",
]);
const IMPACT_PATH_SET = new Set<string>(DEPLOYMENT_IMPACT_PATHS);
const IMPACT_PATH_RANK = new Map<string, number>(
  DEPLOYMENT_IMPACT_PATHS.map((path, index) => [path, index]),
);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, keys: readonly string[]): boolean {
  const allowed = new Set(keys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isCanonicalIso(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function nullableSha(value: unknown, pattern: RegExp): string | null {
  if (value === null) return null;
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new Error("Invalid deployment status");
  }
  return value;
}

function nullableTimestamp(value: unknown): string | null {
  if (value === null) return null;
  if (!isCanonicalIso(value)) throw new Error("Invalid deployment status");
  return value;
}

function nullableAheadBy(value: unknown): number | null {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || Number(value) < 0) {
    throw new Error("Invalid deployment status");
  }
  return Number(value);
}

function parseImpactPaths(value: unknown): DeploymentImpactPath[] {
  if (!Array.isArray(value) || value.length > DEPLOYMENT_IMPACT_PATHS.length) {
    throw new Error("Invalid deployment status");
  }
  if (
    value.some((path) => typeof path !== "string" || !IMPACT_PATH_SET.has(path)) ||
    new Set(value).size !== value.length
  ) {
    throw new Error("Invalid deployment status");
  }
  const paths = [...value] as DeploymentImpactPath[];
  const sorted = [...paths].sort(
    (left, right) => (IMPACT_PATH_RANK.get(left) ?? 99) - (IMPACT_PATH_RANK.get(right) ?? 99),
  );
  if (JSON.stringify(paths) !== JSON.stringify(sorted)) {
    throw new Error("Invalid deployment status");
  }
  return paths;
}

export function parseDeploymentStatusSnapshot(value: unknown): DeploymentStatusSnapshot {
  if (
    !isRecord(value) ||
    !hasOnlyKeys(value, ["observedAt", "project"]) ||
    !isCanonicalIso(value.observedAt) ||
    !isRecord(value.project) ||
    !hasOnlyKeys(value.project, [
      "projectId",
      "label",
      "repository",
      "classification",
      "productionCommit",
      "productionSha",
      "mainSha",
      "lastVerifiedDeployAt",
      "aheadBy",
      "productionImpact",
      "impactPaths",
    ]) ||
    value.project.projectId !== DEPLOYMENT_PROJECT_ID ||
    value.project.label !== DEPLOYMENT_PROJECT_LABEL ||
    value.project.repository !== DEPLOYMENT_REPOSITORY ||
    typeof value.project.classification !== "string" ||
    !CLASSIFICATIONS.has(value.project.classification as DeploymentClassification)
  ) {
    throw new Error("Invalid deployment status");
  }

  const classification = value.project.classification as DeploymentClassification;
  const productionCommit = nullableSha(value.project.productionCommit, SHORT_SHA);
  const productionSha = nullableSha(value.project.productionSha, FULL_SHA);
  const mainSha = nullableSha(value.project.mainSha, FULL_SHA);
  const lastVerifiedDeployAt = nullableTimestamp(value.project.lastVerifiedDeployAt);
  const aheadBy = nullableAheadBy(value.project.aheadBy);
  const productionImpact =
    value.project.productionImpact === null
      ? null
      : typeof value.project.productionImpact === "boolean"
        ? value.project.productionImpact
        : (() => {
            throw new Error("Invalid deployment status");
          })();
  const impactPaths = parseImpactPaths(value.project.impactPaths);

  if (
    (productionCommit === null) !== (lastVerifiedDeployAt === null) ||
    (productionSha !== null && productionCommit === null) ||
    (productionSha !== null && !productionSha.startsWith(productionCommit ?? "")) ||
    (lastVerifiedDeployAt !== null && Date.parse(lastVerifiedDeployAt) > Date.parse(value.observedAt))
  ) {
    throw new Error("Invalid deployment status");
  }

  if (classification === "IN_SYNC") {
    if (
      productionCommit === null || productionSha === null || mainSha === null ||
      productionSha !== mainSha || aheadBy !== 0 || productionImpact !== false ||
      impactPaths.length !== 0
    ) throw new Error("Invalid deployment status");
  } else if (classification === "MAIN_AHEAD_NO_DEPLOY") {
    if (
      productionCommit === null || productionSha === null || mainSha === null ||
      productionSha === mainSha || aheadBy === null || aheadBy <= 0 ||
      productionImpact !== false || impactPaths.length !== 0
    ) throw new Error("Invalid deployment status");
  } else if (classification === "DEPLOY_REQUIRED" || classification === "DEPLOY_PENDING_AUTH") {
    if (
      productionCommit === null || productionSha === null || mainSha === null ||
      productionSha === mainSha || aheadBy === null || aheadBy <= 0 ||
      productionImpact !== true || impactPaths.length === 0
    ) throw new Error("Invalid deployment status");
  } else if (
    aheadBy !== null ||
    productionImpact !== null ||
    impactPaths.length !== 0
  ) {
    throw new Error("Invalid deployment status");
  }

  return {
    observedAt: value.observedAt,
    project: {
      projectId: DEPLOYMENT_PROJECT_ID,
      label: DEPLOYMENT_PROJECT_LABEL,
      repository: DEPLOYMENT_REPOSITORY,
      classification,
      productionCommit,
      productionSha,
      mainSha,
      lastVerifiedDeployAt,
      aheadBy,
      productionImpact,
      impactPaths,
    },
  };
}
