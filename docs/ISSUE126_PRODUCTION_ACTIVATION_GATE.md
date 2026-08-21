# Issue #126 production activation gate

## Status

Source-only staging document for the bounded Docker recent-events production activation gate.

This branch is based on exact reviewed main:

```text
BASE_MAIN=f87f803e13ec50ec5909b27dc160da7e66621af3
BASE_TREE=401d3cc7ca5f0b81417cac548a5af72f02da5485
```

The exact production candidate was prepared and verified by the owner-authorized R3 one-shot preparation:

```text
TARGET=a39fc7a9873eedb58cfa49568f9b2e05483cf7c2
TARGET_TREE=bd2fa68711b1cf4617088a18c524e3c60d427152
CANDIDATE_SHA256=eb3f406f798ad391ab692e81253c0f70dae1acb05ac7b62a6640cfff494818b0
MANIFEST_SHA256=ce995eaebe239cf97364d3ef2a5f15516461e9780b591b02c609847e55674821
FILES=61
BYTES=6543699
```

Accepted production remains unchanged:

```text
CURRENT_RELEASE=4295c23de5634dcb86b5fe9f57be92416eb9a75b
host=200
docker=200
logs=200
quick=200
events=503
terminal=absent
access=302
```

## Intended activation model

This PR will stage one exact owner-gated mutation path only:

1. immutable GitHub/PR/CI/candidate provenance proof;
2. read-only production preflight and race gate;
3. existing `production-release-controller.mjs --apply` with exact candidate, exact current release and its built-in owner acknowledgement;
4. restart Docker broker exactly once and prove application readiness plus bounded recent-events capability;
5. restart main agent exactly once and prove current-state/logs/Quick Commands/events while preserving the no-Docker-authority boundary;
6. restart web exactly once and prove loopback/API/activity acceptance;
7. prove terminal remains absent, Cloudflare Access remains unchanged and all three services execute the exact target release;
8. STOP.

No `daemon-reload`, unit-file mutation, identity/group mutation, chmod/chown widening outside the existing release controller, Docker authority widening, Cloudflare mutation, terminal activation, Actions mutation, retry, rollback or cleanup is part of this gate.

If any failure or ambiguity occurs after the first mutation begins, preserve evidence and STOP. A new owner authorization is required for any retry, rollback, cleanup or alternate path.

## Authorization

```text
R3_PREP_AUTHORIZATION=CONSUMED
PRODUCTION_MUTATION_AUTHORIZATION=NONE
MERGE_AUTHORIZATION=NONE
ACTIONS_RERUN_AUTHORIZATION=NONE
OLD_WORKSPACE_CLEANUP_AUTHORIZATION=NONE
```

The exact activation PR number and post-merge source lineage will be bound after GitHub assigns the Draft PR number. This staging document itself authorizes no production mutation.
