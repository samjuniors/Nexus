# Nexus offline database backup and recovery gate

Adapted from the disaster-recovery practices documented and implemented in SamjuniorsOS. This is intentionally a **small offline-only Nexus adaptation**, not a verbatim port of SamjuniorsOS's file-store format.

## Important safety boundary

- **Shut down Nexus and all other SQLite writers first.** Checkpoint/close the database from the owning application using your tested SQLite tools. This script cannot prove the database was stopped; the explicit `--ack-offline` flag is a required operator assertion, not a technical lock.
- A `-wal`, `-shm` or `-journal` sidecar next to the source refuses the backup. Do not delete sidecars to work around the check; checkpoint and stop the application correctly.
- Pass the exact **source .sqlite file** and a **private backup directory**. The script will not guess the Prisma DATABASE_URL location or look for real user data in a repository.
- The script rejects symlinked source files, invalid SQLite headers, source size/timestamp changes during copying, and mismatched SHA-256 checksums. It creates a timestamped backup with a manifest, and supports read-only checksum verification.
- Real SQLite integrity (`PRAGMA integrity_check`), point-in-time backup semantics, complete file-store recovery and a tested staging restore **remain unverified**. This script is not an online snapshot strategy. There is intentionally no destructive restore command.

## Commands (run only on your authorized computer)

After locating the actual database path and stopping the application:

```bash
npm run db:backup:offline -- --db "/explicit/path/to/nexus.sqlite" --out "/private/offline-backups" --ack-offline
```

The command returns a manifest path. Verify it read-only:

```bash
npm run db:backup:verify -- --manifest "/private/offline-backups/nexus-offline-EXAMPLE.sqlite.manifest.json"
```

Test with **synthetic disposable fixtures** (safe to run without user data):

```bash
npm run test:recovery
```

Never commit `.sqlite` backups, manifest files containing sensitive data, private `.env` files, or production credentials. The repository ignores the default `backups/` directory and typical local Prisma sidecars, but use a private external backup location for real data.

## Required acceptance before allowing automatic backups

1. Validate DB location for local Prisma/SQLite and packaged desktop profiles. Confirm consistency with the actual WAL mode.
2. Test against a disposable *real* populated SQLite DB, including interrupted copy, changed source, file permissions, corruption, WAL and recovery.
3. Restore into an isolated environment using a separately reviewed restore procedure and validate row counts, integrity checks, application startup, brain memory and graph provenance.
4. Decide whether proper live backup through the SQLite backup API should replace this offline utility. Never label a plain file copy as online-consistent.
5. Keep read/write migration operations explicitly approved, atomic when possible, and separate from the Nexus portable brain + future Nerve Core integration.
