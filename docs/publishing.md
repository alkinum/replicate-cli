# Publishing to npm

The repository uses GitHub Actions and npm Trusted Publishing (OIDC). The publish job requests a short-lived identity from GitHub; no `NPM_TOKEN` or `NODE_AUTH_TOKEN` secret is needed.

## One-time npm setup

The initial public version, `@alkinum/replicate-cli@0.1.1`, was published interactively on 2026-09-09 from the tested [GitHub release](https://github.com/alkinum/replicate-cli/releases/tag/v0.1.1) tarball. The package now exists on npm and can have a trusted publisher configured.

Open the package's [**Settings → Trusted publishing**](https://www.npmjs.com/package/@alkinum/replicate-cli/access), add **GitHub Actions**, and enter these exact values:

| npm field | Value |
| --- | --- |
| Organization or user | `alkinum` |
| Repository | `replicate-cli` |
| Workflow filename | `publish.yml` |
| Environment name | Leave empty; this workflow does not use a GitHub environment |
| Allowed actions | Enable direct publishing with **`npm publish`** |

New trusted publisher configurations allow `npm stage publish` by default. This workflow publishes directly, so enable `npm publish` as well. Binding an existing package and allowing the workflow requires a package administrator on npm; GitHub repository access alone does not grant npm package access.

After a successful OIDC publication, npm's publishing access can be set to **Require two-factor authentication and disallow tokens**. OIDC publishing continues to work with that setting.

## Continuous integration

[ci.yml](../.github/workflows/ci.yml) runs on pushes to `main`, pull requests, and manual dispatch. It installs the frozen pnpm lockfile and checks lint, types, tests, the production build, and peer dependencies on Node.js 22, 24, and 26.

## Release workflow

[publish.yml](../.github/workflows/publish.yml) runs when a stable GitHub Release is published. It also supports manual dispatch from `main` for an existing tag. The job:

1. Checks out the release tag and verifies it matches `package.json` and belongs to `main` history.
2. Uses a GitHub-hosted Ubuntu runner, Node.js 24, the pnpm version pinned in `package.json`, and the latest npm CLI with OIDC support.
3. Installs with the frozen lockfile, runs the release checks, and builds without dependency caches.
4. Packs the build and installs that tarball in isolation using production dependencies only.
5. Checks the installed CLI version and bundled skill, then uploads the tarball as a workflow artifact.
6. Publishes that same tarball to npm using OIDC. npm automatically adds provenance for this public repository and package.

To release a new version, update `package.json`, the changelog, and release examples; commit and push the changes; create a matching `vX.Y.Z` tag; and publish its GitHub Release. CLI version output follows `package.json` automatically. Prereleases are not published by this workflow.

## Manual run and validation

Run the whole pipeline without publishing:

```bash
gh workflow run publish.yml --ref main -f tag=v0.1.1 -f dry_run=true
```

After the npm trusted publisher is configured, publish an existing, unpublished version by changing `dry_run` to `false`:

```bash
gh workflow run publish.yml --ref main -f tag=vX.Y.Z -f dry_run=false
```

v0.1.1 predates the workflow, so publishing that GitHub Release again will not run the new workflow from its old tag. Manual dispatch loads the workflow from `main` and builds the requested tag. v0.1.1 is already on npm; use a new version to verify an actual OIDC publication, since npm does not allow republishing the same name and version.

A successful dry run verifies packaging and build behavior. It does not verify the npm trust binding; npm performs that exchange only during a live publication. `npm whoami` also does not test OIDC authentication.

See npm's [Trusted Publishing documentation](https://docs.npmjs.com/trusted-publishers) for supported runners, permissions, and setup requirements.
