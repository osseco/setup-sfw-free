/**
 * sfw-free release asset for each platform key. The key is Node's
 * `<platform>-<arch>`, with `-musl` for Linux builds against musl libc.
 * A platform missing here has no sfw-free build, and the action fails
 * instead of guessing.
 */
export const ASSET_NAMES = {
  'darwin-arm64': 'sfw-free-macos-arm64',
  'darwin-x64': 'sfw-free-macos-x86_64',
  'linux-arm64': 'sfw-free-linux-arm64',
  'linux-arm64-musl': 'sfw-free-musl-linux-arm64',
  'linux-x64': 'sfw-free-linux-x86_64',
  'linux-x64-musl': 'sfw-free-musl-linux-x86_64',
  'win32-arm64': 'sfw-free-windows-arm64.exe',
  'win32-x64': 'sfw-free-windows-x86_64.exe',
}

/**
 * Whether this Linux process runs on musl. glibc builds of Node report the
 * runtime glibc version; musl builds don't.
 *
 * @param {{ getReport(): { header: { glibcVersionRuntime?: string } } }} report
 * @returns {boolean}
 */
export function isMusl(report = process.report) {
  return !report.getReport().header.glibcVersionRuntime
}

/**
 * Platform key for `ASSET_NAMES`.
 *
 * @param {{ platform: string, arch: string, musl: boolean }} host
 * @returns {string}
 */
export function platformKey({ platform, arch, musl }) {
  const key = `${platform}-${arch}${platform === 'linux' && musl ? '-musl' : ''}`
  if (!Object.hasOwn(ASSET_NAMES, key)) {
    throw new Error(`sfw-free has no build for ${key}`)
  }
  return key
}

/**
 * File name sfw is installed as. Windows needs the suffix to run it from
 * cmd.exe and PowerShell.
 *
 * @param {string} platform
 * @returns {string}
 */
export function binaryName(platform) {
  return platform === 'win32' ? 'sfw.exe' : 'sfw'
}
