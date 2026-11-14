// Bundles the action entry points into dist/. The output is committed and CI
// fails when it differs from a fresh build, so keep the build deterministic:
// no timestamps, no sourcemaps, a fixed target, sorted notices.
import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { build } from 'esbuild'

const result = await build({
  entryPoints: { main: 'src/index.js', post: 'src/post-index.js' },
  outdir: 'dist',
  outExtension: { '.js': '.cjs' },
  bundle: true,
  platform: 'node',
  target: 'node24',
  // Tree shaking depends on the input modules, not the output format. Prefer
  // ESM entries for packages without an exports map (esbuild's node default
  // is main first).
  mainFields: ['module', 'main'],
  format: 'cjs',
  legalComments: 'eof',
  metafile: true,
  logLevel: 'info',
})

await writeFile(
  'dist/THIRD-PARTY-LICENSES.txt',
  await thirdPartyLicenses(result.metafile),
)

/**
 * License texts of every package bundled into dist/. The bundles are copies
 * of these packages, and their licenses ask for the text to travel with them.
 */
async function thirdPartyLicenses(metafile) {
  const roots = new Set()
  for (const input of Object.keys(metafile.inputs)) {
    const at = input.lastIndexOf('node_modules/')
    if (at === -1) continue
    const rest = input.slice(at + 'node_modules/'.length).split('/')
    const depth = rest[0].startsWith('@') ? 2 : 1
    roots.add(
      input.slice(0, at) + ['node_modules', ...rest.slice(0, depth)].join('/'),
    )
  }

  const sections = []
  for (const root of roots) {
    const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'))
    const files = (await readdir(root))
      .filter((name) => /^(licen[cs]e|notice|copying)/i.test(name))
      .sort()
    const texts = await Promise.all(
      files.map(async (name) =>
        (await readFile(join(root, name), 'utf8')).trim(),
      ),
    )
    sections.push(
      [
        `${pkg.name}@${pkg.version}`,
        `License: ${pkg.license ?? 'see below'}`,
        '',
        texts.length > 0
          ? texts.join('\n\n')
          : `(the package ships no license file; its package.json declares ${pkg.license})`,
      ].join('\n'),
    )
  }
  sections.sort()
  const rule = `\n\n${'-'.repeat(78)}\n\n`
  return `Third-party software bundled in dist/main.cjs and dist/post.cjs.\nThis action itself is MIT licensed, see LICENSE.${rule}${sections.join(rule)}\n`
}
