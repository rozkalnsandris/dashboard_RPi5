# GitHub-first / bounded RDC fallback — dashboard_RPi5

Adoption for issue #296, pinning `rozkalnsandris/ops-workflows@4e89b75d7f496dfb43fd9c1eb10a995fad53fdd8` (`docs/GITHUB_FIRST_RDC_FALLBACK_V1.md` and `policy/github-first-rdc-fallback-v1.json`).

Choose connected GitHub tools for source, issues, PRs, review and checks; use GitHub Actions when safe source tests are equivalent. RDC requires a genuinely host-local task, an exact GitHub/CI capability gap, pre-existing owner authority and only the smallest bounded operation. Record these sanitized fields first: `STEP`, `REPOSITORY_AND_TARGET`, `GITHUB_CAPABILITY_CHECKED`, `PRECISE_CAPABILITY_GAP`, `GITHUB_CI_NOT_EQUIVALENT_REASON`, `MINIMAL_RDC_OPERATION`, `EXISTING_AUTHORIZATION`, `GITHUB_RETURN_EVIDENCE`. Return to GitHub afterward.

On access denial, 403/429, tool failure, timeout or uncertain GitHub mutation: STOP; never use RDC to duplicate or bypass a GitHub write. Do not expose protected infrastructure details or secrets.

Issue #1, SECURITY.md and local rules still govern. Merge is owner-only; merge is not LIVE. Production, Cloudflare, Docker, systemd, agent, terminal/PTY, privileged actions, secrets and permissions retain separate exact authorization. Bare START, FAST-LANE, GITHUB-ONLY and LIVE-ALL retain their existing meanings.

Changed files are restricted to AGENTS.md, the local policy JSON, this documentation and an existing Node test. No runtime or workflow changes. GitHub-hosted CI remains the validation authority.

Production deploy: NO
