const OPEN = '<!-- sfw-free-version -->'
const CLOSE = '<!-- /sfw-free-version -->'
const MARKER = /<!-- sfw-free-version -->([^<]*)<!-- \/sfw-free-version -->/g

/**
 * The sfw-free version written between the README markers. Every marker
 * must hold the same version.
 *
 * @param {string} text README contents
 * @returns {string}
 */
export function readmeVersion(text) {
  const versions = [...text.matchAll(MARKER)].map((m) => m[1])
  if (versions.length === 0) {
    throw new Error(`README.md has no ${OPEN}…${CLOSE} marker`)
  }
  if (new Set(versions).size > 1) {
    throw new Error(
      `README.md markers disagree: ${[...new Set(versions)].join(', ')}`,
    )
  }
  return versions[0]
}

/**
 * README contents with every marker set to `version`.
 *
 * @param {string} text README contents
 * @param {string} version X.Y.Z
 * @returns {string}
 */
export function setReadmeVersion(text, version) {
  if (!/^\d+\.\d+\.\d+$/.test(version)) {
    throw new Error(`invalid version ${JSON.stringify(version)}`)
  }
  readmeVersion(text)
  return text.replace(MARKER, `${OPEN}${version}${CLOSE}`)
}
