import http from 'node:http';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
const publicUrl = new URL(process.env.DSH_TAVERN_PUBLIC_URL);
const status = execFileSync(process.execPath, ['/data/apps/dsh-tavern/bin/dsh-tavern.mjs', 'status'], { encoding: 'utf8' });
const match = status.match(/http:\/\/127\.0\.0\.1:\d+\/[^\s]*/g)?.find(s => new URL(s).searchParams.has('token'));
assert.ok(match, 'status must print the current token URL');
const path = new URL(match).pathname + new URL(match).search;
function request(path, { method = 'GET', headers = {}, body = '' } = {}) {
  return new Promise((resolve, reject) => {
    const req = http.request({hostname: '127.0.0.1', port: 3080, path, method,
      headers: {Host: publicUrl.host, Origin: publicUrl.origin, ...headers}}, res => {
      let text = ''; res.on('data', b => text += b); res.on('end', () => resolve({status: res.statusCode, headers: res.headers, text}));
    });
    req.on('error', reject); req.end(body);
  });
}
const login = await request(path);
assert.equal(login.status, 303, 'token exchange should redirect');
const cookie = login.headers['set-cookie']?.map(s => s.split(';')[0]).join('; ');
assert.ok(cookie, 'token exchange should set a cookie');
assert.equal((await request('/', {headers: {Cookie: cookie}})).status, 200);
const api = '/api/dsh-tavern/getUpdateStatus';
const options = {method: 'POST', headers: {Cookie: cookie, 'Content-Type': 'application/json'}, body: '{}'};
const response = await request(api, options);
assert.equal(response.status, 200, `NAS-origin Tavern API returned ${response.status}`);
assert.doesNotThrow(() => JSON.parse(response.text), 'API must return JSON');
assert.equal((await request(api, {...options, headers: {'Content-Type': 'application/json'}})).status, 401, 'guest API request must be rejected');
assert.equal((await request(api, {...options, headers: {...options.headers, Origin: 'http://evil.example'}})).status, 403, 'cross-origin API request must be rejected');
assert.equal((await request(api, {...options, headers: {...options.headers, Host: 'evil.example'}})).status, 403, 'unconfigured authority must be rejected');
console.log('PASS: NAS-origin login, authenticated Tavern POST, guest rejection, Host/Origin rejection');

// Verify the delivered browser module selects host persistence for an authenticated LAN page.
const settingsClient = await request('/plugins/@deepseek-ai/dsh-client-ui-settings/client.js', {headers: {Cookie: cookie}});
assert.equal(settingsClient.status, 200, 'settings client must be served');
assert.match(settingsClient.text, /DSH_DOCKER_AUTHENTICATED_SETTINGS/);
assert.ok(!settingsClient.text.includes('const persistence = ctx.remote.$host.isLoopback ? "host" : "memory";'));
const settingsRead = await request('/api/settings/describe', {
  method: 'POST', headers: {Cookie: cookie, 'Content-Type': 'application/json'},
  body: JSON.stringify({type: 'client-request', rpcId: 'docker-settings-probe', method: 'settings/describe', payload: {args: {}}})
});
assert.equal(settingsRead.status, 200, 'settings describe RPC should succeed');
const described = JSON.parse(settingsRead.text);
assert.equal(described.result?.ok, true, `settings describe must return a valid settings snapshot: ${JSON.stringify(described.result?.error)}`);
console.log('PASS: LAN settings client and settings describe RPC');
