#!/usr/bin/env node
// Pin an sfw-free release in sfw-free.json. Run by a maintainer:
//
//   node scripts/update-sfw-free.mjs 1.16.0
//
// Refuses drafts, prereleases and releases younger than 7 days. Downloads
// every asset the action maps and requires the local sha256 to equal the
// digest GitHub reports for it: two independent sources must agree before a
// hash is pinned. Set GITHUB_TOKEN to avoid API rate limits.
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { assetUrl, downloadFile } from '../src/download.js'
import { ASSET_NAMES } from '../src/platform.js'
import { validateRelease } from '../src/release.js'

export const MIN_AGE_DAYS = 7
const API = 'https://api.github.com/repos/SocketDev/sfw-free/releases/tags'
const OUTPUT = new URL('../sfw-free.json', import.meta.url)

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

async function main(version) {
  if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) {
    throw new Error('usage: node scripts/update-sfw-free.mjs X.Y.Z')
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
  checkRelease(release, version, new Date())
  const digests = expectedDigests(release)

  const dir = await mkdtemp(join(tmpdir(), 'sfw-free-'))
  const assets = {}
  try {
    for (const [key, { name, digest }] of Object.entries(digests)) {
      process.stdout.write(`${name}: `)
      const actual = await downloadFile(
        assetUrl(version, name),
        join(dir, name),
        { warn: (message) => process.stderr.write(`\n${message}\n`) },
      )
      if (actual !== digest) {
        throw new Error(
          `${name}: downloaded sha256 ${actual} differs from GitHub's ${digest}`,
        )
      }
      process.stdout.write(`${actual}\n`)
      assets[key] = { name, sha256: actual }
      await rm(join(dir, name), { force: true })
    }
  } finally {
    await rm(dir, { recursive: true, force: true })
  }

  const pinned = validateRelease({
    version,
    publishedAt: release.published_at,
    assets,
  })
  await writeFile(OUTPUT, `${JSON.stringify(pinned, null, 2)}\n`)
  console.log(
    `Pinned sfw-free ${version} in sfw-free.json. Next: sfw pnpm build, then commit "feat(sfw): update sfw-free to ${version}".`,
  )
}

if (import.meta.main) {
  main(process.argv[2]).catch((error) => {
    console.error(error.message)
    process.exit(1)
  })
}
