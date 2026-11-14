import assert from 'node:assert/strict'
import { test } from 'node:test'
import { checkRelease, expectedDigests } from '../scripts/update-sfw-free.mjs'
import { ASSET_NAMES } from '../src/platform.js'

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
