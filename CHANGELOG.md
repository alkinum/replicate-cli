# Changelog

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
