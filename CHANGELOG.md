# Changelog

## 0.2.0 — 2026-11-11

### Added

- Accept a positional token in `auth set`, alongside `--token` and the hidden interactive prompt.
- Verify tokens with the account API before saving and when checking authentication status; provide `--no-verify` and `--offline` for offline use.

### Changed

- Show readable authentication, account, and diagnostic output while preserving structured `--json` output.
- Explain environment token precedence, reject missing tokens in non-interactive setup, and leave saved credentials unchanged when verification fails.
- Return a nonzero diagnostic exit code for missing or failed authentication and distinguish API reachability from token validity.
- Update compatible dependencies, retaining TypeScript 6.x for ESLint compatibility and tsup 8.x for the supported Node.js minimum.
- Refresh transitive dependencies and override minimatch to its patched release.
- Extend readable output to discovery, schemas, models, versions, predictions, trainings, deployments, files, request previews, and skill installation, including empty results, pagination hints, and narrow terminal layouts.

### Fixed

- Print prediction output and model README content directly, confirm successful empty-body deletions, and explain how to continue pending predictions.
- Reject conflicting prediction targets, sync/async flags, invalid webhook settings, malformed resource references, invalid dates, and overflowing durations before input uploads or API requests.
- Validate required creation fields, deployment scaling, empty updates, JSON files, and file metadata; preserve explicit empty strings when clearing model metadata.
- Include literal query parameters in raw API previews and reject invalid HTTP methods, conflicting body sources, malformed JSON, and GET/HEAD request bodies.
- Return job failure exit codes during creation, report unavailable output, validate upload download URLs, and classify connection/download failures consistently.
- Validate official-model schemas correctly when the model is passed through `--version`.
- Reject overflowing polling intervals, invalid schema targets and file specifications before uploads, and empty or reserved profile names before clearing credentials.
- Preserve credential precedence for explicitly empty token flags, neutralize terminal control characters in errors, and route verbose diagnostics to stderr.

## 0.1.1 — 2026-09-09

### Fixed

- Restrict authenticated API requests to the configured origin and avoid forwarding API tokens to external download hosts.
- Reject prototype-polluting input keys, preserve nested input fields across overrides, and handle nested file inputs consistently in dry runs and live requests.
- Keep artifact filenames inside the output directory, redact secrets in errors and manifests, and write token configuration atomically with private permissions.
- Honor explicit overall prediction and training wait timeouts, including when an HTTP request consumes the remaining wait budget.
- Emit JSON error envelopes for invalid command arguments and support the documented `predictions create --async` option.
- Reject non-nullable schema inputs, resolve repeated sibling schema references, stop pagination cycles, and handle empty or malformed JSON HTTP responses.
- Replace the unsupported `pnpm link --global` command with `pnpm add --global .`.
- Derive CLI version output and metadata from the package version.

### Changed

- Update dependencies to current stable releases, retaining TypeScript 6.0.3 and pnpm 12.3.4.
- Override esbuild to a patched release and align the Node.js requirement with runtime dependencies: Node.js 22.13+ on the 22.x line, or 24+.
- Refresh the README with a banner, workflow examples, file handling details, and automation guidance.

### Validation

- 64 regression tests, lint, type checking, and production build.
- Package installation with production dependencies only and local HTTP integration checks.
- No known dependency vulnerabilities or peer dependency conflicts at release preparation.
