#!/usr/bin/env node
// Adopt a new sfw-free release. Run by a maintainer from a clean checkout:
//
//   pnpm update-sfw-free 1.16.0
//   pnpm update-sfw-free 1.16.0 --dry-run
//
// 1. Refuses drafts, prereleases, releases younger than 7 days, and versions
//    that aren't newer than the pinned one.
// 2. Creates feat/update_sfw_free_X.Y.Z from origin/main.
// 3. Downloads every asset the action maps and requires the local sha256 to
//    equal the digest GitHub reports: two independent sources must agree
//    before a hash is pinned.
// 4. Writes sfw-free.json and the README marker, installs, builds, tests.
// 5. Stages the changes. It never commits or pushes: the maintainer reviews
//    and signs the commit.
//
// --dry-run does the checks and downloads only: no git, no writes.
// Set GITHUB_TOKEN to avoid API rate limits. macOS and Linux (and WSL).
import { execFile, spawn } from 'node:child_process'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseArgs, promisify } from 'node:util'
import { compareVersions } from '../.github/scripts/check-sfw-free.mjs'
import { assetUrl, downloadFile } from '../src/download.js'
import { ASSET_NAMES } from '../src/platform.js'
import { setReadmeVersion } from '../src/readme.js'
import { validateRelease } from '../src/release.js'

export const MIN_AGE_DAYS = 7
const API = 'https://api.github.com/repos/SocketDev/sfw-free/releases/tags'
const REPO_ROOT = fileURLToPath(new URL('..', import.meta.url))

/** Files the update changes; the only paths it stages. */
export const CHANGED_PATHS = ['sfw-free.json', 'README.md', 'dist/']

/** @param {string} version */
export const branchName = (version) => `feat/update_sfw_free_${version}`

/**
 * Throw unless the GitHub release may be pinned.
 *
 * @param {{ tag_name: string, draft: boolean, prerelease: boolean, published_at: string }} release
 * @param {string} version
 * @param {Date} now
 */
export function checkRelease(release, version, now) {
  if (release.tag_name !== `v${version}`) {
    throw new Error(`expected tag v${version}, got ${release.tag_name}`)
  }
  if (release.draft || release.prerelease) {
    throw new Error(`v${version} is a draft or prerelease`)
  }
  const ageDays = (now - new Date(release.published_at)) / 86_400_000
  if (!(ageDays >= MIN_AGE_DAYS)) {
    throw new Error(
      `v${version} was published ${release.published_at}, ${ageDays.toFixed(1)} days ago; wait until it is ${MIN_AGE_DAYS} days old`,
    )
  }
}

/**
 * GitHub's sha256 digest for each asset the action maps.
 *
 * @param {{ assets: { name: string, digest?: string }[] }} release
 * @returns {Record<string, { name: string, digest: string }>}
 */
export function expectedDigests(release) {
  const result = {}
  for (const [key, name] of Object.entries(ASSET_NAMES)) {
    const asset = release.assets.find((a) => a.name === name)
    if (!asset) {
      throw new Error(`release has no asset ${name}`)
    }
    const match = /^sha256:([0-9a-f]{64})$/.exec(asset.digest ?? '')
    if (!match) {
      throw new Error(`GitHub reports no sha256 digest for ${name}`)
    }
    result[key] = { name, digest: match[1] }
  }
  return result
}

/**
 * Run a command without a shell. With `capture`, return its stdout;
 * otherwise let it print to the terminal. With `check: false`, a non-zero
 * exit is returned instead of thrown.
 *
 * @param {string} cwd
 * @returns {(cmd: string, args: string[], options?: { capture?: boolean, check?: boolean }) => Promise<{ code: number, stdout: string }>}
 */
export function makeExec(cwd) {
  const execFileAsync = promisify(execFile)
  return async (cmd, args, { capture = false, check = true } = {}) => {
    if (capture) {
      try {
        const { stdout } = await execFileAsync(cmd, args, { cwd })
        return { code: 0, stdout }
      } catch (error) {
        if (check || typeof error.code !== 'number') throw error
        return { code: error.code, stdout: error.stdout ?? '' }
      }
    }
    const code = await new Promise((resolve, reject) => {
      spawn(cmd, args, { cwd, stdio: 'inherit' })
        .on('error', reject)
        .on('close', resolve)
    })
    if (check && code !== 0) {
      throw new Error(`${cmd} ${args.join(' ')} exited with ${code}`)
    }
    return { code, stdout: '' }
  }
}

/**
 * Download every asset and require its sha256 to equal GitHub's digest.
 *
 * @returns {Promise<Record<string, { name: string, sha256: string }>>}
 */
