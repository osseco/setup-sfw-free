import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  escapeHtml,
  jobSummaryMode,
  parsePurl,
  renderSummary,
} from '../src/summary.js'
import { fakeCore } from './helpers.js'

test('job-summary defaults to errors and accepts only known modes', () => {
  assert.equal(jobSummaryMode(fakeCore({ 'job-summary': '' })), 'errors')
  assert.equal(jobSummaryMode(fakeCore({ 'job-summary': 'all' })), 'all')
  assert.equal(jobSummaryMode(fakeCore({ 'job-summary': 'none' })), 'none')
  assert.throws(
    () => jobSummaryMode(fakeCore({ 'job-summary': 'ALL' })),
    /must be one of/,
  )
})

test('escapes everything HTML cares about', () => {
  assert.equal(
    escapeHtml(`<a href="x" onclick='y'>&</a>`),
    '&lt;a href=&quot;x&quot; onclick=&#39;y&#39;&gt;&amp;&lt;/a&gt;',
  )
  assert.equal(escapeHtml(undefined), '')
})

test('parses package URLs', () => {
  assert.deepEqual(parsePurl('pkg:npm/lodash@4.17.21'), {
    type: 'npm',
    namespace: '',
    name: 'lodash',
    version: '4.17.21',
  })
  assert.deepEqual(parsePurl('pkg:npm/%40babel/core@7.0.0?foo=bar#sub'), {
    type: 'npm',
    namespace: '@babel',
    name: 'core',
    version: '7.0.0',
  })
  assert.deepEqual(parsePurl('pkg:npm/@scope/name'), {
    type: 'npm',
    namespace: '@scope',
    name: 'name',
    version: '',
  })
  assert.deepEqual(parsePurl('pkg:PyPI/requests@2.0'), {
    type: 'pypi',
    namespace: '',
    name: 'requests',
    version: '2.0',
  })
})

test('rejects things that are not package URLs', () => {
  assert.equal(parsePurl('npm/lodash'), undefined)
  assert.equal(parsePurl('pkg:npm'), undefined)
  assert.equal(parsePurl('pkg:npm/'), undefined)
  assert.equal(parsePurl('pkg:npm/%E0%A4%A'), undefined)
  assert.equal(parsePurl(42), undefined)
})

test('nothing blocked: summary only in all mode', () => {
  assert.equal(renderSummary({}, 'errors'), undefined)
  assert.equal(renderSummary({ blocked: [] }, 'errors'), undefined)
  assert.match(renderSummary({}, 'all'), /No packages were blocked/)
})

test('lists blocked packages with socket.dev links', () => {
  const html = renderSummary(
    {
      blocked: [
        {
          purlString: 'pkg:npm/%40evil/pkg@1.0.0',
          registryFqdn: 'registry.npmjs.org',
        },
      ],
    },
    'errors',
  )
  assert.match(html, /Blocked packages \(1\)/)
  assert.match(
    html,
    /<a href="https:\/\/socket.dev\/npm\/package\/%40evil\/pkg\/overview\/1.0.0">@evil\/pkg<\/a>/,
  )
  assert.match(html, /<code>registry.npmjs.org<\/code>/)
})

test('report values cannot inject HTML', () => {
  const html = renderSummary(
    {
      blocked: [
        {
          purlString: 'pkg:npm/x"><script>alert(1)</script>@1',
          registryFqdn: '<img src=x onerror=alert(1)>',
        },
        { purlString: '<b>not a purl</b>', registryFqdn: 'r' },
      ],
      parseFail: [{ urlPath: '/a?<script>', registryFqdn: 'pypi.org' }],
    },
    'all',
  )
  assert.doesNotMatch(html, /<script>|<img|<b>/)
  assert.match(html, /&lt;script&gt;/)
  assert.match(html, /Requests sfw could not parse \(1\)/)
})

test('tolerates malformed reports', () => {
  const html = renderSummary(
    { blocked: [null, {}], parseFail: 'nope' },
    'errors',
  )
  assert.match(html, /Blocked packages \(2\)/)
})
