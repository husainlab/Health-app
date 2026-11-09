# Claude Instructions

Please follow all instructions, architecture specifications, commands, and rules in [AGENTS.md](./AGENTS.md).

For upstream open-source synchronization:
- If asked to update according to new open source commit: run `pnpm upstream:sync` (or `pnpm upstream:sync <sha>`).
- If asked to ignore an upstream commit: run `pnpm upstream:ignore <sha>`.
- The baseline is managed in `src/upstream.json` and automatically synchronized by CI during APK release builds.
