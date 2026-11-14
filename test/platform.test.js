import assert from 'node:assert/strict'
import { test } from 'node:test'
import { binaryName, isMusl, platformKey } from '../src/platform.js'

const report = (glibcVersionRuntime) => ({
  getReport: () => ({ header: { glibcVersionRuntime } }),
})

test('glibc and musl are told apart by the runtime glibc version', () => {
  assert.equal(isMusl(report('2.39')), false)
  assert.equal(isMusl(report(undefined)), true)
})

test('maps every hosted runner platform', () => {
  assert.equal(
    platformKey({ platform: 'linux', arch: 'x64', musl: false }),
    'linux-x64',
  )
  assert.equal(
    platformKey({ platform: 'linux', arch: 'arm64', musl: true }),
    'linux-arm64-musl',
  )
  assert.equal(
    platformKey({ platform: 'darwin', arch: 'arm64', musl: false }),
    'darwin-arm64',
  )
  assert.equal(
    platformKey({ platform: 'win32', arch: 'x64', musl: false }),
    'win32-x64',
  )
})

test('musl only applies to Linux', () => {
  assert.equal(
    platformKey({ platform: 'darwin', arch: 'x64', musl: true }),
    'darwin-x64',
  )
})

test('rejects platforms without a build', () => {
  assert.throws(
    () => platformKey({ platform: 'freebsd', arch: 'x64', musl: false }),
    /no build for freebsd-x64/,
  )
  assert.throws(
    () => platformKey({ platform: 'linux', arch: 'toString', musl: false }),
    /no build/,
  )
})

test('Windows binary keeps the .exe suffix', () => {
  assert.equal(binaryName('win32'), 'sfw.exe')
  assert.equal(binaryName('linux'), 'sfw')
})
