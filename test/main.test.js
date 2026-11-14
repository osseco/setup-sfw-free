import assert from 'node:assert/strict'
import { access, readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { run } from '../src/main.js'
import {
  fakeCache,
  fakeCore,
  fakeFetch,
  fakeRelease,
  sha256,
  tempDir,
} from './helpers.js'

const linux = { platform: 'linux', arch: 'x64', musl: false }
const noCache = fakeCache({ available: false })

test('downloads, verifies and puts sfw on PATH', async (t) => {
  const temp = await tempDir(t)
  const core = fakeCore()
  const { fetch, calls } = fakeFetch('sfw-binary')
  await run({
    core,
    cache: noCache,
    fetch,
    env: { RUNNER_TEMP: temp },
    host: linux,
    release: fakeRelease('sfw-binary'),
  })

  const dir = join(temp, 'setup-sfw-free', '1.2.3', 'linux-x64')
  const binary = join(dir, 'sfw')
  assert.deepEqual(calls, [
    'https://github.com/SocketDev/sfw-free/releases/download/v1.2.3/sfw-free-linux-x86_64',
  ])
  assert.equal(await readFile(binary, 'utf8'), 'sfw-binary')
  assert.deepEqual(await readdir(dir), ['sfw'])
  assert.deepEqual(core.calls.paths, [dir])
  assert.deepEqual(core.calls.outputs, {
    version: '1.2.3',
    path: binary,
    'cache-hit': 'false',
  })
  if (process.platform !== 'win32') {
    assert.equal((await stat(binary)).mode & 0o777, 0o755)
  }
})

test('installs sfw.exe on Windows', async (t) => {
  const temp = await tempDir(t)
  const core = fakeCore()
  const { fetch, calls } = fakeFetch('exe')
  await run({
    core,
    cache: noCache,
    fetch,
    env: { RUNNER_TEMP: temp },
    host: { platform: 'win32', arch: 'arm64', musl: false },
    release: fakeRelease('exe'),
  })
  assert.match(calls[0], /sfw-free-windows-arm64\.exe$/)
  assert.match(core.calls.outputs.path, /sfw\.exe$/)
})

test('a checksum mismatch fails before anything is installed', async (t) => {
  const temp = await tempDir(t)
  const core = fakeCore()
  const { fetch } = fakeFetch('tampered')
  await assert.rejects(
    run({
      core,
      cache: noCache,
      fetch,
      env: { RUNNER_TEMP: temp },
      host: linux,
      release: fakeRelease('genuine'),
    }),
    /Checksum mismatch/,
  )
  const dir = join(temp, 'setup-sfw-free', '1.2.3', 'linux-x64')
  assert.deepEqual(await readdir(dir), [])
  assert.deepEqual(core.calls.paths, [])
  assert.deepEqual(core.calls.outputs, {})
})

test('an invalid sfw-free.json fails before any download', async (t) => {
  const temp = await tempDir(t)
  const { fetch, calls } = fakeFetch()
  await assert.rejects(
    run({
      core: fakeCore(),
      fetch,
      env: { RUNNER_TEMP: temp },
      host: linux,
      release: { version: 'latest' },
    }),
    /invalid version/,
  )
  assert.equal(calls.length, 0)
})

test('needs RUNNER_TEMP', async () => {
  await assert.rejects(
    run({ core: fakeCore(), env: {}, host: linux, release: fakeRelease('x') }),
    /RUNNER_TEMP/,
  )
})

test('rejects unsupported platforms', async (t) => {
  const temp = await tempDir(t)
  await assert.rejects(
    run({
      core: fakeCore(),
      env: { RUNNER_TEMP: temp },
      host: { platform: 'aix', arch: 'ppc64', musl: false },
      release: fakeRelease('x'),
    }),
    /no build for aix-ppc64/,
  )
  await assert.rejects(access(join(temp, 'setup-sfw-free')))
})

const cacheKey = `setup-sfw-free-1.2.3-linux-x64-${sha256('sfw-binary')}`

async function runWithCache(
  t,
  cache,
  { fetchResponses = ['sfw-binary'], inputs } = {},
) {
  const temp = await tempDir(t)
  const core = fakeCore(inputs)
  const { fetch, calls } = fakeFetch(...fetchResponses)
  await run({
    core,
    cache,
    fetch,
    env: { RUNNER_TEMP: temp },
    host: linux,
    release: fakeRelease('sfw-binary'),
  })
  const dir = join(temp, 'setup-sfw-free', '1.2.3', 'linux-x64')
  return { core, downloads: calls, dir }
}

test('a cache miss downloads and saves the verified binary', async (t) => {
  const cache = fakeCache()
  const { core, downloads } = await runWithCache(t, cache)
  assert.equal(downloads.length, 1)
  assert.deepEqual(cache.calls.restored, [cacheKey])
  assert.deepEqual(cache.calls.saved, [{ key: cacheKey, files: ['sfw'] }])
  assert.equal(core.calls.outputs['cache-hit'], 'false')
})

test('a verified cache hit skips the download', async (t) => {
  const cache = fakeCache({ entries: { [cacheKey]: { sfw: 'sfw-binary' } } })
  const { core, downloads, dir } = await runWithCache(t, cache, {
    fetchResponses: [],
  })
  assert.equal(downloads.length, 0)
  assert.deepEqual(cache.calls.saved, [])
  assert.equal(core.calls.outputs['cache-hit'], 'true')
  assert.equal(await readFile(join(dir, 'sfw'), 'utf8'), 'sfw-binary')
  assert.deepEqual(core.calls.paths, [dir])
  if (process.platform !== 'win32') {
    assert.equal((await stat(join(dir, 'sfw'))).mode & 0o777, 0o755)
  }
})

test('a tampered cache entry is discarded and downloaded again', async (t) => {
  const cache = fakeCache({ entries: { [cacheKey]: { sfw: 'evil' } } })
  const { core, downloads, dir } = await runWithCache(t, cache)
  assert.equal(downloads.length, 1)
  assert.match(
    core.calls.warning.join('\n'),
    /does not match the pinned sha256/,
  )
  assert.equal(await readFile(join(dir, 'sfw'), 'utf8'), 'sfw-binary')
  assert.equal(core.calls.outputs['cache-hit'], 'false')
  assert.equal(cache.calls.saved.length, 1)
})

test('a prefix match on a longer key is not a hit', async (t) => {
  const cache = fakeCache({
    entries: { [`${cacheKey}-other`]: { sfw: 'sfw-binary', extra: 'x' } },
  })
  const { core, downloads, dir } = await runWithCache(t, cache)
  assert.equal(downloads.length, 1)
  assert.match(core.calls.warning.join('\n'), /Ignoring cache entry/)
  assert.deepEqual(await readdir(dir), ['sfw'])
})

test('an entry without the binary is a miss', async (t) => {
  const cache = fakeCache({ entries: { [cacheKey]: { other: 'x' } } })
  const { core, downloads } = await runWithCache(t, cache)
  assert.equal(downloads.length, 1)
  assert.match(core.calls.warning.join('\n'), /Cache restore failed/)
})

test('cache service errors never fail the action', async (t) => {
  const restoreFails = fakeCache({ fail: 'restore' })
  const first = await runWithCache(t, restoreFails)
  assert.equal(first.downloads.length, 1)
  assert.equal(first.core.calls.outputs['cache-hit'], 'false')

  const saveFails = fakeCache({ fail: 'save' })
  const second = await runWithCache(t, saveFails)
  assert.match(second.core.calls.warning.join('\n'), /Cache save failed/)
  assert.equal(second.core.calls.outputs.version, '1.2.3')
})

test('cache: false neither restores nor saves', async (t) => {
  const cache = fakeCache({ entries: { [cacheKey]: { sfw: 'sfw-binary' } } })
  const { downloads } = await runWithCache(t, cache, {
    inputs: { cache: 'false' },
  })
  assert.equal(downloads.length, 1)
  assert.deepEqual(cache.calls.restored, [])
  assert.deepEqual(cache.calls.saved, [])
})

test('an unavailable cache service is skipped', async (t) => {
  const cache = fakeCache({ available: false })
  const { core, downloads } = await runWithCache(t, cache)
  assert.equal(downloads.length, 1)
  assert.deepEqual(cache.calls.restored, [])
  assert.match(core.calls.info.join('\n'), /not available/)
})

test('rejects a cache input that is not a boolean', async (t) => {
  await assert.rejects(
    runWithCache(t, fakeCache(), { inputs: { cache: 'yes please' } }),
    TypeError,
  )
})
