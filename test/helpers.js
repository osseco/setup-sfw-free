import { createHash } from 'node:crypto'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ASSET_NAMES } from '../src/platform.js'

export const sha256 = (data) => createHash('sha256').update(data).digest('hex')

/** A release in sfw-free.json shape whose every asset hashes to `data`. */
export function fakeRelease(data, version = '1.2.3') {
  const assets = {}
  for (const [key, name] of Object.entries(ASSET_NAMES)) {
    assets[key] = { name, sha256: sha256(data) }
  }
  return { version, publishedAt: '2026-01-01T00:00:00Z', assets }
}

/** fetch that answers with each response in turn and records the URLs. */
export function fakeFetch(...responses) {
  const calls = []
  const fetch = async (url) => {
    calls.push(url)
    const next = responses.shift()
    if (next instanceof Error) {
      throw next
    }
    return typeof next === 'number'
      ? new Response('nope', { status: next })
      : new Response(next)
  }
  return { fetch, calls }
}

/** Records what the action tells @actions/core. */
export function fakeCore(inputs = {}) {
  const calls = { outputs: {}, paths: [], info: [], warning: [] }
  return {
    calls,
    getInput: (name) => inputs[name] ?? '',
    setOutput: (name, value) => {
      calls.outputs[name] = value
    },
    addPath: (path) => calls.paths.push(path),
    info: (message) => calls.info.push(message),
    warning: (message) => calls.warning.push(message),
    debug: () => {},
  }
}

/** A temporary directory removed after the test. */
export async function tempDir(t) {
  const dir = await mkdtemp(join(tmpdir(), 'setup-sfw-free-test-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}
