#!/usr/bin/env node
// Weekly check for a newer sfw-free release. Prints nothing and writes no
// outputs when the pinned version is current. Otherwise writes `version`,
// `title` and `body-file` to $GITHUB_OUTPUT for the workflow to open an issue.
// A release only counts once it is MIN_AGE_DAYS old.
//
//   node .github/scripts/check-sfw-free.mjs [--now 2026-11-14T00:00:00Z]
import { appendFile, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseArgs } from 'node:util'

export const MIN_AGE_DAYS = 7
const API = 'https://api.github.com/repos/SocketDev/sfw-free/releases'

/** Compare two X.Y.Z versions; negative, zero or positive. */
export function compareVersions(a, b) {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if (pa[i] !== pb[i]) return pa[i] - pb[i]
  }
  return 0
}

/**
 * The newest release newer than `current` that is old enough, or undefined.
 *
 * @param {{ tag_name: string, draft: boolean, prerelease: boolean, published_at: string | null, html_url: string }[]} releases
 * @param {string} current pinned version
 * @param {Date} now
 */
export function newestEligible(releases, current, now) {
  const minAgeMs = MIN_AGE_DAYS * 86_400_000
  return releases
    .filter((r) => !r.draft && !r.prerelease && r.published_at)
    .map((r) => ({ ...r, version: r.tag_name.replace(/^v/, '') }))
    .filter((r) => /^\d+\.\d+\.\d+$/.test(r.version))
    .filter((r) => compareVersions(r.version, current) > 0)
    .filter((r) => now - new Date(r.published_at) >= minAgeMs)
    .sort((a, b) => compareVersions(b.version, a.version))[0]
}

/** Issue text for a release the maintainer should adopt. */
export function issueBody(release, current, now) {
  const ageDays = Math.floor(
    (now - new Date(release.published_at)) / 86_400_000,
  )
  return `sfw-free [v${release.version}](${release.html_url}) was published ${release.published_at} (${ageDays} days ago). This action pins v${current}.

- [ ] Read the [release notes](${release.html_url}).
- [ ] From a clean checkout: \`pnpm update-sfw-free ${release.version}\`. It creates \`feat/update_sfw_free_${release.version}\` and stages the changes.
- [ ] Review the staged changes, commit them signed as \`feat(sfw): update sfw-free to ${release.version}\`, push, and open a pull request; the e2e jobs must pass on every platform.
- [ ] Merge, approve the \`release\` environment, and close this issue.

Opened by the weekly \`sfw-free-update\` workflow. See CONTRIBUTING.md, "Updating sfw-free".
`
}

async function main() {
  const { values } = parseArgs({ options: { now: { type: 'string' } } })
  const now = values.now ? new Date(values.now) : new Date()
  if (Number.isNaN(now.getTime())) {
    throw new Error(`invalid --now ${values.now}`)
  }
  const pinned = JSON.parse(
    await readFile(new URL('../../sfw-free.json', import.meta.url), 'utf8'),
  )

  const headers = { accept: 'application/vnd.github+json' }
  if (process.env.GITHUB_TOKEN) {
    headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  }
  const response = await fetch(`${API}?per_page=30`, { headers })
  if (!response.ok) {
    throw new Error(`GitHub API: HTTP ${response.status}`)
  }
  const release = newestEligible(await response.json(), pinned.version, now)
  if (!release) {
    console.log(`sfw-free ${pinned.version} is current`)
    return
  }

  const title = `Update sfw-free to v${release.version}`
  console.log(title)
  if (process.env.GITHUB_OUTPUT) {
    const bodyFile = join(
      process.env.RUNNER_TEMP ?? tmpdir(),
      'sfw-free-issue.md',
    )
    await writeFile(bodyFile, issueBody(release, pinned.version, now))
    await appendFile(
      process.env.GITHUB_OUTPUT,
      `version=${release.version}\ntitle=${title}\nbody-file=${bodyFile}\n`,
    )
  }
}

if (import.meta.main) {
  main().catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
