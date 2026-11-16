#!/usr/bin/env node
// Pin an sfw-free release the workflow has downloaded. Run by the
// sfw-free-update workflow after `gh release download`:
//
//   GH_TOKEN=… node .github/scripts/pin-sfw-free.mjs 1.16.0 "$RUNNER_TEMP/sfw-free"
//
// 1. Refuses versions that aren't newer than the pinned one, and drafts,
//    prereleases, mutable releases and releases younger than 7 days.
// 2. Verifies every asset the action maps with `gh release verify-asset`:
//    its sha256 must be a subject of the release attestation GitHub signed.
// 3. Writes sfw-free.json and the README marker. It runs no git: the
//    workflow builds, tests, stages and opens the pull request.
import { execFile } from 'node:child_process'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { sha256File } from '../../src/download.js'
import { ASSET_NAMES } from '../../src/platform.js'
import { setReadmeVersion } from '../../src/readme.js'
import { validateRelease } from '../../src/release.js'
import { compareVersions, MIN_AGE_DAYS } from './check-sfw-free.mjs'

const REPO = 'SocketDev/sfw-free'
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))

/** Files the update changes; the only paths the workflow stages. */
export const CHANGED_PATHS = ['sfw-free.json', 'README.md', 'dist/']

/** @param {string} version */
export const branchName = (version) => `feat/update_sfw_free_${version}`

/**
 * Run a command without a shell and return its stdout.
 *
 * @param {string} cwd
 * @returns {(cmd: string, args: string[]) => Promise<{ stdout: string }>}
 */
export function makeExec(cwd) {
  const execFileAsync = promisify(execFile)
  return (cmd, args) => execFileAsync(cmd, args, { cwd })
}

/**
 * Throw unless the GitHub release may be pinned.
 *
 * @param {{ tagName: string, isDraft: boolean, isPrerelease: boolean, isImmutable: boolean, publishedAt: string }} release
 * @param {string} version
 * @param {Date} now
 */
export function checkRelease(release, version, now) {
  if (release.tagName !== `v${version}`) {
    throw new Error(`expected tag v${version}, got ${release.tagName}`)
  }
  if (release.isDraft || release.isPrerelease) {
    throw new Error(`v${version} is a draft or prerelease`)
  }
  if (!release.isImmutable) {
    throw new Error(`v${version} is not an immutable release`)
  }
  const ageDays = (now - new Date(release.publishedAt)) / 86_400_000
  if (!(ageDays >= MIN_AGE_DAYS)) {
    throw new Error(
      `v${version} was published ${release.publishedAt}, ${ageDays.toFixed(1)} days ago; wait until it is ${MIN_AGE_DAYS} days old`,
    )
  }
}

/**
 * The whole pin. Every side effect is a parameter so tests can pass fakes.
 *
 * @param {string} version
 * @param {string} dir where the release assets were downloaded
 * @param {object} [deps]
 * @param {string} [deps.root] repository root
 * @param {ReturnType<typeof makeExec>} [deps.exec]
 * @param {Date} [deps.now]
 * @param {(message: string) => void} [deps.log]
 */
export async function pin(
  version,
  dir,
  {
    root = REPO_ROOT,
    exec = makeExec(root),
    now = new Date(),
    log = console.log,
  } = {},
) {
  if (!/^\d+\.\d+\.\d+$/.test(version ?? '') || !dir) {
    throw new Error('usage: pin-sfw-free.mjs X.Y.Z DIR')
  }
  const tag = `v${version}`

  const pinnedPath = join(root, 'sfw-free.json')
  const pinned = JSON.parse(await readFile(pinnedPath, 'utf8'))
  if (compareVersions(version, pinned.version) <= 0) {
    throw new Error(`${version} is not newer than the pinned ${pinned.version}`)
  }

  const { stdout } = await exec('gh', [
    'release',
    'view',
    tag,
    '--repo',
    REPO,
    '--json',
    'tagName,isDraft,isPrerelease,isImmutable,publishedAt',
  ])
  const release = JSON.parse(stdout)
  checkRelease(release, version, now)

  const assets = {}
  for (const [key, name] of Object.entries(ASSET_NAMES)) {
    const file = join(dir, name)
    await exec('gh', ['release', 'verify-asset', tag, file, '--repo', REPO])
    const sha256 = await sha256File(file)
    log(`${name}: ${sha256} (attested)`)
    assets[key] = { name, sha256 }
  }

  const next = validateRelease({
    version,
    publishedAt: release.publishedAt,
    assets,
  })
  await writeFile(pinnedPath, `${JSON.stringify(next, null, 2)}\n`)
  const readmePath = join(root, 'README.md')
  await writeFile(
    readmePath,
    setReadmeVersion(await readFile(readmePath, 'utf8'), version),
  )
  log(`Pinned sfw-free ${version}`)
}

if (import.meta.main) {
  const [version, dir] = process.argv.slice(2)
  pin(version, dir).catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
