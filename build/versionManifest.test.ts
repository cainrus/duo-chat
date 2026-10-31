import { createHash } from 'node:crypto'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { build } from 'vite'
import { buildManifest, MANIFEST_FILE, resolveCommit, versionManifest, writeManifest } from './versionManifest'

const sha = (s: string) => createHash('sha256').update(s).digest('hex')
const COMMIT = 'a'.repeat(40)

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'duo-chat-manifest-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('buildManifest', () => {
  it('hashes every file, nested ones with POSIX paths, keys sorted', () => {
    mkdirSync(join(dir, 'assets', 'deep'), { recursive: true })
    writeFileSync(join(dir, 'index.html'), '<html></html>')
    writeFileSync(join(dir, 'assets', 'b.js'), 'b')
    writeFileSync(join(dir, 'assets', 'deep', 'a.css'), 'a')
    writeFileSync(join(dir, '_headers'), '/*\n  X: y\n')

    const m = buildManifest(dir, COMMIT)

    expect(m.commit).toBe(COMMIT)
    expect(Object.keys(m.files)).toEqual(['_headers', 'assets/b.js', 'assets/deep/a.css', 'index.html'])
    expect(m.files['assets/b.js']).toBe(sha('b'))
    expect(m.files['index.html']).toBe(sha('<html></html>'))
  })

  it('excludes the manifest itself, so a second run is stable', () => {
    writeFileSync(join(dir, 'index.html'), 'x')
    const first = writeManifest(dir, COMMIT)
    const firstText = readFileSync(join(dir, MANIFEST_FILE), 'utf8')
    const second = writeManifest(dir, COMMIT)

    expect(first.files).not.toHaveProperty(MANIFEST_FILE)
    expect(second).toEqual(first)
    expect(readFileSync(join(dir, MANIFEST_FILE), 'utf8')).toBe(firstText)
    expect(JSON.parse(firstText)).toEqual({ commit: COMMIT, files: { 'index.html': sha('x') } })
  })
})

describe('resolveCommit', () => {
  it('prefers GITHUB_SHA', () => {
    expect(resolveCommit(dir, { GITHUB_SHA: ' ' + COMMIT + '\n' })).toBe(COMMIT)
  })

  it('falls back to git rev-parse HEAD', () => {
    expect(resolveCommit(process.cwd(), {})).toMatch(/^[0-9a-f]{40}$/)
  })
})

describe('versionManifest plugin', () => {
  it('writes version.json covering bundle output and public/ files after a real build', async () => {
    mkdirSync(join(dir, 'public'))
    writeFileSync(join(dir, 'public', '_headers'), '/*\n  Referrer-Policy: no-referrer\n')
    writeFileSync(join(dir, 'main.js'), 'document.title = "hi"\n')
    writeFileSync(join(dir, 'index.html'), '<!doctype html><script type="module" src="/main.js"></script>')

    await build({
      root: dir,
      configFile: false,
      logLevel: 'silent',
      plugins: [versionManifest({ commit: COMMIT })],
    })

    const out = join(dir, 'dist')
    const manifest = JSON.parse(readFileSync(join(out, MANIFEST_FILE), 'utf8'))
    expect(manifest).toEqual(buildManifest(out, COMMIT))
    const paths = Object.keys(manifest.files)
    expect(paths).toContain('index.html')
    expect(paths).toContain('_headers')
    expect(paths.some((p) => /^assets\/.+\.js$/.test(p))).toBe(true)
    expect(paths).not.toContain(MANIFEST_FILE)
  })
})
