import assert from 'node:assert/strict'
import { access, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import {
  assetUrl,
  downloadFile,
  isRetryable,
  sha256File,
} from '../src/download.js'
import { fakeFetch, sha256, tempDir } from './helpers.js'

const noWait = async () => {}

test('asset URLs point at the GitHub release, escaped', () => {
  assert.equal(
    assetUrl('1.15.6', 'sfw-free-linux-x86_64'),
    'https://github.com/SocketDev/sfw-free/releases/download/v1.15.6/sfw-free-linux-x86_64',
  )
  assert.match(assetUrl('1.0.0', 'a/b'), /\/a%2Fb$/)
})

test('retries 5xx, 408, 429 and network errors only', () => {
  assert.equal(isRetryable({ status: 503 }), true)
  assert.equal(isRetryable({ status: 408 }), true)
  assert.equal(isRetryable({ status: 429 }), true)
  assert.equal(isRetryable(new TypeError('fetch failed')), true)
  assert.equal(isRetryable({ status: 404 }), false)
})

test('writes the body and returns its sha256', async (t) => {
  const dir = await tempDir(t)
  const dest = join(dir, 'bin')
  const { fetch } = fakeFetch('binary')
  assert.equal(await downloadFile('u', dest, { fetch }), sha256('binary'))
  assert.equal(await readFile(dest, 'utf8'), 'binary')
  assert.equal(await sha256File(dest), sha256('binary'))
})

test('retries transient failures, then succeeds', async (t) => {
  const dir = await tempDir(t)
  const warnings = []
  const { fetch, calls } = fakeFetch(502, new TypeError('reset'), 'ok')
  const hash = await downloadFile('u', join(dir, 'bin'), {
    fetch,
    delays: [1, 1],
    wait: noWait,
    warn: (m) => warnings.push(m),
  })
  assert.equal(hash, sha256('ok'))
  assert.equal(calls.length, 3)
  assert.equal(warnings.length, 2)
})

test('gives up after the last delay and leaves no partial file', async (t) => {
  const dir = await tempDir(t)
  const dest = join(dir, 'bin')
  await writeFile(dest, 'stale')
  const { fetch, calls } = fakeFetch(503, 503)
  await assert.rejects(
    downloadFile('u', dest, { fetch, delays: [1], wait: noWait }),
    /HTTP 503/,
  )
  assert.equal(calls.length, 2)
  await assert.rejects(access(dest))
})

test('does not retry a 404', async (t) => {
  const dir = await tempDir(t)
  const { fetch, calls } = fakeFetch(404, 'never')
  await assert.rejects(
    downloadFile('u', join(dir, 'bin'), { fetch, delays: [1], wait: noWait }),
    /HTTP 404/,
  )
  assert.equal(calls.length, 1)
})

test('refuses a redirect to http', async (t) => {
  const dir = await tempDir(t)
  const fetch = async () => {
    const response = new Response('x')
    Object.defineProperty(response, 'url', { value: 'http://evil/x' })
    return response
  }
  await assert.rejects(
    downloadFile('u', join(dir, 'bin'), { fetch, delays: [1], wait: noWait }),
    /non-https/,
  )
})
