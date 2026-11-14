import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { validateRelease } from '../src/release.js'
import { fakeRelease } from './helpers.js'

test('the pinned sfw-free.json is valid', async () => {
  const pinned = JSON.parse(
    await readFile(new URL('../sfw-free.json', import.meta.url), 'utf8'),
  )
  assert.equal(validateRelease(pinned), pinned)
})

test('rejects a bad version', () => {
  const release = { ...fakeRelease('x'), version: '1.2.3/../evil' }
  assert.throws(() => validateRelease(release), /invalid version/)
})

test('rejects a bad publishedAt', () => {
  const release = { ...fakeRelease('x'), publishedAt: 'soon' }
  assert.throws(() => validateRelease(release), /invalid publishedAt/)
})

test('rejects a wrong asset name', () => {
  const release = fakeRelease('x')
  release.assets['linux-x64'].name = 'other'
  assert.throws(() => validateRelease(release), /linux-x64 must be/)
})

test('rejects a missing or malformed hash', () => {
  const release = fakeRelease('x')
  release.assets['win32-x64'].sha256 = 'ABC'
  assert.throws(() => validateRelease(release), /invalid sha256 for win32-x64/)
})

test('rejects unknown assets', () => {
  const release = fakeRelease('x')
  release.assets['plan9-x64'] = release.assets['linux-x64']
  assert.throws(() => validateRelease(release), /unknown assets plan9-x64/)
})

test('rejects nothing at all', () => {
  assert.throws(() => validateRelease(undefined), /invalid version/)
})
