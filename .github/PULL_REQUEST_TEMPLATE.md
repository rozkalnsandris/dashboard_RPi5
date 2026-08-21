## Summary

## Scope

## Ready-gate evidence

Fill or refresh these fields before marking the PR Ready. GitHub is authoritative; stale chat evidence is not sufficient.

```text
CURRENT_MAIN_SHA=
PR_BASE_SHA=
PR_HEAD_SHA=
EXACT_HEAD_CI_RUN=
EXACT_HEAD_CI_RESULT=
REQUIRED_CHECKS=
UNRESOLVED_REVIEW_THREADS=
```

- [ ] `CURRENT_MAIN_SHA` was refreshed from GitHub.
- [ ] `PR_BASE_SHA` matches the intended current `main` boundary, or any divergence is explicitly reviewed.
- [ ] `PR_HEAD_SHA` is the exact head evaluated below.
- [ ] Required CI belongs to that exact head SHA and is successful.
- [ ] Unresolved review threads = `0` before Ready.

## Security / trust-boundary impact

- [ ] No new production/host mutation
- [ ] No new secret/credential
- [ ] No new Docker/systemd/terminal privilege
- [ ] No new Cloudflare/trust-boundary mutation
- [ ] Documentation updated if architecture or behavior changed

Describe any trust-boundary impact or explain why there is none:

## Validation

Record commands/checks and relevant exact-head CI evidence.

## Authorization state

These are independent gates. Do not infer one authorization from another.

```text
MERGE_AUTHORIZATION=NONE
PRODUCTION_MUTATION_AUTHORIZATION=NONE
ACTIONS_RERUN_CANCEL_AUTHORIZATION=NONE
REPOSITORY_SETTINGS_MUTATION_AUTHORIZATION=NONE
```

- [ ] Merge remains blocked until an explicit owner merge command.
- [ ] Production/deploy/trust-boundary mutation remains separately owner-gated.
- [ ] Actions rerun/cancel is not performed without explicit authorization.
- [ ] Repository-settings mutation is not performed without explicit authorization.

## Production deploy classification

`Production deploy: YES / NO`

Explain the classification:

> Classification is not deployment authorization.
