// Checks that a live duo-chat site is built from this repository.
//
//   node --experimental-strip-types scripts/verify.ts https://<site> [--keep]
//
// 1. Downloads <site>/version.json: the commit the site claims and a SHA-256 per file.
// 2. Checks that commit out into a temporary git worktree and builds it there
//    (pnpm install --frozen-lockfile && pnpm build), exactly as CI does.
// 3. Compares three things file by file: the local rebuild, the live manifest, and
//    the bytes the site actually serves. Also compares the live security headers
//    with the rebuilt public/_headers.
// Exit code 0 only if everything matches.
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { buildManifest, MANIFEST_FILE, sha256Hex, type VersionManifest } from '../build/versionManifest.ts'

/** Files Cloudflare reads as configuration and never serves. */
export const CONFIG_FILES: ReadonlySet<string> = new Set(['_headers', '_redirects'])

/** Headers from _headers that must match on the live site. */
export const CHECKED_HEADERS: readonly string[] = [
  'content-security-policy',
  'referrer-policy',
  'permissions-policy',
  'x-content-type-options',
]

export type Problem = { file: string; reason: string }

export function parseManifest(value: unknown): VersionManifest {
  const v = value as Partial<VersionManifest> | null
  if (!v || typeof v.commit !== 'string' || !/^[0-9a-f]{40}$/.test(v.commit)) {
    throw new Error('version.json: "commit" must be a 40-char hex git sha')
  }
  if (!v.files || typeof v.files !== 'object') throw new Error('version.json: "files" missing')
  for (const [path, hash] of Object.entries(v.files)) {
    if (typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash)) {
      throw new Error(`version.json: bad sha256 for ${path}`)
    }
  }
  return { commit: v.commit, files: v.files }
}

/** Every difference between the rebuilt manifest and the one the site serves. */
export function compareManifests(local: VersionManifest, live: VersionManifest): Problem[] {
  const problems: Problem[] = []
  if (local.commit !== live.commit) {
    problems.push({ file: MANIFEST_FILE, reason: `commit ${live.commit} on site, ${local.commit} rebuilt` })
  }
  for (const [path, hash] of Object.entries(local.files)) {
    const other = live.files[path]
    if (other === undefined) problems.push({ file: path, reason: 'built locally, missing from live manifest' })
    else if (other !== hash) problems.push({ file: path, reason: 'live manifest hash differs from rebuild' })
  }
  for (const path of Object.keys(live.files)) {
    if (!(path in local.files)) problems.push({ file: path, reason: 'in live manifest, not produced by rebuild' })
  }
  return problems
}

/** Parses Cloudflare's _headers format into { pattern: { lower-case name: value } }. */
export function parseHeadersFile(text: string): Record<string, Record<string, string>> {
  const rules: Record<string, Record<string, string>> = {}
  let current: Record<string, string> | undefined
  for (const raw of text.split(/\r?\n/)) {
    if (!raw.trim() || raw.trim().startsWith('#')) continue
    if (!/^\s/.test(raw)) {
      current = rules[raw.trim()] ??= {}
      continue
    }
    const colon = raw.indexOf(':')
    if (!current || colon < 0) continue
    current[raw.slice(0, colon).trim().toLowerCase()] = raw.slice(colon + 1).trim()
  }
  return rules
}

export function compareHeaders(expected: Record<string, string>, live: Headers): Problem[] {
  const problems: Problem[] = []
  for (const name of CHECKED_HEADERS) {
    const want = expected[name]
    if (want === undefined) continue
    const got = live.get(name)
    if (got !== want) problems.push({ file: '_headers', reason: `${name} on site is ${JSON.stringify(got)}, expected ${JSON.stringify(want)}` })
  }
  return problems
}

function run(cmd: string, args: string[], cwd: string, env: NodeJS.ProcessEnv = process.env): string {
  return execFileSync(cmd, args, { cwd, env, encoding: 'utf8', stdio: ['ignore', 'pipe', 'inherit'] })
}

