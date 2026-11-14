import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { test } from 'node:test'
import { readmeVersion, setReadmeVersion } from '../src/readme.js'

const marker = (v) => `<!-- sfw-free-version -->${v}<!-- /sfw-free-version -->`

test('the README states the pinned sfw-free version', async () => {
  const readme = await readFile(
    new URL('../README.md', import.meta.url),
    'utf8',
  )
  const pinned = JSON.parse(
    await readFile(new URL('../sfw-free.json', import.meta.url), 'utf8'),
  )
  assert.equal(readmeVersion(readme), pinned.version)
})

test('reads and sets every marker', () => {
  const text = `a ${marker('1.0.0')} b ${marker('1.0.0')} c`
  assert.equal(readmeVersion(text), '1.0.0')
  assert.equal(
    setReadmeVersion(text, '2.3.4'),
    `a ${marker('2.3.4')} b ${marker('2.3.4')} c`,
  )
})

test('refuses a README without markers or with disagreeing ones', () => {
  assert.throws(() => readmeVersion('no marker'), /no <!-- sfw-free-version/)
  assert.throws(
    () => readmeVersion(`${marker('1.0.0')} ${marker('1.0.1')}`),
    /disagree/,
  )
  assert.throws(() => setReadmeVersion('no marker', '1.0.0'), /no </)
})

test('refuses to write anything but X.Y.Z', () => {
  assert.throws(() => setReadmeVersion(marker('1.0.0'), '1.0.0 -->'), /invalid/)
})
