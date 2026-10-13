import assert from 'node:assert/strict'
import { readFile, access } from 'node:fs/promises'
import test from 'node:test'

const root = new URL('../docs/', import.meta.url)
const html = await readFile(new URL('product.html', root), 'utf8')

test('产品页可作为静态目录发布，所有本地图片、样式、脚本和锚点存在', async () => {
  const ids = [...html.matchAll(/\bid="([^"]+)"/g)].map(match => match[1])
  assert.equal(new Set(ids).size, ids.length, 'HTML ids are unique')
  for (const [, value] of html.matchAll(/\b(?:href|src)="([^"]+)"/g)) {
    if (value.startsWith('https://')) continue
    assert.ok(!value.startsWith('/'), 'assets must work beneath a GitHub Pages project path')
    if (value.startsWith('#')) { if (value.length > 1) assert.ok(ids.includes(value.slice(1)), value); continue }
    await access(new URL(value, root))
  }
  for (const [, attrs] of html.matchAll(/<img\b([^>]+)>/g)) assert.match(attrs, /alt="[^"]+"/)
})
