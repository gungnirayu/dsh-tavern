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
// ClientModuleRegistry serves revisioned batches, not individual package URLs.
// Follow the script/preload URLs from the actual boot HTML as the browser does.
const index = await request('/', {headers: {Cookie: cookie}});
const moduleUrls = [...index.text.matchAll(/(?:src|href)="([^"<>]+)"/g)]
  .map(match => match[1].replaceAll('&amp;', '&'))
  .filter(url => url.startsWith('/plugins/'));
assert.ok(moduleUrls.length, 'boot HTML must reference client module batches');
let settingsSource, browserCompat;
for (const url of new Set(moduleUrls)) {
  const client = await request(url, {headers: {Cookie: cookie}});
  assert.equal(client.status, 200, 'boot client module batch must be served');
  if (client.text.includes('DSH_DOCKER_BROWSER_COMPAT')) browserCompat = true;
  if (client.text.includes('DSH_DOCKER_AUTHENTICATED_SETTINGS')) settingsSource = client.text;
}
assert.ok(browserCompat, 'browser bootstrap must include the HTTP UUID compatibility layer');
assert.ok(settingsSource, 'browser boot modules must include the authenticated LAN settings adapter');
assert.ok(!settingsSource.includes('const persistence = ctx.remote.$host.isLoopback ? "host" : "memory";'));
const settingsRead = await request('/api/settings/describe', {
  method: 'POST', headers: {Cookie: cookie, 'Content-Type': 'application/json'},
  body: JSON.stringify({type: 'client-request', rpcId: 'docker-settings-probe', method: 'settings/describe', payload: {args: {}}})
});
assert.equal(settingsRead.status, 200, 'settings describe RPC should succeed');
const described = JSON.parse(settingsRead.text);
assert.equal(described.result?.ok, true, `settings describe must return a valid settings snapshot: ${JSON.stringify(described.result?.error)}`);
console.log('PASS: LAN settings client and settings describe RPC');

const publicStatus = execFileSync('tavern-url', [], {encoding: 'utf8'});
assert.ok(publicStatus.includes(publicUrl.origin + '/?token='), 'public status must print the browser origin');
assert.ok(!publicStatus.includes('http://127.0.0.1:'), 'public status must not send the browser to an internal port');
const opaque = {method: 'GET', headers: {Origin: 'null', 'Sec-Fetch-Site': 'cross-site'}};
const vendor = await request('/api/dsh-tavern/vendor/runtime-assets/lodash.min.js', opaque);
// Route may not contain this filename: 404 is valid; a proxy authentication/fence error is not.
assert.ok([200, 404].includes(vendor.status), `opaque vendor route must reach asset handler: ${vendor.status}`);
const invalidCap = await request('/api/dsh-tavern/session-resource?cap=invalid', opaque);
assert.equal(invalidCap.status, 403);
assert.match(invalidCap.text, /Resource unavailable/, 'upstream must reject the capability, not the Docker origin fence');
console.log('PASS: public login URL and opaque sandbox resource routing');
