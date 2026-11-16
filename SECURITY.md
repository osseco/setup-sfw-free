# Security policy

## Reporting a vulnerability

Report vulnerabilities privately through GitHub: **Security → Report a vulnerability** on [osseco/setup-sfw-free](https://github.com/osseco/setup-sfw-free/security/advisories/new). Don't open a public issue.

Include the action version, the runner OS and architecture, what you did, and what happened. You'll get a reply within a week.

Vulnerabilities in sfw-free itself go to [Socket](https://github.com/SocketDev/sfw-free).

## Supported versions

Only the latest release gets fixes. Releases are immutable, so a fix always ships as a new version.

## How the binary is trusted

- `sfw-free.json` pins one sfw-free version and the sha256 of every asset the action can install.
- The update workflow pins a release with `.github/scripts/pin-sfw-free.mjs`. It refuses drafts, prereleases, mutable releases and releases younger than 7 days, and pins an asset's sha256 only when `gh release verify-asset` finds it in the release attestation GitHub signed for that immutable release.
- At run time the action downloads only from `https://github.com/SocketDev/sfw-free/releases/download/`, over https, with no mirrors. A redirect to plain http is refused.
- The download is hashed while it is written. Nothing is made executable or put on `PATH` until the hash matches the pinned one. On a mismatch the file is deleted and the step fails.
- The Actions cache is treated as untrusted transport. Any workflow on the default branch can write entries, so a restored binary is hashed again and discarded on a mismatch. Only exact cache keys count: the key holds the full sha256, and a prefix match on another key is ignored.
- Checksums are never read from the place the binary comes from.

## How sfw-free updates are adopted

- A weekly workflow opens a pull request when a newer sfw-free release is at least 7 days old. Its job token is read-only; a GitHub App token limited to this repository (contents and pull requests) creates the branch, the commit (through the API, signed by GitHub) and the pull request. It cannot merge.
- A maintainer reads the release notes and reviews the pull request. The end-to-end jobs install and run the new binary on every supported platform before it can merge.

## Dependencies

- Two runtime dependencies, `@actions/core` and `@actions/cache`, bundled into `dist/` with esbuild. A new runtime dependency needs a maintainer's agreement.
- `dist/` must match a fresh build; CI fails otherwise and attaches the expected `dist/`.
- pnpm refuses package versions younger than 7 days (`minimumReleaseAge`), denies dependency build scripts (`strictDepBuilds`, `allowBuilds`), and installs from the frozen lockfile. The pnpm version is pinned by integrity hash in `package.json`.
- Installs in CI and on maintainers' machines run behind sfw.
- Production dependency licenses are checked against an allowlist in CI.
- Dependabot updates npm packages and actions weekly, with a 7-day cooldown.

## Workflows

- Every workflow starts with `permissions: {}`; each job asks only for what it needs.
- Actions are pinned to full commit SHAs. Our own workflows and action are referenced with `$/` (the workflow's own commit).
- `actions/checkout` runs with `persist-credentials: false`.
- `${{ }}` values reach `run:` steps through `env:`, never inline.
- zizmor and actionlint must report no findings; CodeQL analyses the JavaScript and the workflows; dependency review runs on every pull request.
- Jobs that build or release the action don't use the Actions cache.

## Releases

- Releases run from `main` only, in the protected `release` environment with required reviewers.
- Releases are immutable: a published tag and its assets can't be changed.
- Each release carries `SHA256SUMS` for `action.yml`, `sfw-free.json`, `main.cjs`, `post.cjs`, `THIRD-PARTY-LICENSES.txt` and `LICENSE`, with a build provenance attestation.
- Use the action by full commit SHA.

## The action itself

- Inputs are checked against their allowed values; anything else fails the step. Input values never reach a command or a path.
- The action spawns no shell. (`@actions/cache` runs `tar` directly.)
- Values from the sfw report are HTML-escaped before they go into the job summary.

## Verifying a release

```bash
gh attestation verify main.cjs --repo osseco/setup-sfw-free
```

```bash
sha256sum --check SHA256SUMS
```

The files in `dist/` at the release's commit hash to the same values as the release assets `main.cjs` and `post.cjs`.
