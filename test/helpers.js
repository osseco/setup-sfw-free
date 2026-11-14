import { createHash } from 'node:crypto'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
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

/**
 * Records what the action tells @actions/core. Inputs default to the
 * action.yml defaults.
 */
export function fakeCore(inputs = {}) {
  const calls = {
    outputs: {},
    paths: [],
    env: {},
    state: {},
    info: [],
    warning: [],
    summary: [],
  }
  const values = { cache: 'true', 'job-summary': 'errors', ...inputs }
  const getInput = (name) => values[name] ?? ''
  return {
    calls,
    getInput,
    setOutput: (name, value) => {
      calls.outputs[name] = value
    },
    addPath: (path) => calls.paths.push(path),
    exportVariable: (name, value) => {
      calls.env[name] = value
    },
    saveState: (name, value) => {
      calls.state[name] = value
    },
    getState: (name) => calls.state[name] ?? '',
    summary: {
      addRaw(html) {
        calls.summary.push(html)
        return this
      },
      write: async () => {},
    },
    info: (message) => calls.info.push(message),
    warning: (message) => calls.warning.push(message),
    debug: () => {},
  }
}

/**
 * In-memory @actions/cache. `entries` maps a key to the files restored into
 * the first path. restoreCache matches by prefix, like the real one.
 */
export function fakeCache({ available = true, entries = {}, fail } = {}) {
  const calls = { restored: [], saved: [] }
  return {
    calls,
    isFeatureAvailable: () => available,
    restoreCache: async ([dir], key) => {
      calls.restored.push(key)
      if (fail === 'restore') throw new Error('cache service down')
      const matched = Object.keys(entries).find((k) => k.startsWith(key))
      if (matched === undefined) return undefined
      for (const [name, content] of Object.entries(entries[matched])) {
        await writeFile(join(dir, name), content)
      }
      return matched
    },
    saveCache: async ([dir], key) => {
      if (fail === 'save') throw new Error('reserved by another job')
      calls.saved.push({ key, files: await readdir(dir) })
      return 1
    },
  }
}

/** A temporary directory removed after the test. */
export async function tempDir(t) {
  const dir = await mkdtemp(join(tmpdir(), 'setup-sfw-free-test-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}
