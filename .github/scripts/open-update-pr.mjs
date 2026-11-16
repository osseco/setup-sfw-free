#!/usr/bin/env node
// Turn what `pnpm update-sfw-free X.Y.Z` staged into a pull request. Run by
// the sfw-free-update workflow with a GitHub App token:
//
//   GH_TOKEN=… GITHUB_REPOSITORY=owner/repo VERSION=X.Y.Z BODY_FILE=… \
//     node .github/scripts/open-update-pr.mjs
//
// 1. Reads the staged files; refuses any path the update doesn't change.
// 2. Creates feat/update_sfw_free_X.Y.Z on GitHub at the local HEAD
//    (origin/main), failing if the branch already exists.
// 3. Commits the staged files with GraphQL createCommitOnBranch, so GitHub
//    signs the commit. Nothing is pushed with git.
// 4. Opens the pull request.
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  branchName,
  CHANGED_PATHS,
  makeExec,
} from '../../scripts/update-sfw-free.mjs'

const API = 'https://api.github.com'
const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))

/** @param {string} version */
export const commitMessage = (version) =>
  `feat(sfw): update sfw-free to ${version}`

/** @param {string} path */
const isChangedPath = (path) =>
  CHANGED_PATHS.some((p) => (p.endsWith('/') ? path.startsWith(p) : path === p))

/**
 * The staged changes as createCommitOnBranch file changes.
 *
 * @param {ReturnType<typeof makeExec>} exec
 * @param {string} root repository root
 * @returns {Promise<{ additions: { path: string, contents: string }[], deletions: { path: string }[] }>}
 */
export async function fileChanges(exec, root) {
  const { stdout } = await exec(
    'git',
    ['diff', '--cached', '--name-status', '--no-renames', '-z'],
    { capture: true },
  )
  const fields = stdout.split('\0').filter((f) => f !== '')
  const additions = []
  const deletions = []
  for (let i = 0; i < fields.length; i += 2) {
    const [status, path] = [fields[i], fields[i + 1]]
    if (!isChangedPath(path)) {
      throw new Error(`refusing to commit unexpected path ${path}`)
    }
    if (status === 'D') {
      deletions.push({ path })
    } else if (status === 'A' || status === 'M') {
      const contents = await readFile(join(root, path))
      additions.push({ path, contents: contents.toString('base64') })
    } else {
      throw new Error(`unexpected status ${status} for ${path}`)
    }
  }
  if (additions.length === 0 && deletions.length === 0) {
    throw new Error('nothing is staged')
  }
  return { additions, deletions }
}

/**
 * Create the branch, commit the staged changes and open the pull request.
 * Every side effect is a parameter so tests can pass fakes.
 *
 * @param {object} options
 * @param {string} options.version
 * @param {string} options.repository owner/repo
 * @param {string} options.token
 * @param {string} options.body pull request body
 * @param {string} [options.root] repository root
 * @param {ReturnType<typeof makeExec>} [options.exec]
 * @param {typeof fetch} [options.fetch]
 * @param {(message: string) => void} [options.log]
 * @returns {Promise<string>} the pull request URL
 */
export async function openUpdatePr({
  version,
  repository,
  token,
  body,
  root = REPO_ROOT,
  exec = makeExec(root),
  fetch = globalThis.fetch,
  log = console.log,
}) {
  if (!/^\d+\.\d+\.\d+$/.test(version ?? '')) {
    throw new Error(`invalid version ${version}`)
  }
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository ?? '')) {
    throw new Error(`invalid repository ${repository}`)
  }
  if (!token) {
    throw new Error('GH_TOKEN is not set')
  }
  const branch = branchName(version)
  const changes = await fileChanges(exec, root)
  const head = (
    await exec('git', ['rev-parse', 'HEAD'], { capture: true })
  ).stdout.trim()

  const call = async (method, path, payload) => {
    const response = await fetch(`${API}${path}`, {
      method,
      headers: {
        accept: 'application/vnd.github+json',
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    })
    const json = await response.json().catch(() => ({}))
    if (!response.ok) {
      throw new Error(
        `GitHub API: HTTP ${response.status} for ${method} ${path}: ${json.message ?? ''}`,
      )
    }
    if (json.errors?.length) {
      throw new Error(`GitHub API: ${json.errors.map((e) => e.message)}`)
    }
    return json
  }

  await call('POST', `/repos/${repository}/git/refs`, {
    ref: `refs/heads/${branch}`,
    sha: head,
  }).catch((error) => {
    throw new Error(`could not create branch ${branch}: ${error.message}`)
  })
  log(`Created ${branch} at ${head}`)

  const commit = await call('POST', '/graphql', {
    query: `mutation ($input: CreateCommitOnBranchInput!) {
  createCommitOnBranch(input: $input) { commit { oid } }
}`,
    variables: {
      input: {
        branch: { repositoryNameWithOwner: repository, branchName: branch },
        expectedHeadOid: head,
        message: { headline: commitMessage(version) },
        fileChanges: changes,
      },
    },
  })
  log(`Committed ${commit.data.createCommitOnBranch.commit.oid}`)

  const pull = await call('POST', `/repos/${repository}/pulls`, {
    title: commitMessage(version),
    head: branch,
    base: 'main',
    body,
  })
  log(`Opened ${pull.html_url}`)
  return pull.html_url
}

if (import.meta.main) {
  const { GH_TOKEN, GITHUB_REPOSITORY, VERSION, BODY_FILE } = process.env
  readFile(BODY_FILE ?? '', 'utf8')
    .then((body) =>
      openUpdatePr({
        version: VERSION,
        repository: GITHUB_REPOSITORY,
        token: GH_TOKEN,
        body,
      }),
    )
    .catch((error) => {
      console.error(error.message)
      process.exit(1)
    })
}