async function fetchOk(url: string): Promise<Response> {
  const res = await fetch(url, { cache: 'no-store', redirect: 'follow' })
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`)
  return res
}

async function hashLiveFiles(site: string, paths: string[], expected: Record<string, string>): Promise<Problem[]> {
  const problems: Problem[] = []
  const queue = [...paths]
  const worker = async (): Promise<void> => {
    for (let path = queue.shift(); path !== undefined; path = queue.shift()) {
      try {
        const res = await fetchOk(new URL(path, site).href)
        const hash = sha256Hex(new Uint8Array(await res.arrayBuffer()))
        if (hash !== expected[path]) problems.push({ file: path, reason: 'served bytes differ from rebuild' })
      } catch (e) {
        problems.push({ file: path, reason: (e as Error).message })
      }
    }
  }
  await Promise.all(Array.from({ length: 8 }, worker))
  return problems
}

async function main(): Promise<void> {
  const args = process.argv.slice(2)
  const keep = args.includes('--keep')
  const siteArg = args.find((a) => !a.startsWith('--'))
  if (!siteArg) {
    console.error('usage: node --experimental-strip-types scripts/verify.ts https://<site> [--keep]')
    process.exit(2)
  }
  const site = new URL(siteArg).origin + '/'
  const repo = run('git', ['rev-parse', '--show-toplevel'], process.cwd()).trim()

  const pinnedNode = readFileSync(join(repo, '.node-version'), 'utf8').trim()
  if (process.version !== `v${pinnedNode}`) {
    console.warn(`warning: running Node ${process.version}, CI builds with v${pinnedNode}; output may differ`)
  }

  console.log(`1/4 fetching ${site}${MANIFEST_FILE}`)
  const liveManifestText = await (await fetchOk(new URL(MANIFEST_FILE, site).href)).text()
  const live = parseManifest(JSON.parse(liveManifestText))
  console.log(`    site claims commit ${live.commit}, ${Object.keys(live.files).length} files`)

  try {
    run('git', ['cat-file', '-e', `${live.commit}^{commit}`], repo)
  } catch {
    console.log('    commit not in local clone, fetching it from origin')
    run('git', ['fetch', '--quiet', 'origin', live.commit], repo)
  }

  const dir = mkdtempSync(join(tmpdir(), 'duo-chat-verify-'))
  const tree = join(dir, 'tree')
  const problems: Problem[] = []
  try {
    console.log(`2/4 building ${live.commit} in ${tree}`)
    run('git', ['worktree', 'add', '--detach', '--quiet', tree, live.commit], repo)
    // Match CI: NODE_ENV unset. NODE_ENV=development gives a dev Vue build,
    // NODE_ENV=production makes pnpm skip devDependencies.
    const env: NodeJS.ProcessEnv = { ...process.env, GITHUB_SHA: live.commit, CI: 'true' }
    delete env.NODE_ENV
    run('pnpm', ['install', '--frozen-lockfile'], tree, env)
    run('pnpm', ['build'], tree, env)
    const dist = join(tree, 'dist')
    const local = buildManifest(dist, live.commit)

    console.log('3/4 comparing rebuild with the live manifest')
    problems.push(...compareManifests(local, live))
    const rebuiltManifest = join(dist, MANIFEST_FILE)
    if (!existsSync(rebuiltManifest)) {
      problems.push({ file: MANIFEST_FILE, reason: 'rebuild did not emit version.json (plugin not wired?)' })
    } else if (readFileSync(rebuiltManifest, 'utf8') !== liveManifestText) {
      problems.push({ file: MANIFEST_FILE, reason: 'served version.json differs from the rebuilt one' })
    }

    console.log('4/4 downloading every served file and its headers')
    const served = Object.keys(local.files).filter((p) => !CONFIG_FILES.has(p))
    problems.push(...(await hashLiveFiles(site, served, local.files)))
    const headersFile = join(dist, '_headers')
    if (existsSync(headersFile)) {
      const rules = parseHeadersFile(readFileSync(headersFile, 'utf8'))
      const root = await fetchOk(site)
      problems.push(...compareHeaders(rules['/*'] ?? {}, root.headers))
    } else {
      problems.push({ file: '_headers', reason: 'rebuild has no _headers' })
    }
  } finally {
    if (keep) console.log(`    kept ${tree}`)
    else {
      try {
        run('git', ['worktree', 'remove', '--force', tree], repo)
      } catch {
        /* the worktree may not exist if checkout failed */
      }
      rmSync(dir, { recursive: true, force: true })
    }
  }

  if (problems.length === 0) {
    console.log(`\nPASS: ${site} serves exactly what commit ${live.commit} builds to.`)
    return
  }
  console.error(`\nFAIL: ${problems.length} difference(s):`)
  for (const p of problems) console.error(`  ${p.file}: ${p.reason}`)
  process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((e: unknown) => {
    console.error(`FAIL: ${(e as Error).message}`)
    process.exitCode = 1
  })
}
