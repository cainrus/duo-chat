// Fails if the built site mentions any absolute or protocol-relative URL other than
// XML namespaces. The app must make no third-party requests, and a reviewer grepping
// dist/ for hosts should find nothing (see docs/ui-framework.md, section 5).
//
// Usage: node --experimental-strip-types scripts/check-dist-urls.ts [dir=dist]
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import { pathToFileURL } from 'node:url'

/** URL prefixes that are identifiers, not network requests. */
export const DEFAULT_ALLOW: readonly string[] = [
  'http://www.w3.org/2000/svg',
  'http://www.w3.org/1999/xlink',
  'http://www.w3.org/1999/xhtml',
  'http://www.w3.org/1998/Math/MathML',
  'http://www.w3.org/XML/1998/namespace',
  // Vue's production runtime prints this link in console error text; nothing fetches it.
  'https://vuejs.org/error-reference',
]

// Absolute URLs with a network scheme, and protocol-relative URLs in the places a
// browser would fetch them (CSS url(), src/href/action attributes, `//host` strings
// used as fallbacks).
const ABSOLUTE = /\b(?:https?|wss?|ftp):\/\/[^\s"'`<>()\\]+/gi
const PROTOCOL_RELATIVE =
  /(?:url\(\s*["']?|\b(?:src|href|action|srcset)\s*=\s*["']?)(\/\/[a-z0-9.-]+\.[a-z]{2,}[^\s"'`<>()\\]*)/gi

export function findUrls(text: string): string[] {
  const found: string[] = []
  for (const m of text.matchAll(ABSOLUTE)) found.push(m[0])
  for (const m of text.matchAll(PROTOCOL_RELATIVE)) if (m[1]) found.push(m[1])
  return found
}

export function isAllowed(url: string, allow: readonly string[] = DEFAULT_ALLOW): boolean {
  return allow.some((prefix) => url === prefix || url.startsWith(prefix + '/') || url.startsWith(prefix + '#'))
}

export type UrlViolation = { file: string; url: string }

function listFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listFiles(full))
    else if (entry.isFile()) out.push(full)
  }
  return out
}

/** Scans every file (binary files too: an embedded font can carry a URL string). */
export function checkDir(dir: string, allow: readonly string[] = DEFAULT_ALLOW): UrlViolation[] {
  const violations: UrlViolation[] = []
  for (const full of listFiles(dir).sort()) {
    const file = relative(dir, full).split(sep).join('/')
    const text = readFileSync(full).toString('latin1')
    for (const url of new Set(findUrls(text))) {
      if (!isAllowed(url, allow)) violations.push({ file, url })
    }
  }
  return violations
}

function main(): void {
  const dir = resolve(process.argv[2] ?? 'dist')
  if (!existsSync(dir)) {
    console.error(`check-dist-urls: ${dir} does not exist, run pnpm build first`)
    process.exitCode = 1
    return
  }
  const violations = checkDir(dir)
  if (violations.length === 0) {
    console.log(`check-dist-urls: OK, no external URLs in ${dir}`)
    return
  }
  console.error(`check-dist-urls: FAIL, ${violations.length} external URL(s) in ${dir}:`)
  for (const v of violations) console.error(`  ${v.file}: ${v.url}`)
  process.exitCode = 1
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) main()
