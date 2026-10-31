import { describe, expect, it } from 'vitest'
import { compareHeaders, compareManifests, parseHeadersFile, parseManifest } from './verify'

const C1 = '1'.repeat(40)
const C2 = '2'.repeat(40)
const H1 = 'a'.repeat(64)
const H2 = 'b'.repeat(64)

describe('parseManifest', () => {
  it('accepts a well-formed manifest', () => {
    expect(parseManifest({ commit: C1, files: { 'index.html': H1 } })).toEqual({ commit: C1, files: { 'index.html': H1 } })
  })

  it('rejects a short commit or a bad hash', () => {
    expect(() => parseManifest({ commit: 'abc', files: {} })).toThrow(/commit/)
    expect(() => parseManifest({ commit: C1, files: { a: 'xyz' } })).toThrow(/sha256/)
    expect(() => parseManifest(null)).toThrow()
  })
})

describe('compareManifests', () => {
  it('is empty when identical', () => {
    const m = { commit: C1, files: { a: H1 } }
    expect(compareManifests(m, structuredClone(m))).toEqual([])
  })

  it('reports commit, hash, missing and extra files', () => {
    const local = { commit: C1, files: { a: H1, b: H1 } }
    const live = { commit: C2, files: { a: H2, c: H1 } }
    expect(compareManifests(local, live).map((p) => p.file)).toEqual(['version.json', 'a', 'b', 'c'])
  })
})

describe('parseHeadersFile / compareHeaders', () => {
  const file = `# comment
/*
  Content-Security-Policy: default-src 'self'
  Referrer-Policy: no-referrer

/assets/*
  Cache-Control: public, max-age=31536000, immutable
`

  it('parses rules per pattern with lower-case header names', () => {
    expect(parseHeadersFile(file)).toEqual({
      '/*': { 'content-security-policy': "default-src 'self'", 'referrer-policy': 'no-referrer' },
      '/assets/*': { 'cache-control': 'public, max-age=31536000, immutable' },
    })
  })

  it('flags a live header that differs or is missing', () => {
    const expected = parseHeadersFile(file)['/*'] ?? {}
    expect(compareHeaders(expected, new Headers({ 'Content-Security-Policy': "default-src 'self'", 'Referrer-Policy': 'no-referrer' }))).toEqual([])
    const problems = compareHeaders(expected, new Headers({ 'Content-Security-Policy': '*' }))
    expect(problems.map((p) => p.reason.split(' ')[0])).toEqual(['content-security-policy', 'referrer-policy'])
  })
})
