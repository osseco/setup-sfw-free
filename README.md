# setup-sfw-free

A GitHub Action that installs [Socket Firewall Free](https://github.com/SocketDev/sfw-free) (`sfw`) and nothing else. Run your package manager through it (`sfw npm ci`, `sfw pnpm install`, `sfw pip install`, `sfw cargo fetch`) and it blocks malicious packages before they reach the runner.

This version of the action installs sfw-free <!-- sfw-free-version -->1.15.6<!-- /sfw-free-version -->.

- Each action version installs exactly one sfw-free version. Its sha256 for every platform is pinned in [`sfw-free.json`](sfw-free.json), and the binary is checked against it before it is used.
- Downloads come only from the sfw-free GitHub releases.
- The binary can be kept in your repository's Actions cache. A cached binary is checked against the pinned sha256 too.
- A post step writes what sfw blocked to the job summary.
- No token, no secrets, no shell commands.

## Usage

```yaml
permissions:
  contents: read

jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
        with:
          persist-credentials: false
      - uses: osseco/setup-sfw-free@<commit sha> # <release tag>
      - run: sfw npm ci
```

Copy the exact `uses:` line, with the commit SHA and tag, from the notes of the [latest release](https://github.com/osseco/setup-sfw-free/releases/latest). Pin by full commit SHA with the version as a comment, as above; Dependabot and Renovate update both.

## Versions

Versions look like `v1.15.6-0.1.0`: the sfw-free version, then this action's own version. The action's part follows semver and never resets, so `0.1.0` → `0.2.0` can mean a new sfw-free version or a new feature here, and a major bump means a breaking change to inputs or outputs.

New sfw-free releases are adopted by a maintainer once they are at least 7 days old.

## Inputs

All inputs are optional.

| Input         | Default  | Description                                                                                                                                                                            |
| ------------- | -------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `cache`       | `true`   | Keep the sfw binary in the repository's Actions cache, so later jobs don't download it. `true`: restore, and save after a download. `restore`: restore only. `false`: always download. |
| `job-summary` | `errors` | `errors`: summary only when sfw blocked a package or couldn't parse a request. `all`: a summary also when nothing was blocked. `none`: no summary, and sfw isn't asked for a report.   |

Any other value fails the step.

To save the cache only on `main`, and let branches and pull requests restore it:

```yaml
- uses: osseco/setup-sfw-free@<commit sha> # <release tag>
  with:
    cache: ${{ github.ref == 'refs/heads/main' && 'true' || 'restore' }}
```

## Outputs

| Output        | Description                                                         |
| ------------- | ------------------------------------------------------------------- |
| `version`     | Installed sfw-free version, for example `1.15.6`.                   |
| `path`        | Absolute path to the `sfw` binary.                                  |
| `cache-hit`   | `true` when the binary came from the Actions cache.                 |
| `report-path` | Path of the JSON report sfw writes; empty when `job-summary: none`. |

## Secrets and permissions

None. The action downloads public release assets and uses the Actions cache through the runner's own credentials. It works with `permissions: {}`.

## Environment variables

- Adds the directory holding `sfw` (or `sfw.exe`) to `PATH`.
- Sets `SFW_JSON_REPORT_PATH` for later steps, unless `job-summary` is `none`. sfw writes its report there.
- Reads `RUNNER_TEMP`.

## Platforms

Linux x64 and arm64 (glibc and musl), macOS x64 and arm64, Windows x64 and arm64. Alpine containers need `libstdc++` and `libgcc`:

```yaml
container: node:24-alpine
steps:
  - run: apk add --no-cache libstdc++ libgcc
  - uses: osseco/setup-sfw-free@<commit sha> # <release tag>
```

## Limitations

- **Prefix commands with `sfw`.** The action doesn't install shims, so a plain `npm install` is not protected.
- **The summary shows the last `sfw` call.** sfw rewrites its report on every run. A block fails its step, and later steps don't run, so the block is normally what you see. With `continue-on-error` a later `sfw` call can replace it.
- **The cache is per repository and branch scope**, like any Actions cache. Branches and pull requests can restore entries saved on the default branch, which is what `cache: restore` relies on. A restored binary that doesn't match the pinned sha256 is discarded with a warning and downloaded again.

## Security

See [SECURITY.md](SECURITY.md) for how to report a vulnerability, how this action is built and released, and how to verify a release.

## License

This action is [MIT licensed](LICENSE). The dependencies bundled into `dist/` keep their own licenses; their texts are in [`dist/THIRD-PARTY-LICENSES.txt`](dist/THIRD-PARTY-LICENSES.txt).

sfw-free is provided by Socket under [its own license](https://github.com/SocketDev/sfw-free#license). This action doesn't redistribute it; it downloads the binary from Socket's releases at run time.
