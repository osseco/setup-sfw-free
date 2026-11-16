# AGENTS.md

How AI agents work in this repository. What the action does, and how to use it: [README.md](README.md). CI, versions and releases: [CONTRIBUTING.md](CONTRIBUTING.md).

## Commits

Agents never commit. The maintainer reviews and signs every commit. The one exception is `sfw-free-update.yml`: it commits sfw-free updates through the GitHub API (signed by GitHub) to a pull request the maintainer reviews before merging.

- Never run `git commit`, `git tag`, `git push`, or anything that rewrites history (`rebase`, `reset --hard`, `commit --amend`, force pushes).
- Work in reviewable chunks. At the end of each chunk, stage exactly that chunk's files with explicit paths (`git add <path>…`, never `git add -A` or `git add .`), show `git diff --cached --stat`, and propose a commit message. Staged means "commit this". Then wait until the maintainer has committed before starting the next chunk. On requested changes, edit and re-stage.
- Staging is the only git write an agent does.
- Rebuild `dist/` (`sfw pnpm build`) in the same chunk as any change under `src/`, or to `package.json`, `pnpm-lock.yaml` or `sfw-free.json`.

Messages use [Conventional Commits](https://www.conventionalcommits.org/):

```text
type(scope): imperative subject
```

- Types: `feat`, `fix`, `docs`, `refactor`, `test`, `build`, `ci`, `chore`.
- Scopes when useful: `action`, `cache`, `summary`, `sfw`, `ci`.
- The subject is lowercase imperative, with no trailing period.
- Breaking changes to inputs, outputs or behaviour use `!` or a `BREAKING CHANGE:` footer.
- Types decide the next release version (see [CONTRIBUTING.md](CONTRIBUTING.md#versions)). Pick them deliberately: `feat` bumps minor, `!` or `BREAKING CHANGE:` bumps major, everything else bumps patch.
- An sfw-free update is always `feat(sfw): update sfw-free to X.Y.Z`.

## Branches

Never change or commit directly on `main`. If the current branch is `main`, create a branch from `origin/main` and work there:

```bash
git switch --no-track -c fix/short_description origin/main
```

Name it `type/short_description`, with the same types as commits.

## Socket Firewall

Prefix every `pnpm` command that downloads packages with `sfw`:

```bash
sfw pnpm install --frozen-lockfile
sfw pnpm add <package>
sfw pnpm build
```

## Checks

Run `pre-commit run --all-files` before handing over a chunk. It runs Biome (format and lint), the tests, checks `dist/` against a fresh build, and runs zizmor, actionlint and basic file checks. `pnpm format` fixes formatting.

It needs these on PATH: `sfw`, `node` (the version in `.node-version`), `pnpm`, `zizmor`, `actionlint`, `pre-commit`.

Tests use `node --test`, live in `test/`, and must not touch the network. Logic lives in functions that take their dependencies (`core`, `cache`, `fetch`, the file system root) as arguments, so tests pass fakes instead of mocking modules. CI enforces coverage with `pnpm test:coverage`.

## Code map

- `action.yml`: inputs, outputs, `dist/main.cjs` and `dist/post.cjs`.
- `sfw-free.json`: the one sfw-free version this action installs, with the sha256 of every asset. Only `scripts/update-sfw-free.mjs` writes it, together with the version marker in `README.md`.
- `src/index.js`, `src/post-index.js`: entry points; they only call `run()`.
- `src/main.js`: `run()` resolves the asset, restores from cache or downloads, verifies, puts `sfw` on PATH.
- `src/post.js`: `run()` writes the job summary from the sfw report.
- `src/release.js`: validates the shape of `sfw-free.json`.
- `src/readme.js`: reads and sets the sfw-free version between the `README.md` markers.
- `src/platform.js`: platform, arch and libc to asset (`ASSET_NAMES`).
- `src/download.js`: download with retries, sha256.
- `src/summary.js`: report to HTML, every value escaped.
- `scripts/build.mjs`: esbuild bundle into `dist/` (CJS, no sourcemaps).
- `scripts/update-sfw-free.mjs` (`pnpm update-sfw-free X.Y.Z`): adopts a release on a new branch and stages the result. Agents may run it only when asked, and never commit what it stages.
- `.github/scripts/check-sfw-free.mjs`, `.github/scripts/open-update-pr.mjs`: used by `sfw-free-update.yml` to find a release old enough to adopt and to turn the staged update into a pull request.

## Security rules

- Never install a binary that hasn't matched the sha256 in `sfw-free.json`. That includes binaries restored from the Actions cache.
- Download only from `https://github.com/SocketDev/sfw-free/releases/download/`. No mirrors, no other hosts.
- Never take a checksum from the same place as the binary at run time.
- No new runtime dependencies without the maintainer's agreement.
- Validate every input against its allowed values; never put input values into commands or paths. Don't spawn shells.
- HTML-escape every value from the sfw report before it goes into the job summary.

## GitHub Actions

- Pin every action to a full commit SHA with a version comment, in workflows and in README examples alike.
- Start each workflow with `permissions: {}`, and grant per job only what it needs.
- Set `persist-credentials: false` on checkout.
- Pass `${{ }}` values to `run:` through `env:`, never inline.
- No `actions/cache` in jobs whose output is released; our own jobs run this action with `cache: false`.
- zizmor and actionlint must report no findings.
