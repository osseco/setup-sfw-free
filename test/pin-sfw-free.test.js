import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  branchName,
  checkRelease,
  pin,
} from '../.github/scripts/pin-sfw-free.mjs'
import { ASSET_NAMES } from '../src/platform.js'
import { fakeRelease, sha256, tempDir } from './helpers.js'

const release = (overrides = {}) => ({
  tagName: 'v1.16.0',
  isDraft: false,
  isPrerelease: false,
  isImmutable: true,
  publishedAt: '2026-11-01T14:28:39Z',
  ...overrides,
})

test('accepts an immutable release 7 days old', () => {
  checkRelease(release(), '1.16.0', new Date('2026-11-08T14:28:39Z'))
})

test('refuses a release younger than 7 days', () => {
  assert.throws(
    () => checkRelease(release(), '1.16.0', new Date('2026-11-08T14:28:38Z')),
    /wait until/,
  )
})

test('refuses drafts, prereleases, mutable releases and the wrong tag', () => {
  const now = new Date('2027-01-01')
  assert.throws(
    () => checkRelease(release({ isDraft: true }), '1.16.0', now),
    /draft/,
  )
  assert.throws(
    () => checkRelease(release({ isPrerelease: true }), '1.16.0', now),
    /prerelease/,
  )
  assert.throws(
    () => checkRelease(release({ isImmutable: false }), '1.16.0', now),
    /not an immutable release/,
  )
  assert.throws(() => checkRelease(release(), '1.15.0', now), /expected tag/)
})

// --- the pin, with fake gh and downloaded assets ---

const NOW = new Date('2026-11-14T00:00:00Z')

/** Records gh calls; answers release view, and fails verify-asset for `bad`. */
function fakeExec({ view = release(), bad } = {}) {
  const calls = []
  const exec = async (cmd, args) => {
    const line = [cmd, ...args].join(' ')
    calls.push(line)
    if (args[1] === 'view') {
      return { stdout: JSON.stringify(view) }
    }
    if (args[1] === 'verify-asset' && args[3].endsWith(bad)) {
      throw new Error('attestation not found')
    }
    return { stdout: '' }
  }
  return { exec, calls }
}

async function setup(t, { skip } = {}) {
  const root = await tempDir(t)
  await writeFile(
    join(root, 'sfw-free.json'),
    `${JSON.stringify(fakeRelease('old', '1.15.6'), null, 2)}\n`,
  )
  await writeFile(
    join(root, 'README.md'),
    'Installs <!-- sfw-free-version -->1.15.6<!-- /sfw-free-version -->.\n',
  )
  const dir = join(root, 'download')
  await mkdir(dir)
  for (const name of Object.values(ASSET_NAMES)) {
    if (name !== skip) await writeFile(join(dir, name), name)
  }
  return { root, dir }
}

const unchanged = async (root) => {
  const pinned = JSON.parse(await readFile(join(root, 'sfw-free.json'), 'utf8'))
  assert.equal(pinned.version, '1.15.6')
}

test('verifies every asset with gh and pins its sha256', async (t) => {
  const { root, dir } = await setup(t)
  const { exec, calls } = fakeExec()
  await pin('1.16.0', dir, { root, exec, now: NOW, log: () => {} })

  assert.equal(
    calls[0],
    'gh release view v1.16.0 --repo SocketDev/sfw-free --json tagName,isDraft,isPrerelease,isImmutable,publishedAt',
  )
  assert.deepEqual(
    calls.slice(1),
    Object.values(ASSET_NAMES).map(
      (name) =>
        `gh release verify-asset v1.16.0 ${join(dir, name)} --repo SocketDev/sfw-free`,
    ),
  )

  const pinned = JSON.parse(await readFile(join(root, 'sfw-free.json'), 'utf8'))
  assert.equal(pinned.version, '1.16.0')
  assert.equal(pinned.publishedAt, '2026-11-01T14:28:39Z')
  for (const [key, name] of Object.entries(ASSET_NAMES)) {
    assert.deepEqual(pinned.assets[key], { name, sha256: sha256(name) })
  }
  assert.match(
    await readFile(join(root, 'README.md'), 'utf8'),
    /-->1\.16\.0<!--/,
  )
})

test('a failed attestation writes nothing', async (t) => {
  const { root, dir } = await setup(t)
  const bad = ASSET_NAMES['linux-x64']
  const { exec } = fakeExec({ bad })
  await assert.rejects(
    pin('1.16.0', dir, { root, exec, now: NOW, log: () => {} }),
    /attestation not found/,
  )
  await unchanged(root)
})

test('a missing asset writes nothing', async (t) => {
  const { root, dir } = await setup(t, { skip: ASSET_NAMES['darwin-arm64'] })
  const { exec } = fakeExec()
  await assert.rejects(
    pin('1.16.0', dir, { root, exec, now: NOW, log: () => {} }),
    /ENOENT/,
  )
  await unchanged(root)
})

test('a release gh reports as mutable writes nothing', async (t) => {
  const { root, dir } = await setup(t)
  const { exec, calls } = fakeExec({ view: release({ isImmutable: false }) })
  await assert.rejects(
    pin('1.16.0', dir, { root, exec, now: NOW, log: () => {} }),
    /immutable/,
  )
  assert.equal(calls.length, 1)
  await unchanged(root)
})

test('refuses a version that is not newer before calling gh', async (t) => {
  const { root, dir } = await setup(t)
  const { exec, calls } = fakeExec()
  await assert.rejects(
    pin('1.15.6', dir, { root, exec, now: NOW }),
    /not newer than the pinned 1\.15\.6/,
  )
  await assert.rejects(pin('latest', dir, { root, exec }), /usage/)
  await assert.rejects(pin('1.16.0', '', { root, exec }), /usage/)
  assert.deepEqual(calls, [])
})

test('branch names follow the type/short_description convention', () => {
  assert.equal(branchName('1.16.0'), 'feat/update_sfw_free_1.16.0')
})
