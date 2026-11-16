import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  commitMessage,
  fileChanges,
  openUpdatePr,
} from '../.github/scripts/open-update-pr.mjs'
import { tempDir } from './helpers.js'

const HEAD = 'a'.repeat(40)

/** Answers git diff with `staged` (name-status pairs) and rev-parse with HEAD. */
function fakeExec(staged) {
  const calls = []
  const exec = async (cmd, args) => {
    const line = [cmd, ...args].join(' ')
    calls.push(line)
    if (line.startsWith('git diff --cached')) {
      return { code: 0, stdout: staged.map((f) => `${f}\0`).join('') }
    }
    if (line === 'git rev-parse HEAD') {
      return { code: 0, stdout: `${HEAD}\n` }
    }
    throw new Error(`unexpected command ${line}`)
  }
  return { exec, calls }
}

/** fetch that records method, URL and JSON body, and answers in turn. */
function fakeFetch(...responses) {
  const calls = []
  const fetch = async (url, init) => {
    calls.push({ method: init.method, url, body: JSON.parse(init.body) })
    const next = responses.shift()
    return typeof next === 'number'
      ? Response.json({ message: 'Reference already exists' }, { status: next })
      : Response.json(next, { status: 201 })
  }
  return { fetch, calls }
}

async function repo(t) {
  const root = await tempDir(t)
  await mkdir(join(root, 'dist'))
  await writeFile(join(root, 'sfw-free.json'), '{"version":"1.16.0"}\n')
  await writeFile(join(root, 'dist/main.cjs'), 'main')
  return root
}

const b64 = (s) => Buffer.from(s).toString('base64')

test('reads additions, modifications and deletions', async (t) => {
  const root = await repo(t)
  const { exec } = fakeExec([
    'M',
    'sfw-free.json',
    'A',
    'dist/main.cjs',
    'D',
    'dist/old.cjs',
  ])
  assert.deepEqual(await fileChanges(exec, root), {
    additions: [
      { path: 'sfw-free.json', contents: b64('{"version":"1.16.0"}\n') },
      { path: 'dist/main.cjs', contents: b64('main') },
    ],
    deletions: [{ path: 'dist/old.cjs' }],
  })
})

test('refuses paths the update does not change', async (t) => {
  const root = await repo(t)
  for (const path of ['package.json', 'dist', 'README.md.bak', 'src/x.js']) {
    const { exec } = fakeExec(['M', path])
    await assert.rejects(fileChanges(exec, root), /unexpected path/)
  }
})

test('refuses an empty index and odd statuses', async (t) => {
  const root = await repo(t)
  await assert.rejects(fileChanges(fakeExec([]).exec, root), /nothing/)
  await assert.rejects(
    fileChanges(fakeExec(['T', 'README.md']).exec, root),
    /unexpected status T/,
  )
})

const options = (root, exec, fetch) => ({
  version: '1.16.0',
  repository: 'osseco/setup-sfw-free',
  token: 't0ken',
  body: 'the body',
  root,
  exec,
  fetch,
  log: () => {},
})

test('creates the branch, commits through GraphQL and opens the pull request', async (t) => {
  const root = await repo(t)
  const { exec } = fakeExec(['M', 'sfw-free.json'])
  const { fetch, calls } = fakeFetch(
    {},
    { data: { createCommitOnBranch: { commit: { oid: 'b'.repeat(40) } } } },
    { html_url: 'https://github.com/osseco/setup-sfw-free/pull/9' },
  )
  const url = await openUpdatePr(options(root, exec, fetch))
  assert.equal(url, 'https://github.com/osseco/setup-sfw-free/pull/9')

  assert.deepEqual(
    calls.map((c) => `${c.method} ${c.url}`),
    [
      'POST https://api.github.com/repos/osseco/setup-sfw-free/git/refs',
      'POST https://api.github.com/graphql',
      'POST https://api.github.com/repos/osseco/setup-sfw-free/pulls',
    ],
  )
  assert.deepEqual(calls[0].body, {
    ref: 'refs/heads/feat/update_sfw_free_1.16.0',
    sha: HEAD,
  })
  const { input } = calls[1].body.variables
  assert.deepEqual(input.branch, {
    repositoryNameWithOwner: 'osseco/setup-sfw-free',
    branchName: 'feat/update_sfw_free_1.16.0',
  })
  assert.equal(input.expectedHeadOid, HEAD)
  assert.equal(input.message.headline, 'feat(sfw): update sfw-free to 1.16.0')
  assert.equal(input.fileChanges.additions[0].path, 'sfw-free.json')
  assert.deepEqual(calls[2].body, {
    title: 'feat(sfw): update sfw-free to 1.16.0',
    head: 'feat/update_sfw_free_1.16.0',
    base: 'main',
    body: 'the body',
  })
})

test('an existing branch stops before committing', async (t) => {
  const root = await repo(t)
  const { exec } = fakeExec(['M', 'sfw-free.json'])
  const { fetch, calls } = fakeFetch(422)
  await assert.rejects(
    openUpdatePr(options(root, exec, fetch)),
    /could not create branch feat\/update_sfw_free_1\.16\.0: .*422.*already exists/,
  )
  assert.equal(calls.length, 1)
})

test('GraphQL errors stop before opening the pull request', async (t) => {
  const root = await repo(t)
  const { exec } = fakeExec(['M', 'sfw-free.json'])
  const { fetch, calls } = fakeFetch({}, { errors: [{ message: 'stale' }] })
  await assert.rejects(openUpdatePr(options(root, exec, fetch)), /stale/)
  assert.equal(calls.length, 2)
})

test('validates version, repository and token before any call', async () => {
  const { exec, calls } = fakeExec([])
  const base = options('/nowhere', exec, async () => {
    throw new Error('no network')
  })
  await assert.rejects(openUpdatePr({ ...base, version: 'x' }), /version/)
  await assert.rejects(
    openUpdatePr({ ...base, repository: 'a/b/c' }),
    /repository/,
  )
  await assert.rejects(openUpdatePr({ ...base, token: '' }), /GH_TOKEN/)
  assert.deepEqual(calls, [])
})

test('commit messages follow the sfw-free update convention', () => {
  assert.equal(commitMessage('1.16.0'), 'feat(sfw): update sfw-free to 1.16.0')
})
