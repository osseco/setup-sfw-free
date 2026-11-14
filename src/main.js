import { chmod, mkdir, rename, rm } from 'node:fs/promises'
import { join } from 'node:path'
import * as actionsCore from '@actions/core'
import pinned from '../sfw-free.json' with { type: 'json' }
import { assetUrl, downloadFile } from './download.js'
import { binaryName, isMusl, platformKey } from './platform.js'
import { validateRelease } from './release.js'

/**
 * Install the pinned sfw-free for this runner and put it on PATH.
 *
 * Every dependency is a parameter so tests can pass fakes.
 *
 * @param {object} [deps]
 * @param {typeof actionsCore} [deps.core]
 * @param {typeof fetch} [deps.fetch]
 * @param {NodeJS.ProcessEnv} [deps.env]
 * @param {{ platform: string, arch: string, musl: boolean }} [deps.host]
 * @param {unknown} [deps.release] contents of sfw-free.json
 * @param {number[]} [deps.delays] retry delays in seconds
 */
export async function run({
  core = actionsCore,
  fetch = globalThis.fetch,
  env = process.env,
  host = currentHost(),
  release: pinnedRelease = pinned,
  delays,
} = {}) {
  const release = validateRelease(pinnedRelease)
  const runnerTemp = env.RUNNER_TEMP
  if (!runnerTemp) {
    throw new Error('RUNNER_TEMP is not set; run this action on a runner')
  }

  const key = platformKey(host)
  const asset = release.assets[key]
  const installDir = join(runnerTemp, 'setup-sfw-free', release.version, key)
  const binary = join(installDir, binaryName(host.platform))

  await rm(installDir, { recursive: true, force: true })
  await mkdir(installDir, { recursive: true })

  const url = assetUrl(release.version, asset.name)
  const partial = `${binary}.download`
  core.info(`Downloading sfw-free ${release.version} (${asset.name})`)
  const actual = await downloadFile(url, partial, {
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
  await chmod(binary, 0o755)
  core.addPath(installDir)

  core.setOutput('version', release.version)
  core.setOutput('path', binary)
  core.info(`sfw-free ${release.version} installed at ${binary}`)
}

function currentHost() {
  return {
    platform: process.platform,
    arch: process.arch,
    musl: process.platform === 'linux' && isMusl(),
  }
}
