import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  branchName,
  checkRelease,
  expectedDigests,
  update,
} from '../scripts/update-sfw-free.mjs'
import { ASSET_NAMES } from '../src/platform.js'
import { fakeRelease, tempDir } from './helpers.js'

const release = (overrides = {}) => ({
  tag_name: 'v1.16.0',
  draft: false,
  prerelease: false,
  published_at: '2026-11-01T14:28:39Z',
  ...overrides,
})

test('accepts a release 7 days old', () => {
  checkRelease(release(), '1.16.0', new Date('2026-11-08T14:28:39Z'))
})

test('refuses a release younger than 7 days', () => {
  assert.throws(
    () => checkRelease(release(), '1.16.0', new Date('2026-11-08T14:28:38Z')),
    /6\.9|7\.0|wait until/,
  )
})

test('refuses drafts, prereleases and the wrong tag', () => {
  const now = new Date('2027-01-01')
  assert.throws(
    () => checkRelease(release({ draft: true }), '1.16.0', now),
    /draft/,
  )
  assert.throws(
    () => checkRelease(release({ prerelease: true }), '1.16.0', now),
    /prerelease/,
  )
  assert.throws(() => checkRelease(release(), '1.15.0', now), /expected tag/)
})

test('reads GitHub digests for every mapped asset', () => {
  const digest = 'a'.repeat(64)
  const assets = Object.values(ASSET_NAMES).map((name) => ({
    name,
    digest: `sha256:${digest}`,
  }))
  assets.push({ name: 'unrelated', digest: 'sha256:00' })
  const digests = expectedDigests({ assets })
  assert.deepEqual(Object.keys(digests).sort(), Object.keys(ASSET_NAMES).sort())
  assert.equal(digests['linux-x64'].digest, digest)
})

test('refuses missing assets or digests', () => {
  assert.throws(() => expectedDigests({ assets: [] }), /no asset/)
  const assets = Object.values(ASSET_NAMES).map((name) => ({ name }))
  assert.throws(() => expectedDigests({ assets }), /no sha256 digest/)
})

// --- the update flow, with fake git, pnpm, GitHub API and downloads ---

const DIGEST = 'b'.repeat(64)
const NOW = new Date('2026-11-14T00:00:00Z')

const apiRelease = {
  tag_name: 'v1.16.0',
  draft: false,
  prerelease: false,
  published_at: '2026-11-01T14:28:39Z',
  assets: Object.values(ASSET_NAMES).map((name) => ({
    name,
    digest: `sha256:${DIGEST}`,
  })),
}

/** Records commands; answers git status, rev-parse and show like a repo would. */
function fakeExec({
  dirty = false,
  branchExists = false,
  mainPins = '1.15.6',
} = {}) {
  const calls = []
  const exec = async (cmd, args) => {
    calls.push([cmd, ...args].join(' '))
    const line = [cmd, ...args].join(' ')
    if (line === 'git status --porcelain') {
      return { code: 0, stdout: dirty ? ' M README.md\n' : '' }
    }
    if (line.startsWith('git rev-parse')) {
      return { code: branchExists ? 0 : 1, stdout: '' }
    }
    if (line === 'git show origin/main:sfw-free.json') {
      return { code: 0, stdout: JSON.stringify(fakeRelease('x', mainPins)) }
    }
    return { code: 0, stdout: '' }
  }
  return { exec, calls }
}

async function repo(t) {
  const root = await tempDir(t)
  await writeFile(
    join(root, 'sfw-free.json'),
    JSON.stringify(fakeRelease('x', '1.15.6')),
  )
  await writeFile(
    join(root, 'README.md'),
    'Installs <!-- sfw-free-version -->1.15.6<!-- /sfw-free-version -->.\n',
  )
  return root
}

function deps(root, exec, overrides = {}) {
  const fetched = []
  return {
    root,
    exec,
    now: NOW,
    log: () => {},
    fetch: async (url) => {
      fetched.push(url)
      return Response.json(apiRelease)
    },
    download: async () => DIGEST,
    fetched,
    ...overrides,
  }
}

