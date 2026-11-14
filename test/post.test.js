import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { test } from 'node:test'
import { run } from '../src/post.js'
import { fakeCore, tempDir } from './helpers.js'

async function post(t, { report, inputs } = {}) {
  const dir = await tempDir(t)
  const path = join(dir, 'report.json')
  if (report !== undefined) {
    await writeFile(
      path,
      typeof report === 'string' ? report : JSON.stringify(report),
    )
  }
  const core = fakeCore(inputs)
  core.saveState('report-path', path)
  await run({ core })
  return core.calls
}

const blocked = {
  blocked: [
    { purlString: 'pkg:npm/bad@1.0.0', registryFqdn: 'registry.npmjs.org' },
  ],
}

test('writes blocked packages to the job summary', async (t) => {
  const calls = await post(t, { report: blocked })
  assert.equal(calls.summary.length, 1)
  assert.match(calls.summary[0], /bad/)
})

test('errors mode writes nothing when nothing was blocked', async (t) => {
  const calls = await post(t, { report: {} })
  assert.deepEqual(calls.summary, [])
  assert.match(calls.info.join('\n'), /blocked nothing/)
})

test('all mode writes a summary even when nothing was blocked', async (t) => {
  const calls = await post(t, { report: {}, inputs: { 'job-summary': 'all' } })
  assert.match(calls.summary[0], /No packages were blocked/)
})

test('a missing report is not an error', async (t) => {
  const calls = await post(t)
  assert.deepEqual(calls.summary, [])
  assert.deepEqual(calls.warning, [])
  assert.match(calls.info.join('\n'), /no report/)
})

test('an unreadable report is a warning, not a failure', async (t) => {
  const calls = await post(t, { report: '{not json' })
  assert.deepEqual(calls.summary, [])
  assert.match(calls.warning.join('\n'), /Could not read the sfw report/)
})

test('does nothing when main did not run or job-summary is none', async (t) => {
  const core = fakeCore()
  await run({ core })
  assert.deepEqual(core.calls.summary, [])

  const calls = await post(t, {
    report: blocked,
    inputs: { 'job-summary': 'none' },
  })
  assert.deepEqual(calls.summary, [])
})
