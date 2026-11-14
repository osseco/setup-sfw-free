/** State key the main step stores the report path under. */
export const REPORT_STATE = 'report-path'

/** Allowed values of the `job-summary` input. */
export const JOB_SUMMARY_MODES = ['all', 'errors', 'none']

/**
 * Read and check the `job-summary` input.
 *
 * @param {{ getInput(name: string): string }} core
 * @returns {'all' | 'errors' | 'none'}
 */
export function jobSummaryMode(core) {
  const value = core.getInput('job-summary') || 'errors'
  if (!JOB_SUMMARY_MODES.includes(value)) {
    throw new Error(
      `job-summary must be one of ${JOB_SUMMARY_MODES.join(', ')}; got ${JSON.stringify(value)}`,
    )
  }
  return /** @type {'all' | 'errors' | 'none'} */ (value)
}

const HTML_ESCAPES = {
  '&': '&amp;',
  '<': '&lt;',
  '>': '&gt;',
  '"': '&quot;',
  "'": '&#39;',
}

/**
 * Escape text for HTML content and attribute values. The report comes from
 * package registries, so every value in it is untrusted.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (c) => HTML_ESCAPES[c])
}

/**
 * Parse a package URL (`pkg:type/namespace/name@version?qualifiers#subpath`).
 * Returns undefined for anything that isn't one.
 *
 * @param {unknown} purl
 * @returns {{ type: string, namespace: string, name: string, version: string } | undefined}
 */
export function parsePurl(purl) {
  if (typeof purl !== 'string' || !purl.startsWith('pkg:')) {
    return undefined
  }
  const path = purl.slice(4).split(/[?#]/, 1)[0].replace(/^\/+/, '')
  // The version follows an @ in the last segment; an unencoded @ in an npm
  // scope sits in an earlier one.
  const at = path.indexOf('@', path.lastIndexOf('/') + 1)
  const versionPart = at === -1 ? '' : path.slice(at + 1)
  const segments = (at === -1 ? path : path.slice(0, at)).split('/')
  if (segments.length < 2) {
    return undefined
  }
  try {
    const type = segments[0].toLowerCase()
    const name = decodeURIComponent(segments.at(-1))
    const namespace = segments.slice(1, -1).map(decodeURIComponent).join('/')
    const version = decodeURIComponent(versionPart)
    return name ? { type, namespace, name, version } : undefined
  } catch {
    return undefined
  }
}

function packageLink({ type, namespace, name, version }) {
  const fullName = namespace ? `${namespace}/${name}` : name
  const path = [type, 'package', ...fullName.split('/')]
    .map(encodeURIComponent)
    .join('/')
  const href = `https://socket.dev/${path}${version ? `/overview/${encodeURIComponent(version)}` : ''}`
  return `<a href="${escapeHtml(href)}">${escapeHtml(fullName)}</a>`
}

function table(headers, rows) {
  const head = headers.map((h) => `<th>${h}</th>`).join('')
  const body = rows
    .map((cells) => `<tr>${cells.map((c) => `<td>${c}</td>`).join('')}</tr>`)
    .join('')
  return `<table><tr>${head}</tr>${body}</table>`
}

const code = (value) => `<code>${escapeHtml(value)}</code>`

/**
 * Job summary HTML for an sfw report, or undefined when there is nothing to
 * show in this mode.
 *
 * @param {{ blocked?: unknown, parseFail?: unknown }} report
 * @param {'all' | 'errors'} mode
 * @returns {string | undefined}
 */
export function renderSummary(report, mode) {
  const blocked = Array.isArray(report?.blocked) ? report.blocked : []
  const parseFail = Array.isArray(report?.parseFail) ? report.parseFail : []
  if (blocked.length === 0 && parseFail.length === 0) {
    return mode === 'all'
      ? '<h2>Socket Firewall Free</h2>\n<p>No packages were blocked.</p>\n'
      : undefined
  }

  let html = '<h2>Socket Firewall Free</h2>\n'
  if (blocked.length > 0) {
    const rows = blocked.map((entry) => {
      const purl = parsePurl(entry?.purlString)
      return purl
        ? [packageLink(purl), code(purl.version), code(entry.registryFqdn)]
        : [code(entry?.purlString), '', code(entry?.registryFqdn)]
    })
    html += `<h3>Blocked packages (${blocked.length})</h3>\n`
    html += `${table(['Package', 'Version', 'Registry'], rows)}\n`
  }
  if (parseFail.length > 0) {
    const rows = parseFail.map((entry) => [
      code(entry?.urlPath),
      code(entry?.registryFqdn),
    ])
    html += `<h3>Requests sfw could not parse (${parseFail.length})</h3>\n`
    html += `${table(['URL', 'Registry'], rows)}\n`
  }
  return html
}
