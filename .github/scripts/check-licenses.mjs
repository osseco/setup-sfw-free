#!/usr/bin/env node
// Fails when a production dependency, all of which end up bundled in dist/,
// has a license outside the allowlist. Reads `pnpm licenses list --prod
// --json` from stdin:
//
//   pnpm licenses list --prod --json | node .github/scripts/check-licenses.mjs
import { text } from 'node:stream/consumers'

export const ALLOWED = new Set([
  '0BSD',
  'Apache-2.0',
  'BlueOak-1.0.0',
  'BSD-2-Clause',
  'BSD-3-Clause',
  'ISC',
  'MIT',
])

/**
 * Whether an SPDX expression is acceptable: any branch of an OR, every part
 * of an AND. Nested parentheses are not used by our dependencies; an
 * expression mixing AND and OR is rejected so a human looks at it.
 *
 * @param {string} expression
 * @returns {boolean}
 */
export function isAllowed(expression) {
  const bare = expression.replace(/[()]/g, '').trim()
  const hasOr = / OR /.test(bare)
  const hasAnd = / AND /.test(bare)
  if (hasOr && hasAnd) {
    return false
  }
  const parts = bare.split(hasOr ? ' OR ' : ' AND ').map((p) => p.trim())
  return hasOr
    ? parts.some((p) => ALLOWED.has(p))
    : parts.every((p) => ALLOWED.has(p))
}

/**
 * Packages whose license is not allowed.
 *
 * @param {Record<string, { name: string, versions: string[] }[]>} report
 * @returns {string[]}
 */
export function disallowed(report) {
  return Object.entries(report)
    .filter(([license]) => !isAllowed(license))
    .flatMap(([license, packages]) =>
      packages.map((p) => `${p.name}@${p.versions.join(',')}: ${license}`),
    )
}

if (import.meta.main) {
  const problems = disallowed(JSON.parse(await text(process.stdin)))
  if (problems.length > 0) {
    console.error(`Licenses outside the allowlist:\n${problems.join('\n')}`)
    process.exit(1)
  }
  console.log('All production dependency licenses are allowed')
}
