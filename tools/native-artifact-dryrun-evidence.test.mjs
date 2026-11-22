import assert from "node:assert/strict";
import test from "node:test";
import { Buffer } from "node:buffer";

import { verifyNativeArtifactDryRunEvidence } from "./native-artifact-dryrun-evidence.mjs";

test("source-only correlator never grants host authority or accepts empty inputs", () => {
  assert.throws(() => verifyNativeArtifactDryRunEvidence({}));
  assert.throws(() => verifyNativeArtifactDryRunEvidence({
    archive: Buffer.alloc(0), artifact: { sizeBytes: 0 },
  }));
});
