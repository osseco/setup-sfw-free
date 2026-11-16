import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  compareVersions,
  newestEligible,
  prBody,
} from '../.github/scripts/check-sfw-free.mjs'

const release = (tag, publishedAt, extra = {}) => ({
  tag_name: tag,
  draft: false,
  prerelease: false,
  published_at: publishedAt,
  html_url: `https://github.com/SocketDev/sfw-free/releases/tag/${tag}`,
  ...extra,
})

// Real dates of recent sfw-free releases.
const releases = [
  release('v1.16.0', '2026-11-01T14:28:39Z'),
  release('v1.15.6', '2026-10-23T09:33:43Z'),
  release('v1.15.4', '2026-10-01T11:00:57Z'),
]

test('compares versions numerically', () => {
  assert.ok(compareVersions('1.10.0', '1.9.9') > 0)
  assert.ok(compareVersions('1.15.6', '1.16.0') < 0)
  assert.equal(compareVersions('1.2.3', '1.2.3'), 0)
})

test('finds a newer release once it is 7 days old', () => {
  const found = newestEligible(
    releases,
    '1.15.6',
    new Date('2026-11-14T00:00:00Z'),
  )
  assert.equal(found.version, '1.16.0')
})

test('ignores a newer release younger than 7 days', () => {
  assert.equal(
    newestEligible(releases, '1.15.6', new Date('2026-11-08T14:28:38Z')),
    undefined,
  )
  assert.equal(
    newestEligible(releases, '1.15.6', new Date('2026-11-08T14:28:39Z'))
      .version,
    '1.16.0',
  )
})

test('picks the newest eligible release when several are', () => {
  const found = newestEligible(releases, '1.15.4', new Date('2026-12-01'))
  assert.equal(found.version, '1.16.0')
})

test('falls back to an older release while the newest is too young', () => {
  const found = newestEligible(
    releases,
    '1.15.4',
    new Date('2026-11-03T00:00:00Z'),
  )
  assert.equal(found.version, '1.15.6')
})

test('nothing to do when the pinned version is current', () => {
  assert.equal(
    newestEligible(releases, '1.16.0', new Date('2027-01-01')),
    undefined,
  )
})

test('skips drafts, prereleases and odd tags', () => {
  const now = new Date('2027-01-01')
  const odd = [
    release('v2.0.0', '2026-11-01T00:00:00Z', { prerelease: true }),
    release('v2.0.1', null, { draft: true }),
    release('nightly', '2026-11-01T00:00:00Z'),
    release('v2.0.0-rc.1', '2026-11-01T00:00:00Z'),
  ]
  assert.equal(newestEligible(odd, '1.16.0', now), undefined)
})

test('the pull request lists the review steps', () => {
  const body = prBody(
    { ...releases[0], version: '1.16.0' },
    '1.15.6',
    new Date('2026-11-14T14:28:39Z'),
  )
  assert.match(body, /13 days ago/)
  assert.match(body, /gh release verify-asset v1\.16\.0/)
  assert.match(body, /feat\(sfw\): update sfw-free to 1\.16\.0/)
  assert.match(body, /pins v1\.15\.6/)
})
