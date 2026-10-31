import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { checkDir, findUrls, isAllowed } from './check-dist-urls'

describe('findUrls', () => {
  it('finds http, https and websocket URLs', () => {
    const text = 'a="https://cdn.example.com/x.js";b=\'http://evil.test\';c=`wss://sock.test/ws`'
    expect(findUrls(text)).toEqual(['https://cdn.example.com/x.js', 'http://evil.test', 'wss://sock.test/ws'])
  })

  it('finds protocol-relative URLs in CSS url() and attributes (the Vant alicdn fallback)', () => {
    const css = "@font-face{src:url(data:font/woff2;base64,AAAA) format('woff2'),url(//at.alicdn.com/t/font_x.woff) format('woff')}"
    expect(findUrls(css)).toEqual(['//at.alicdn.com/t/font_x.woff'])
    expect(findUrls('<img src="//img.test/a.png">')).toEqual(['//img.test/a.png'])
  })

  it('ignores JS comments, regexes and paths that are not URLs', () => {
    expect(findUrls('// just a comment\nconst re = /\\/\\//; fetch("/api/room")')).toEqual([])
  })
})

describe('isAllowed', () => {
  it('allows XML namespaces and the Vue error-reference text only', () => {
    expect(isAllowed('http://www.w3.org/2000/svg')).toBe(true)
    expect(isAllowed('http://www.w3.org/1999/xlink')).toBe(true)
    expect(isAllowed('https://vuejs.org/error-reference/#runtime-${r}')).toBe(true)
    expect(isAllowed('https://vuejs.org/guide')).toBe(false)
    expect(isAllowed('http://www.w3.org/2000/svgevil.test')).toBe(false)
    expect(isAllowed('https://www.w3.org/2000/svg')).toBe(false)
    expect(isAllowed('http://www.w3.org/TR/something')).toBe(false)
  })
})

describe('checkDir', () => {
  let dir: string
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'duo-chat-urls-'))
  })
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('passes a clean dist with SVG namespaces', () => {
    mkdirSync(join(dir, 'assets'))
    writeFileSync(join(dir, 'index.html'), '<svg xmlns="http://www.w3.org/2000/svg"></svg><script src="/assets/a.js"></script>')
    writeFileSync(join(dir, 'assets', 'a.js'), 'fetch("/api/x")')
    expect(checkDir(dir)).toEqual([])
  })

  it('reports each offending file and URL once', () => {
    mkdirSync(join(dir, 'assets'))
    writeFileSync(join(dir, 'assets', 'a.js'), 'x("https://t.test/a");y("https://t.test/a")')
    writeFileSync(join(dir, 'assets', 'b.css'), 'a{background:url(//at.alicdn.com/x.woff)}')
    expect(checkDir(dir)).toEqual([
      { file: 'assets/a.js', url: 'https://t.test/a' },
      { file: 'assets/b.css', url: '//at.alicdn.com/x.woff' },
    ])
  })

  it('accepts an extra allow-list', () => {
    writeFileSync(join(dir, 'a.js'), '"https://turn.example.net"')
    expect(checkDir(dir, ['https://turn.example.net'])).toEqual([])
  })
})