async function verifiedAssets(version, digests, download, log) {
  const dir = await mkdtemp(join(tmpdir(), 'sfw-free-'))
  const assets = {}
  try {
    for (const [key, { name, digest }] of Object.entries(digests)) {
      const dest = join(dir, name)
      const actual = await download(assetUrl(version, name), dest)
      if (actual !== digest) {
        throw new Error(
          `${name}: downloaded sha256 ${actual} differs from GitHub's ${digest}`,
        )
      }
      log(`${name}: ${actual}`)
      assets[key] = { name, sha256: actual }
      await rm(dest, { force: true })
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
  return assets
}

/**
 * The whole update. Every side effect is a parameter so tests can pass fakes.
 *
 * @param {string} version
 * @param {object} [deps]
 * @param {boolean} [deps.dryRun]
 * @param {string} [deps.root] repository root
 * @param {ReturnType<typeof makeExec>} [deps.exec]
 * @param {typeof fetch} [deps.fetch]
 * @param {(url: string, dest: string) => Promise<string>} [deps.download]
 * @param {Date} [deps.now]
 * @param {(message: string) => void} [deps.log]
 */
export async function update(
  version,
  {
    dryRun = false,
    root = REPO_ROOT,
    exec = makeExec(root),
    fetch = globalThis.fetch,
    download = (url, dest) => downloadFile(url, dest),
    now = new Date(),
    log = console.log,
  } = {},
) {
  if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) {
    throw new Error('usage: pnpm update-sfw-free X.Y.Z [--dry-run]')
  }
  const branch = branchName(version)

  if (!dryRun) {
    const { stdout } = await exec('git', ['status', '--porcelain'], {
      capture: true,
    })
    if (stdout.trim() !== '') {
      throw new Error('the working tree has changes; commit or stash them')
    }
    await exec('sfw', ['--help'], { capture: true }).catch(() => {
      throw new Error('sfw is not on PATH; it is needed for pnpm install')
    })
    await exec('git', ['fetch', 'origin', 'main', '--tags'])
    const existing = await exec(
      'git',
      ['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`],
      { capture: true, check: false },
    )
    if (existing.code === 0) {
      throw new Error(`branch ${branch} already exists`)
    }
  }

  // The branch starts from origin/main, so compare against what main pins.
  const pinnedPath = join(root, 'sfw-free.json')
  const pinned = JSON.parse(
    dryRun
      ? await readFile(pinnedPath, 'utf8')
      : (
          await exec('git', ['show', 'origin/main:sfw-free.json'], {
            capture: true,
          })
        ).stdout,
  )
  if (compareVersions(version, pinned.version) <= 0) {
    throw new Error(`${version} is not newer than the pinned ${pinned.version}`)
  }

  const headers = { accept: 'application/vnd.github+json' }
  if (process.env.GITHUB_TOKEN) {
    headers.authorization = `Bearer ${process.env.GITHUB_TOKEN}`
  }
  const response = await fetch(`${API}/v${version}`, { headers })
  if (!response.ok) {
    throw new Error(`GitHub API: HTTP ${response.status} for v${version}`)
  }
  const release = await response.json()
  checkRelease(release, version, now)
  const digests = expectedDigests(release)

  if (dryRun) {
    await verifiedAssets(version, digests, download, log)
    log(`Dry run: sfw-free ${version} verifies; nothing was changed.`)
    return
  }

  await exec('git', ['switch', '--no-track', '-c', branch, 'origin/main'])
  try {
    const assets = await verifiedAssets(version, digests, download, log)
    const next = validateRelease({
      version,
      publishedAt: release.published_at,
      assets,
    })
    await writeFile(pinnedPath, `${JSON.stringify(next, null, 2)}\n`)

    const readmePath = join(root, 'README.md')
    await writeFile(
      readmePath,
      setReadmeVersion(await readFile(readmePath, 'utf8'), version),
    )

    await exec('sfw', ['pnpm', 'install', '--frozen-lockfile'])
    await exec('pnpm', ['build'])
    await exec('pnpm', ['test'])
    await exec('git', ['add', '--', ...CHANGED_PATHS])
    await exec('git', ['diff', '--cached', '--stat'])
  } catch (error) {
    log(
      `\nStopped on branch ${branch}. Fix the problem and rerun the remaining steps by hand, or go back with:\n  git switch - && git branch -D ${branch}`,
    )
    throw error
  }

  log(`
sfw-free ${version} is staged on ${branch}. Next:
  1. Review: git diff --cached
  2. Commit (signed): git commit -S -m "feat(sfw): update sfw-free to ${version}"
  3. Push and open a pull request: git push -u origin ${branch}`)
}

if (import.meta.main) {
  const { values, positionals } = parseArgs({
    allowPositionals: true,
    options: { 'dry-run': { type: 'boolean', default: false } },
  })
  update(positionals[0], { dryRun: values['dry-run'] }).catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
