import { chmod, mkdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import * as actionsCache from '@actions/cache'
import * as actionsCore from '@actions/core'
import pinned from '../sfw-free.json' with { type: 'json' }
import { assetUrl, downloadFile, sha256File } from './download.js'
import { binaryName, isMusl, platformKey } from './platform.js'
import { validateRelease } from './release.js'

/**
 * Install the pinned sfw-free for this runner and put it on PATH.
 *
 * Every dependency is a parameter so tests can pass fakes.
 *
 * @param {object} [deps]
 * @param {typeof actionsCore} [deps.core]
 * @param {Pick<typeof actionsCache, 'isFeatureAvailable' | 'restoreCache' | 'saveCache'>} [deps.cache]
 * @param {typeof fetch} [deps.fetch]
 * @param {NodeJS.ProcessEnv} [deps.env]
 * @param {{ platform: string, arch: string, musl: boolean }} [deps.host]
 * @param {unknown} [deps.release] contents of sfw-free.json
 * @param {number[]} [deps.delays] retry delays in seconds
 */
export async function run({
  core = actionsCore,
  cache = actionsCache,
  fetch = globalThis.fetch,
  env = process.env,
  host = currentHost(),
  release: pinnedRelease = pinned,
  delays,
} = {}) {
  const useCache = core.getBooleanInput('cache')
  const release = validateRelease(pinnedRelease)
  const runnerTemp = env.RUNNER_TEMP
  if (!runnerTemp) {
    throw new Error('RUNNER_TEMP is not set; run this action on a runner')
  }

  const key = platformKey(host)
  const asset = release.assets[key]
  const installDir = join(runnerTemp, 'setup-sfw-free', release.version, key)
  const binary = join(installDir, binaryName(host.platform))
  // The full hash is part of the key: a different binary is a different
  // entry, and restoreCache's prefix matching can't pick a longer key.
  const cacheKey = `setup-sfw-free-${release.version}-${key}-${asset.sha256}`

  await emptyDir(installDir)

  const cacheEnabled = useCache && cache.isFeatureAvailable()
  if (useCache && !cacheEnabled) {
    core.info('Actions cache is not available on this runner')
  }

  let cacheHit = false
  if (cacheEnabled) {
    cacheHit = await restore(core, cache, installDir, binary, cacheKey, asset)
  }

  if (!cacheHit) {
    await download(core, fetch, delays, release.version, asset, binary)
    if (cacheEnabled) {
      await save(core, cache, installDir, cacheKey)
    }
  }

  await chmod(binary, 0o755)
  core.addPath(installDir)

  core.setOutput('version', release.version)
  core.setOutput('path', binary)
  core.setOutput('cache-hit', String(cacheHit))
  core.info(`sfw-free ${release.version} installed at ${binary}`)
}

/**
 * Restore the binary from the Actions cache. Any workflow on the default
 * branch can write cache entries, so a restored binary is trusted only after
 * it matches the pinned sha256. Every failure is a miss, never an error.
 *
 * @returns {Promise<boolean>} whether a verified binary was restored
 */
async function restore(core, cache, installDir, binary, cacheKey, asset) {
  try {
    const matched = await cache.restoreCache([installDir], cacheKey)
    if (matched === undefined) {
      core.info('No cached sfw-free; downloading')
      return false
    }
    if (matched !== cacheKey) {
      core.warning(`Ignoring cache entry ${matched}; expected ${cacheKey}`)
      await emptyDir(installDir)
      return false
    }
    const actual = await sha256File(binary)
    if (actual !== asset.sha256) {
      core.warning(
        `Cached sfw-free does not match the pinned sha256 and was discarded.\nExpected: ${asset.sha256}\nGot:      ${actual}`,
      )
      await emptyDir(installDir)
      return false
    }
    core.info(`Restored sfw-free from cache; sha256 verified: ${actual}`)
    return true
  } catch (error) {
    core.warning(`Cache restore failed, downloading instead: ${error.message}`)
    await emptyDir(installDir)
    return false
  }
}

/**
 * Save the verified binary. A failure (for example another job saving the
 * same key first) only costs the next job a download.
 */
async function save(core, cache, installDir, cacheKey) {
  try {
    await cache.saveCache([installDir], cacheKey)
    core.info(`Saved sfw-free to cache as ${cacheKey}`)
  } catch (error) {
    core.warning(`Cache save failed: ${error.message}`)
  }
}

async function download(core, fetch, delays, version, asset, binary) {
  const partial = `${binary}.download`
  core.info(`Downloading sfw-free ${version} (${asset.name})`)
  const actual = await downloadFile(assetUrl(version, asset.name), partial, {
    fetch,
    delays,
    warn: core.warning,
  })
  // Nothing is made executable, moved or put on PATH before this check.
  if (actual !== asset.sha256) {
    await rm(partial, { force: true })
    throw new Error(
      `Checksum mismatch for ${asset.name}; the download may have been tampered with.\nExpected: ${asset.sha256}\nGot:      ${actual}`,
    )
  }
  core.info(`sha256 verified: ${actual}`)
  await rename(partial, binary)
}

async function emptyDir(dir) {
  await rm(dir, { recursive: true, force: true })
  await mkdir(dir, { recursive: true })
}

function currentHost() {
  return {
    platform: process.platform,
    arch: process.arch,
    musl: process.platform === 'linux' && isMusl(),
  }
}
