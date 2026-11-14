// Bundles the action entry points into dist/. The output is committed and CI
// fails when it differs from a fresh build, so keep the build deterministic:
// no timestamps, no sourcemaps, a fixed target.
import { build } from 'esbuild'

await build({
  entryPoints: { main: 'src/index.js' },
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
  logLevel: 'info',
})
