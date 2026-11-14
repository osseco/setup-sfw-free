import { readFile } from 'node:fs/promises'
import * as actionsCore from '@actions/core'
import { jobSummaryMode, REPORT_STATE, renderSummary } from './summary.js'

/**
 * Write the sfw report from this job into the job summary. Nothing here
 * fails the job: a missing or unreadable report is logged and skipped.
 *
 * @param {object} [deps]
 * @param {typeof actionsCore} [deps.core]
 */
export async function run({ core = actionsCore } = {}) {
  const mode = jobSummaryMode(core)
  const reportPath = core.getState(REPORT_STATE)
  if (mode === 'none' || !reportPath) {
    return
  }

  let report
  try {
    report = JSON.parse(await readFile(reportPath, 'utf8'))
  } catch (error) {
    if (error.code === 'ENOENT') {
      core.info('sfw wrote no report in this job; no summary')
    } else {
      core.warning(`Could not read the sfw report: ${error.message}`)
    }
    return
  }

  const html = renderSummary(report, mode)
  if (html === undefined) {
    core.info('sfw blocked nothing; no summary')
    return
  }
  await core.summary.addRaw(html).write()
}