test('stages the update on a new branch and never commits', async (t) => {
  const root = await repo(t)
  const { exec, calls } = fakeExec()
  await update('1.16.0', deps(root, exec))

  assert.deepEqual(calls, [
    'git status --porcelain',
    'sfw --help',
    'git fetch origin main --tags',
    'git rev-parse --verify --quiet refs/heads/feat/update_sfw_free_1.16.0',
    'git show origin/main:sfw-free.json',
    'git switch --no-track -c feat/update_sfw_free_1.16.0 origin/main',
    'sfw pnpm install --frozen-lockfile',
    'pnpm build',
    'pnpm test',
    'git add -- sfw-free.json README.md dist/',
    'git diff --cached --stat',
  ])
  assert.ok(!calls.some((c) => /commit|push/.test(c)))

  const pinned = JSON.parse(await readFile(join(root, 'sfw-free.json'), 'utf8'))
  assert.equal(pinned.version, '1.16.0')
  assert.equal(pinned.publishedAt, '2026-11-01T14:28:39Z')
  assert.equal(pinned.assets['linux-x64'].sha256, DIGEST)
  assert.match(
    await readFile(join(root, 'README.md'), 'utf8'),
    /-->1\.16\.0<!--/,
  )
})

test('a dirty working tree stops before any network or branch', async (t) => {
  const root = await repo(t)
  const { exec, calls } = fakeExec({ dirty: true })
  const d = deps(root, exec)
  await assert.rejects(update('1.16.0', d), /working tree has changes/)
  assert.deepEqual(calls, ['git status --porcelain'])
  assert.deepEqual(d.fetched, [])
})

test('an existing branch stops before switching', async (t) => {
  const root = await repo(t)
  const { exec, calls } = fakeExec({ branchExists: true })
  await assert.rejects(update('1.16.0', deps(root, exec)), /already exists/)
  assert.ok(!calls.some((c) => c.startsWith('git switch')))
})

test('refuses a version main already has or passed', async (t) => {
  const root = await repo(t)
  const { exec, calls } = fakeExec({ mainPins: '1.16.0' })
  const d = deps(root, exec)
  await assert.rejects(
    update('1.16.0', d),
    /not newer than the pinned 1\.16\.0/,
  )
  assert.ok(!calls.some((c) => c.startsWith('git switch')))
  assert.deepEqual(d.fetched, [])
})

test('a digest mismatch stops on the branch and writes nothing', async (t) => {
  const root = await repo(t)
  const { exec, calls } = fakeExec()
  const logs = []
  await assert.rejects(
    update(
      '1.16.0',
      deps(root, exec, {
        download: async () => 'c'.repeat(64),
        log: (m) => logs.push(m),
      }),
    ),
    /differs from GitHub's/,
  )
  assert.ok(calls.at(-1).startsWith('git switch'))
  assert.match(logs.join('\n'), /git branch -D feat\/update_sfw_free_1\.16\.0/)
  const pinned = JSON.parse(await readFile(join(root, 'sfw-free.json'), 'utf8'))
  assert.equal(pinned.version, '1.15.6')
})

test('dry run checks and downloads but runs no git and writes nothing', async (t) => {
  const root = await repo(t)
  const { exec, calls } = fakeExec()
  const downloads = []
  await update(
    '1.16.0',
    deps(root, exec, {
      dryRun: true,
      download: async (url) => {
        downloads.push(url)
        return DIGEST
      },
    }),
  )
  assert.deepEqual(calls, [])
  assert.equal(downloads.length, Object.keys(ASSET_NAMES).length)
  const pinned = JSON.parse(await readFile(join(root, 'sfw-free.json'), 'utf8'))
  assert.equal(pinned.version, '1.15.6')
})

test('rejects a malformed version and a failed API call', async (t) => {
  const root = await repo(t)
  await assert.rejects(
    update('latest', { root }),
    /usage: pnpm update-sfw-free/,
  )
  const { exec } = fakeExec()
  await assert.rejects(
    update(
      '1.16.0',
      deps(root, exec, {
        dryRun: true,
        fetch: async () => new Response('', { status: 404 }),
      }),
    ),
    /HTTP 404/,
  )
})

test('branch names follow the type/short_description convention', () => {
  assert.equal(branchName('1.16.0'), 'feat/update_sfw_free_1.16.0')
})
