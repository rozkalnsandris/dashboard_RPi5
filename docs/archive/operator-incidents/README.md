# Historical one-shot operator incident documentation

> **HISTORICAL / COMPLETED / DO NOT EXECUTE**
>
> The files in this directory are preserved verbatim as design, incident and authorization-boundary evidence. They describe one-shot #126/#151 preparation, activation and recovery paths whose relevant owner authorizations were consumed and whose production work is complete.
>
> Embedded acknowledgement strings, historical PIDs, SHAs, gates or instructions are **not current authorization** and must not be reused as an operator procedure.

These documents were moved out of the active `docs/` root by #165 without changing their file contents or blobs. Full Git history remains preserved.

Current execution state and authorization gates must be read from:
- issue #1 — master product/security/governance contract;
- issue #171 — canonical current handoff;
- issue #165 — operator-surface retirement receipt.

Archived documents:
- `ISSUE126_ISOLATED_CANDIDATE_PREP_R3.md` — historical isolated candidate-preparation R3 design/evidence;
- `ISSUE126_PARTIAL_ROLLOUT_RECOVERY.md` — historical partial-rollout diagnosis/recovery contract;
- `ISSUE126_POST_169_REBIND.md` — historical candidate-prep lineage rebind;
- `ISSUE126_POST_MERGE_CANDIDATE_GATE_FIX.md` — historical post-merge source-gate correction;
- `ISSUE126_PRODUCTION_ACTIVATION_GATE.md` — historical P3 production activation gate;
- `ISSUE126_PRODUCTION_CANDIDATE_PREP.md` — historical P3 candidate-preparation gate;
- `ISSUE151_AGENT_WEB_CUTOVER_CONTINUATION.md` — historical #151 agent/web cutover continuation.

Consumed executable helpers removed from the active `tools/operator/` namespace by #165 are preserved in Git history at their pre-retirement blobs:

```text
issue126-partial-rollout-recovery.sh                 8cc8311bc6468883e0f49b3bee64f26687791e77
issue126-production-activation.sh                    a866101e02c444a0bc89f807eee862b4d28b372c
issue126-production-candidate-prep-isolated-wrapper.sh 174479089a3f51c3216a80e2ded9428f27e9d0dd
issue126-production-candidate-prep.sh                3541750f511289056c4a4b8d684db139b9c903eb
issue151-agent-web-cutover.sh                        855401854154ff57c08f8c554383fc1ed09cb7ff
issue151-issue127-permission-recovery.sh              2b7d395d1c5370e40f12051bcab77d19fb6df582
```

Do not reconstruct/rerun any of them from Git history without a new reviewed source path and a new explicit owner authorization where required.

This archive operation is source-only. It does not perform or authorize production, host, systemd, Docker-authority, permissions, Cloudflare, terminal or GitHub Actions mutation.
