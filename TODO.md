# TODO

Manual steps for a maintainer. Check them off as they're done.

## Repository settings

Needed before the workflows work as intended:

- [ ] Create the GitHub repository `osseco/setup-sfw-free` (public) and push `main`.
- [ ] **Releases → Immutable releases**: on.
- [ ] **Security → Private vulnerability reporting**: on (`SECURITY.md` points there).
- [ ] **Security → Dependabot alerts** and **Dependabot security updates**: on.
- [ ] **Security → Code scanning**: on, so CodeQL, zizmor and actionlint results show up.
- [ ] **Environments**: create `release`, limit deployment branches to `main`, add required reviewers.
- [ ] **Ruleset for `main`**: require pull requests and the `Merge gate` status check; block force pushes and deletion; require signed commits.
- [ ] **Ruleset for tags `v*`**: block updates and deletion.
- [ ] **Actions → General**:
  - [ ] Workflow permissions: read-only default token.
  - [ ] Don't allow GitHub Actions to create or approve pull requests.
  - [ ] Require actions to be pinned to a full-length commit SHA.
- [ ] Set the owner in `.github/CODEOWNERS`, then require Code Owner review in the `main` ruleset.

## Open decisions

- [x] License for this repository: MIT, `Copyright (c) 2026 osseco contributors`. Bundled dependency licenses are in `dist/THIRD-PARTY-LICENSES.txt`.
- [ ] Publish to the GitHub Marketplace (`action.yml` has branding).

## First release

- [ ] Open a pull request (or push the branch) and check that every job in `check.yml` passes, in particular:
  - [ ] the e2e jobs on all six platforms, including the `node:24-alpine` container;
  - [ ] `Action restores from cache` reports `cache-hit: true`;
  - [ ] the e2e job summaries show the "No packages were blocked" summary (`job-summary: all`).
- [ ] Merge to `main`, approve the `release` environment, and check release `v1.15.6-0.1.0` (the history already has `feat` commits, so the action part starts at `0.1.0`).
- [ ] Verify it: `gh attestation verify main.cjs --repo osseco/setup-sfw-free` and `sha256sum --check SHA256SUMS`.
- [ ] The release notes start with the `uses: osseco/setup-sfw-free@<sha> # v1.15.6-0.1.0` line, and that SHA is the release commit.

## Dry run of the update process (to sfw-free 1.16.0)

- [ ] Set up the GitHub App (CONTRIBUTING.md, "GitHub App").
- [ ] Run `sfw-free update` from the Actions tab; the log shows 8 assets verified against the release attestation, and it opens `feat(sfw): update sfw-free to 1.16.0` with a Verified commit.
- [ ] Run it again; no second pull request is opened.
- [ ] Check the sha256 values against the release, e2e jobs green.
- [ ] Squash-merge; confirm release `v1.16.0-0.2.0`.

## Follow-ups to check

- [ ] Dependabot opens pull requests against `pnpm-lock.yaml` (pnpm 12 lockfile) after its first weekly run.
