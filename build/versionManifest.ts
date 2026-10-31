// Emits dist/version.json = { commit, files: { "<path>": "<sha256 hex>" } }
// so anyone can compare the live site with a local rebuild (scripts/verify.ts).
// Runtime imports are node: built-ins only, so scripts/verify.ts can import
// buildManifest under `node --experimental-strip-types` without Vite.
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative, resolve, sep } from 'node:path'
import type { Plugin } from 'vite'

export const MANIFEST_FILE = 'version.json'

export type VersionManifest = {
  commit: string
  files: Record<string, string>
}

export function sha256Hex(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

function listFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...listFiles(full))
    else if (entry.isFile()) out.push(full)
  }
  return out
}

/** Hashes every file under `dir` except the manifest itself. Keys are POSIX paths, sorted. */
export function buildManifest(dir: string, commit: string): VersionManifest {
  const paths = listFiles(dir)
    .map((full) => relative(dir, full).split(sep).join('/'))
    .filter((path) => path !== MANIFEST_FILE)
    .sort()
  const files: Record<string, string> = {}
  for (const path of paths) files[path] = sha256Hex(readFileSync(join(dir, path)))
  return { commit, files }
}

export function resolveCommit(cwd: string, env: NodeJS.ProcessEnv = process.env): string {
  const fromCi = env.GITHUB_SHA?.trim()
  if (fromCi) return fromCi
  return execFileSync('git', ['rev-parse', 'HEAD'], { cwd, encoding: 'utf8' }).trim()
}

export function writeManifest(dir: string, commit: string): VersionManifest {
  const manifest = buildManifest(dir, commit)
  writeFileSync(join(dir, MANIFEST_FILE), JSON.stringify(manifest, null, 2) + '\n')
  return manifest
}

export type VersionManifestOptions = {
  /** Overrides GITHUB_SHA / `git rev-parse HEAD` (tests). */
  commit?: string
}

export function versionManifest(options: VersionManifestOptions = {}): Plugin {
  let root = process.cwd()
  let outDir = 'dist'
  return {
    name: 'duo-chat:version-manifest',
    apply: 'build',
    configResolved(config) {
      root = config.root
      outDir = config.build.outDir
    },
    // closeBundle runs after Vite has written the bundle and copied public/,
    // so walking the output directory sees exactly what will be deployed.
    closeBundle(error?: Error) {
      if (error) return
      const dir = resolve(root, outDir)
      writeManifest(dir, options.commit ?? resolveCommit(root))
    },
  }
}
