# Isolated PetsChoice reporting
Google UA and Meta UA/PL collection run directly in a dedicated Docker container, with a private Docker network and no published host ports. The container runs as UID10000 without Linux capabilities, with a read-only root and read-only reporting-data mount. Runtime image is pinned by digest on Hetzner.
Existing server runners retain schedules, formatting, destination validation and SQLite delivery deduplication. Their source URLs and authentication are switched to the independent reporting service only after live source checks.
## Release path
1. Update reporting-service source and regenerate bundle.json (canonical file list and hashes). Run isolated tests and bundle checks.
2. Merge a reviewed approved.json pointer containing the immutable bundle commit, exact SHA256 and release ID. GitHub runs reporting checks on reporting changes.
3. The Hetzner update timer polls the approved pointer every15minutes. It validates all hashes, starts an isolated candidate, verifies fresh Google and both Meta accounts and Telegram destination access.
4. Only then switch the current release and restart the reporting container. Verify fresh sources, send one deduplicated delivery canary to each existing report group, and verify the actual report runners.
5. On any failed candidate or post-release check, stop activation or restore the previous release and send a deduplicated failure notice. The original report ledger is never reset.
The updater core and pinned container runtime are maintained separately from ordinary collector releases. A future updater/runtime change requires a separate checked administrative update.
## Monitoring
Existing source watchdog remains active, with notifications added for failure and recovery. Main delivery remains14:00 Europe/Warsaw; weekly and monthly period rules remain unchanged.
If Telegram itself is unavailable, an alert cannot be guaranteed. Ambiguous delivery is recorded without automatic resend. External API failures may still occur; stale values and synthetic zeros remain prohibited.
## Migration
An authenticated and time-limited ECDH/AES-GCM transfer was used to move only reporting credentials to the server-generated recipient key. Plaintext values were not printed or committed. The temporary Worker migration path is removed in the activation release. Shared gateway report routes stay as an unchanged fallback; scheduled delivery uses the new container after acceptance.

