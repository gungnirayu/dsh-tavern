import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { execFileSync } from 'node:child_process';
const require = createRequire(process.env.PLAYWRIGHT_PACKAGE_DIR + '/package.json');
const { chromium } = require('playwright');
const origin = 'http://tavern.test:3088';
const status = execFileSync('docker', ['exec', 'tavern-browser', 'tavern-url'], {encoding: 'utf8'});
const tokenUrl = status.match(/http:\/\/tavern\.test:3088\/[^\s]*/)?.[0];
assert.ok(tokenUrl, 'browser fixture must print its public URL');
const browser = await chromium.launch({args: ['--host-resolver-rules=MAP tavern.test 127.0.0.1', '--no-proxy-server']});
const context = await browser.newContext({locale: 'zh-CN'});
const page = await context.newPage();
const pageErrors = [];
page.on('pageerror', error => pageErrors.push(error.message));
try {
  await page.goto(tokenUrl, {waitUntil: 'domcontentloaded'});
  await page.waitForFunction(() => typeof crypto.randomUUID === 'function');
  assert.equal(await page.evaluate(() => location.hostname), 'tavern.test');
  assert.equal(await page.evaluate(() => isSecureContext), false, 'must test a real insecure non-loopback origin');
  const ids = await page.evaluate(() => [crypto.randomUUID(), crypto.randomUUID()]);
  assert.notEqual(ids[0], ids[1]);
  for (const id of ids) assert.match(id, /^[0-9a-f-]{36}$/);
  const settings = page.getByRole('button', {name: /^(设置|Settings)$/}).first();
  await settings.waitFor({state: 'visible', timeout: 60000});
  // New profiles can display the welcome/API onboarding flow before the settings panel.
  for (const name of [/^(继续|Continue)$/, /^(稍后配置|Configure later)$/]) {
    const button = page.getByRole('button', {name}).first();
    if (await button.waitFor({state: 'visible', timeout: 5000}).then(() => true).catch(() => false)) await button.click();
  }
  await settings.click();
  await page.getByRole('button', {name: /^(模型|Models)$/}).first().click();
  await page.waitForFunction(() => document.body.innerText.includes('提供方') || document.body.innerText.includes('Provider'));
  await page.waitForTimeout(1000);
  const text = await page.locator('body').innerText();
  assert.ok(!/settings are unavailable in this browser|加载提供方目录失败|Loading the provider directory failed/.test(text), 'model settings directory must load');
  const rpc = await page.evaluate(async () => {
    const methods = ['settings/describe', 'llm/listProviders', 'llm/listConfigurableProviders'];
    return await Promise.all(methods.map(async method => {
      const response = await fetch('/api/' + method, {method: 'POST', headers: {'Content-Type': 'application/json'},
        body: JSON.stringify({type: 'client-request', rpcId: 'browser-' + crypto.randomUUID(), method, payload: {args: {}}})});
      return {method, status: response.status, result: await response.json()};
    }));
  });
  for (const result of rpc) { assert.equal(result.status, 200); assert.equal(result.result.result?.ok, true, `${result.method} should succeed`); }
  const frameResult = await page.evaluate(async () => {
    const frame = document.createElement('iframe');
    frame.setAttribute('sandbox', 'allow-scripts');
    const id = crypto.randomUUID();
    const answer = new Promise(resolve => {
      const onMessage = event => { if (event.source === frame.contentWindow && event.data?.id === id) { window.removeEventListener('message', onMessage); resolve(event.data); } };
      window.addEventListener('message', onMessage);
      setTimeout(() => resolve({error: 'sandbox probe timed out'}), 10000);
    });
    frame.srcdoc = `<script>fetch('${location.origin}/api/dsh-tavern/session-resource?cap=invalid').then(async r=>parent.postMessage({id:'${id}',status:r.status,text:await r.text()},'*')).catch(e=>parent.postMessage({id:'${id}',error:String(e)},'*'))<\/script>`;
    document.body.append(frame);
    const result = await answer; frame.remove(); return result;
  });
  assert.equal(frameResult.status, 403);
  assert.match(frameResult.text, /Resource unavailable/, 'opaque frame must reach capability verifier, not proxy origin rejection');
  assert.ok(!pageErrors.some(error => /randomUUID|settings are unavailable|SecurityError/.test(error)), JSON.stringify(pageErrors));
  console.log('PASS: real Chromium non-loopback HTTP, UUID, model settings UI/RPC and opaque iframe capability route');
} catch (error) {
  console.error('Browser validation failed:', error.message);
  console.error('Visible button labels:', await page.getByRole('button').allTextContents().catch(() => []));
  // Do not print token URLs, cookies, provider credentials or full page HTML.
  throw error;
} finally { await browser.close(); }
