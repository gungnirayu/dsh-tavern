import test from 'node:test'
import assert from 'node:assert/strict'
import { validateCardText, validateCardFile } from '../tavern-plugin/lib/domain/card-validation.js'
const check = value => validateCardText(JSON.stringify(value))

test('invalid JSON, card shape and MVU containers report safe locations', () => {
  const invalid = validateCardText('<开局>秘密正文')
  assert.equal(invalid.valid, false)
  assert.doesNotMatch(JSON.stringify(invalid), /秘密正文|<开局>/)
  for (const value of [[], null, { spec: 'chara_card_v3' }, { name: 2 }, { name: 'a', first_mes: [] }, { name: 'a', tags: [1] }, { name: 'a', extensions: { tavern_helper: { variables: [], scripts: {} } } }]) assert.equal(check(value).valid, false)
  assert.match(validateCardText('{\n "name": }').errors[0].message, /第 2 行/)
})

test('production tool reads disk through native DSH schema and rejects play-mode or escaped paths', { skip: !process.env.DSH_BOOT_MODULE }, async t => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises')
  const { tmpdir } = await import('node:os')
  const { join } = await import('node:path')
  const { createFileResourceStore } = await import('../tavern-plugin/lib/domain/file-resources.js')
  const { registerCardReadingTools } = await import('../tavern-plugin/lib/tools/card-reading.js')
  const { createCardValidationCheck } = await import('../tavern-plugin/lib/tools/card-validation-check.js')
  const root = await mkdtemp(join(tmpdir(), 'tavern-validate-tool-'))
  t.after(() => rm(root, { recursive: true, force: true }))
  const files = createFileResourceStore({ dataRoot: root })
  await files.ensure()
  const path = 'cards/test.json'
  await writeFile(files.absolute(path), '<开局>')
  let tool, mode = 'card'
  registerCardReadingTools({
    tools: { register(value) { if (value.name === 'tavern_validate_card') tool = value } },
    chatForSession: async () => ({ mode, cardPath: path }),
    str: value => String(value || ''), fileResources: files,
    cardMemory: { recordValidation: async () => {} },
    checkCard: createCardValidationCheck({ cardMemory: { recordValidation: async () => {} }, fileResources: files })
  })
  const exec = { agent: { session: { id: 'test' } } }
  const broken = await tool.execute({}, exec)
  assert.equal(broken.valid, false)
  assert.ok(tool.output.render({}, broken))
  await writeFile(files.absolute(path), JSON.stringify({ name: '已修复' }))
  assert.equal((await tool.execute({}, exec)).valid, true)
  await assert.rejects(tool.execute({ path: '../private.json' }, exec))
  mode = 'story'
  await assert.rejects(tool.execute({}, exec), /卡片工作台/)
})
