# Changelog

## 0.1.4 - 2026-06-03

- Added a real grid-mode `Save` action that returns an ASCII-rendered PNG artifact with scene metadata.
- Kept grid `Copy ASCII` as a separate secondary action.
- Made `Close` and `Cancel` exit cleanly for agent-driven CLI sessions.
- Silenced embedded Vite logs so command output remains machine-readable.
- Added smoke coverage for direct grid saves and CLI close/cancel paths.

## 0.1.3 - 2026-06-02

- Added agent context handoff output via `--context token|markdown|json|codex`.
- Added result metadata including SHA-256, token, Markdown, and inspect command fields.
- Added line-tool support and release smoke progress logging.
