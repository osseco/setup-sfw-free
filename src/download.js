import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream } from 'node:fs'
import { rm } from 'node:fs/promises'
import { Readable, Transform } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { setTimeout as sleep } from 'node:timers/promises'

const RELEASE_BASE = 'https://github.com/SocketDev/sfw-free/releases/download'

/**
 * Seconds to wait before each retry; one more attempt is made than there are
 * entries. GitHub release downloads fail with a 5xx now and then, and a
 * minute of patience is cheaper than a re-run.
 */
export const RETRY_DELAYS_SECONDS = [5, 15, 45]

/** Per-attempt timeout. The binaries are around 140 MB. */
const ATTEMPT_TIMEOUT_MS = 5 * 60 * 1000

/**
 * Download URL of one release asset. Only GitHub, only https.
 *
 * @param {string} version sfw-free version without the leading `v`
 * @param {string} asset release asset name
 * @returns {string}
 */
export function assetUrl(version, asset) {
  return `${RELEASE_BASE}/v${encodeURIComponent(version)}/${encodeURIComponent(asset)}`
}

/**
 * Whether a failed attempt is worth repeating. A 4xx means the asset isn't
 * there, except 408 (request timeout) and 429 (rate limited). Errors without
 * a status (DNS, reset, timeout) are transient.
 *
 * @param {unknown} error
 * @returns {boolean}
 */
export function isRetryable(error) {
  const status = /** @type {{ status?: unknown }} */ (error)?.status
  if (typeof status !== 'number') {
    return true
  }
  return status >= 500 || status === 408 || status === 429
}

/**
 * Hex sha256 of a file.
 *
 * @param {string} path
 * @returns {Promise<string>}
 */
export async function sha256File(path) {
  const hash = createHash('sha256')
  await pipeline(createReadStream(path), hash)
  return hash.digest('hex')
}

/**
 * Stream `url` to `dest` and return the sha256 of what was written. Retries
 * transient failures. A partial file is removed before every retry and on
 * failure.
 *
 * @param {string} url
 * @param {string} dest
 * @param {object} [options]
 * @param {typeof fetch} [options.fetch]
 * @param {number[]} [options.delays] seconds before each retry
 * @param {(ms: number) => Promise<unknown>} [options.wait]
 * @param {(message: string) => void} [options.warn]
 * @returns {Promise<string>} hex sha256
 */
export async function downloadFile(
  url,
  dest,
  {
    fetch = globalThis.fetch,
    delays = RETRY_DELAYS_SECONDS,
    wait = sleep,
    warn = () => {},
  } = {},
) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await downloadOnce(fetch, url, dest)
    } catch (error) {
      await rm(dest, { force: true })
      const delay = delays[attempt]
      if (!isRetryable(error) || delay === undefined) {
        throw error
      }
      warn(
        `Download of ${url} failed (attempt ${attempt + 1} of ${delays.length + 1}): ${error.message}. Retrying in ${delay}s.`,
      )
      await wait(delay * 1000)
    }
  }
}

async function downloadOnce(fetch, url, dest) {
  const response = await fetch(url, {
    redirect: 'follow',
    signal: AbortSignal.timeout(ATTEMPT_TIMEOUT_MS),
  })
  if (!response.ok || !response.body) {
    throw Object.assign(
      new Error(`HTTP ${response.status} ${response.statusText}`.trim()),
      { status: response.status },
    )
  }
  // Redirects go to GitHub's asset host; never accept a downgrade to http.
  if (response.url && !response.url.startsWith('https://')) {
    throw Object.assign(new Error(`refusing non-https URL ${response.url}`), {
      status: 400,
    })
  }
  const hash = createHash('sha256')
  const tee = new Transform({
    transform(chunk, _encoding, callback) {
      hash.update(chunk)
      callback(null, chunk)
    },
  })
  await pipeline(Readable.fromWeb(response.body), tee, createWriteStream(dest))
  return hash.digest('hex')
}
