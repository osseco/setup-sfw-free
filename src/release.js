import { ASSET_NAMES } from './platform.js'

const VERSION = /^\d+\.\d+\.\d+$/
const SHA256 = /^[0-9a-f]{64}$/

/**
 * Check the shape of a pinned release, so a bad edit to sfw-free.json fails
 * loudly instead of producing an odd URL or comparing against garbage.
 *
 * @param {unknown} release
 * @returns {{ version: string, publishedAt: string, assets: Record<string, { name: string, sha256: string }> }}
 */
export function validateRelease(release) {
  const { version, publishedAt, assets } = /** @type {any} */ (release) ?? {}
  if (typeof version !== 'string' || !VERSION.test(version)) {
    throw new Error(`sfw-free.json: invalid version ${JSON.stringify(version)}`)
  }
  if (Number.isNaN(Date.parse(publishedAt))) {
    throw new Error(
      `sfw-free.json: invalid publishedAt ${JSON.stringify(publishedAt)}`,
    )
  }
  for (const [key, name] of Object.entries(ASSET_NAMES)) {
    const asset = assets?.[key]
    if (asset?.name !== name) {
      throw new Error(`sfw-free.json: ${key} must be ${name}`)
    }
    if (typeof asset.sha256 !== 'string' || !SHA256.test(asset.sha256)) {
      throw new Error(`sfw-free.json: invalid sha256 for ${key}`)
    }
  }
  const extra = Object.keys(assets).filter((key) => !(key in ASSET_NAMES))
  if (extra.length > 0) {
    throw new Error(`sfw-free.json: unknown assets ${extra.join(', ')}`)
  }
  return /** @type {any} */ (release)
}
