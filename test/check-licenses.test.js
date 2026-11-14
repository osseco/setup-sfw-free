import assert from 'node:assert/strict'
import { test } from 'node:test'
import { disallowed, isAllowed } from '../.github/scripts/check-licenses.mjs'

test('allows listed licenses and SPDX expressions of them', () => {
  assert.equal(isAllowed('MIT'), true)
  assert.equal(isAllowed('(Apache-2.0 AND BSD-3-Clause)'), true)
  assert.equal(isAllowed('(GPL-3.0 OR MIT)'), true)
})

test('rejects anything else', () => {
  assert.equal(isAllowed('GPL-3.0'), false)
  assert.equal(isAllowed('MIT AND GPL-3.0'), false)
  assert.equal(isAllowed('UNKNOWN'), false)
  assert.equal(isAllowed('MIT OR Apache-2.0 AND GPL-3.0'), false)
})

test('lists the packages with disallowed licenses', () => {
  const report = {
    MIT: [{ name: 'ok', versions: ['1.0.0'] }],
    'GPL-3.0': [{ name: 'copyleft', versions: ['2.0.0', '2.1.0'] }],
  }
  assert.deepEqual(disallowed(report), ['copyleft@2.0.0,2.1.0: GPL-3.0'])
})
