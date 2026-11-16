# Contributing

Conventions for commits, branches and sfw are in [AGENTS.md](AGENTS.md). This page covers setup, CI, versions, releases and sfw-free updates.

## Setup

- Node from `.node-version`, [pnpm](https://pnpm.io/) (the version in `packageManager` is used automatically), [Socket Firewall Free](https://docs.socket.dev/docs/socket-firewall-free) (`sfw`), `zizmor`, `actionlint` and [pre-commit](https://pre-commit.com/).
- `sfw pnpm install --frozen-lockfile`
- `pre-commit install`

`pnpm-workspace.yaml` refuses package versions younger than 7 days and denies dependency build scripts.

| Command              | Does                                                                                 |
| -------------------- | ------------------------------------------------------------------------------------ |
| `pnpm format`        | formats with Biome                                                                   |
| `pnpm lint`          | lints with Biome                                                                     |
| `pnpm test`          | runs the unit tests (`node --test`)                                                  |
| `pnpm test:coverage` | the tests with the coverage thresholds CI uses                                       |
| `sfw pnpm build`     | bundles `src/` into `dist/` with esbuild, and writes `dist/THIRD-PARTY-LICENSES.txt` |

## CI

| Workflow                                     | When                                 | What                                                                                                                   |
| -------------------------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------- |
| `pr.yml`                                     | every pull request                   | calculates the next version, runs `check.yml`, then `Merge gate`                                                       |
| `check.yml`                                  | called by `pr.yml` and `release.yml` | tests, `dist/` check, dependency review, CodeQL, zizmor, actionlint, and the action itself on every supported platform |
| `release.yml`                                | push to `main` touching the action   | the same checks, then publishes the release                                                                            |
| `sfw-free-update.yml`                        | weekly                               | opens a pull request when a new sfw-free release is at least 7 days old                                                |
| `codeql.yml`, `zizmor.yml`, `actionlint.yml` | also weekly                          | report findings to code scanning                                                                                       |

## Versions

Tags look like `v1.16.0-0.1.0`:

- `1.16.0` is the sfw-free version the action installs, read from `sfw-free.json`.
- `0.1.0` is the action's own version. It never resets, and it comes from the latest tag and the [Conventional Commits](https://www.conventionalcommits.org/) since then (`.github/calculate-version.sh`). Without a tag it starts at `0.0.0`.
  - `feat!:` or a `BREAKING CHANGE:` footer bumps major.
  - `feat:` bumps minor; an sfw-free update is a `feat`.
  - Anything else bumps patch.
  - Each release bumps once, by the highest-ranking commit.

The separator is `-`, not `+`: Dependabot can't parse `+`, so users pinned to a SHA would never get update PRs. Tools show these versions as prereleases; every tag is one, so they still sort correctly.

## Releases

A push to `main` that changes the action runs `release.yml`. When the version changed, the `publish` job (environment `release`):

1. Writes `SHA256SUMS` for `action.yml`, `sfw-free.json`, `LICENSE` and `dist/*` (the bundles and `THIRD-PARTY-LICENSES.txt`).
2. Attests build provenance for them.
3. Creates a draft GitHub Release for the commit with those files, then publishes it. Releases are immutable, so a broken release is fixed by the next version.

## Updating sfw-free

Every Monday, `sfw-free-update.yml` looks for a release at least 7 days old. When it finds one and no pull request for it is open, it:

1. downloads the release with `gh release download`;
2. runs `.github/scripts/pin-sfw-free.mjs`, which refuses drafts, prereleases, mutable releases and versions `main` already has, verifies every asset the action maps with `gh release verify-asset` (its sha256 must be in the release attestation GitHub signed), and writes `sfw-free.json` and the version marker in `README.md`;
3. runs `sfw pnpm install --frozen-lockfile`, `pnpm build` and `pnpm test`, and stages `sfw-free.json`, `README.md` and `dist/`;
4. creates `feat/update_sfw_free_X.Y.Z` on GitHub and commits the staged files with GraphQL `createCommitOnBranch`, so GitHub signs the commit;
5. opens the pull request `feat(sfw): update sfw-free to X.Y.Z` with a GitHub App token, so `pr.yml` runs on it.

A maintainer then reads the sfw-free release notes, checks the sha256 values, waits for the e2e jobs (they install and run the new binary on every platform), squash-merges with the pull request title, and approves the release.

### GitHub App

The workflow needs a GitHub App installed on this repository only, with **Contents: write** and **Pull requests: write**, and:

- the variable `SFW_UPDATE_APP_CLIENT_ID`: the App's client ID;
- the secret `SFW_UPDATE_APP_PRIVATE_KEY`: a private key of the App.

To check an asset yourself:

```bash
gh release verify-asset vX.Y.Z sfw-free-linux-x86_64 --repo SocketDev/sfw-free
```

`README.md` holds the sfw-free version between `<!-- sfw-free-version -->` markers; a test fails when it differs from `sfw-free.json`. The exact `uses:` line (commit SHA and tag) is written into each release's notes by `release.yml`.

## Verifying a release

```bash
gh attestation verify dist/main.cjs --repo osseco/setup-sfw-free
```

```bash
sha256sum --check SHA256SUMS
```

Renaming `release.yml` or releasing from another branch changes the signing identity.
