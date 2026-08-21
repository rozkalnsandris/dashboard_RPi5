# Operator entry points

There are currently **no active one-shot production/recovery shell helpers** in this directory.

The historical #126 and #151 operator helpers that previously lived under `tools/operator/` were consumed during completed, evidence-recorded production gates and were retired from the active tree by #165. Their exact source remains available in Git history and the corresponding incident/continuity issues.

Do **not** reconstruct or execute a historical helper from Git history as if its old acknowledgement string were current authorization. Any future production or trust-boundary action requires a fresh reviewed source path and the separate explicit owner authorization required by `AGENTS.md` and issue #1.

Reusable source-level production controllers remain under `tools/production-*.mjs`; they are not one-shot owner-ack operator scripts and are outside the #165 retirement scope.

Current execution state must be taken from the canonical handoff issue #171 and the master contract issue #1, not from archived incident instructions.
