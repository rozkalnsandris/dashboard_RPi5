# Phase 12 filesystem capacity semantics

Issue: #241

The host summary keeps a deliberately small public filesystem contract while making its meanings explicit.

For the root filesystem `/`, Linux/POSIX `statfs` evidence is interpreted as:

```text
total     = blocks * bsize
free      = bfree  * bsize
available = bavail * bsize
used      = total - free
reserved  = free - available
```

The public `HostSummary.filesystem` fields mean:

- `totalBytes`: total filesystem block capacity;
- `usedBytes`: physically used block capacity (`total - free`), excluding free blocks reserved from ordinary users;
- `usedPercent`: `usedBytes / totalBytes * 100`;
- `availableBytes`: free capacity available to the normal/unprivileged dashboard service identity (`bavail`).

`freeBytes` and `reservedBytes` are not currently added to the public API because no current consumer requires them. Their distinction remains derivable from trusted `statfs` evidence inside the collector. If a future UI needs to display reserved capacity explicitly, the contract should add a typed `reservedBytes` field rather than relabeling `availableBytes`.

## Validation

The collector fails closed when filesystem evidence is impossible or cannot be represented safely:

- block size or total blocks are non-positive;
- `bfree < 0` or `bfree > blocks`;
- `bavail < 0` or `bavail > bfree`;
- byte products exceed JavaScript `Number.MAX_SAFE_INTEGER`.

Runtime `statfs(..., { bigint: true })` supplies both `bfree` and `bavail`. The optional `bfree` compatibility seam exists only for older injected tests and is interpreted as `bfree = bavail`, i.e. a fixture with no reserved free blocks. Both runtime and fixture calculations still flow through the same `calculateFilesystemUsage` function.

## UI meaning

Any disk percentage sourced from `HostSummary.filesystem.usedPercent` means **physically used blocks**, not `100% - available-to-service`. Therefore a filesystem can legitimately report `usedBytes + availableBytes < totalBytes`; the difference is free capacity reserved from the unprivileged service identity.

This source-only change performs no filesystem, mount, quota, reserved-block, host, systemd, Docker, or production mutation.
