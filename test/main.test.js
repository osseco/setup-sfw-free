import assert from 'node:assert/strict'
import { access, readdir, readFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { run } from '../src/main.js'
import { fakeCore, fakeFetch, fakeRelease, tempDir } from './helpers.js'

const linux = { platform: 'linux', arch: 'x64', musl: false }

test('downloads, verifies and puts sfw on PATH', async (t) => {
  const temp = await tempDir(t)
  const core = fakeCore()
  const { fetch, calls } = fakeFetch('sfw-binary')
  await run({
    core,
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
  assert.deepEqual(core.calls.outputs, { version: '1.2.3', path: binary })
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
