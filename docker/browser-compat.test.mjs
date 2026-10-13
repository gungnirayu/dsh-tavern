import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { webcrypto } from 'node:crypto';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('./browser-compat.js', import.meta.url), 'utf8');
test('UUID works on a LAN HTTP page without native randomUUID', () => {
  const crypto = { getRandomValues: array => webcrypto.getRandomValues(array) };
  const context = vm.createContext({ crypto });
  vm.runInContext(source, context);
  const ids = Array.from({length: 100}, () => crypto.randomUUID());
  assert.equal(new Set(ids).size, 100);
  for (const id of ids) assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  const installed = crypto.randomUUID;
  vm.runInContext(source, context);
  assert.equal(crypto.randomUUID, installed);
});
test('native secure-context UUID is preserved', () => {
  const native = () => 'native';
  const context = vm.createContext({ crypto: {getRandomValues() {}, randomUUID: native} });
  vm.runInContext(source, context);
  assert.equal(context.crypto.randomUUID, native);
});
