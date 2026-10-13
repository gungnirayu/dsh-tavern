import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { createProxy } from './proxy.mjs';

async function fixture(t) {
  const upstream = http.createServer((req, res) => {
    assert.equal(req.headers.host, `127.0.0.1:${upstream.address().port}`);
    if (req.headers.origin && req.headers.origin !== 'null') assert.equal(req.headers.origin, `http://${req.headers.host}`);
    if (req.url === '/api/dsh-tavern/client-assets/tavern.css') { res.writeHead(200, {'Content-Type': 'text/css'}); res.end('body{}'); return; }
    if (req.url.startsWith('/api/dsh-tavern/vendor/')) { res.writeHead(200, {'Access-Control-Allow-Origin': '*'}); res.end('public script'); return; }
    if (req.url.startsWith('/api/dsh-tavern/session-resource')) {
      if (new URL(req.url, 'http://x').searchParams.get('cap') === 'signed-cap') { res.writeHead(200, {'Access-Control-Allow-Origin': '*'}); res.end('scoped resource'); }
      else { res.writeHead(403); res.end('invalid capability'); }
      return;
    }
    if (req.url === '/?token=test-token') {
      res.writeHead(302, { 'set-cookie': 'dsh-auth=test-cookie; HttpOnly; SameSite=Strict; Path=/', location: '/' });
      res.end(); return;
    }
    if (req.headers.cookie !== 'dsh-auth=test-cookie') { res.writeHead(401); res.end('unauthorized'); return; }
    let body = '';
    req.on('data', b => body += b);
    req.on('end', () => { res.writeHead(200); res.end(JSON.stringify({ ok: true, body, forwarded: req.headers.forwarded ?? null })); });
  });
  upstream.on('upgrade', (req, socket, head) => {
    assert.equal(req.headers.origin, `http://127.0.0.1:${upstream.address().port}`);
    if (req.headers.cookie !== 'dsh-auth=test-cookie') { socket.end('HTTP/1.1 401 Unauthorized\r\n\r\n'); return; }
    socket.write('HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n');
    if (head.length) socket.write(head);
    socket.on('data', b => socket.write(b));
    socket.on('end', () => socket.end());
  });
  upstream.listen(0, '127.0.0.1'); await once(upstream, 'listening');
  const proxy = createProxy({ publicUrl: 'http://192.168.1.10:3088', upstreamPort: upstream.address().port });
  proxy.listen(0, '127.0.0.1'); await once(proxy, 'listening');
  t.after(() => { proxy.closeAllConnections(); proxy.close(); upstream.closeAllConnections(); upstream.close(); });
  return proxy.address().port;
}
function request(port, { path = '/api/dsh-tavern/getUpdateStatus', method = 'POST', headers = {}, body = '{}' } = {}) {
  return new Promise((resolve, reject) => {
    const mergedHeaders = { Host: '192.168.1.10:3088', Origin: 'http://192.168.1.10:3088', 'Content-Type': 'application/json', ...headers };
    for (const key of Object.keys(mergedHeaders)) if (mergedHeaders[key] === undefined) delete mergedHeaders[key];
    const req = http.request({ hostname: '127.0.0.1', port, path, method,
      headers: mergedHeaders }, res => {
      let text = ''; res.on('data', b => text += b); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    });
    req.on('error', reject); req.end(body);
  });
}
test('NAS token exchange, cookie forwarding, authenticated POST and missing-cookie rejection', async t => {
  const port = await fixture(t);
  const login = await request(port, { path: '/?token=test-token', method: 'GET', body: '' });
  assert.equal(login.status, 302); assert.equal(login.headers.location, '/');
  assert.match(login.headers['set-cookie'][0], /HttpOnly; SameSite=Strict/);
  const cookie = login.headers['set-cookie'][0].split(';')[0];
  const result = await request(port, { headers: { Cookie: cookie, Forwarded: 'host=evil.example' } });
  assert.equal(result.status, 200); assert.deepEqual(JSON.parse(result.text), { ok: true, body: '{}', forwarded: null });
  assert.equal((await request(port)).status, 401);
});
test('rejects forged Host, Origin, opaque origin, cross-site marker and absolute request target', async t => {
  const port = await fixture(t);
  for (const headers of [{Host: 'evil.example'}, {Origin: 'http://evil.example'}, {Origin: 'null'}, {'Sec-Fetch-Site': 'cross-site'}, {Host: '127.0.0.1:3081'}]) {
    assert.equal((await request(port, {headers})).status, 403);
  }
  assert.equal((await request(port, {path: 'http://evil.example/'})).status, 403);
});
test('loopback health check remains available', async t => {
  const port = await fixture(t);
  assert.equal((await request(port, {path: '/', method: 'GET', headers: {Host: `127.0.0.1:${port}`, Origin: undefined}, body: ''})).status, 401);
});
test('authenticated WebSocket upgrade streams bytes', async t => {
  const port = await fixture(t);
  await new Promise((resolve, reject) => {
    const req = http.request({ hostname: '127.0.0.1', port, path: '/api/stream', headers: {
      Host: '192.168.1.10:3088', Origin: 'http://192.168.1.10:3088', Cookie: 'dsh-auth=test-cookie', Connection: 'Upgrade', Upgrade: 'websocket'
    }});
    req.on('upgrade', (res, socket) => {
      assert.equal(res.statusCode, 101);
      socket.on('error', reject);
      socket.once('data', bytes => { assert.equal(bytes.toString(), 'ping'); socket.destroy(); resolve(); });
      socket.write('ping');
    });
    req.on('error', reject); req.end();
  });
});
test('public URL must be an explicit origin', () => {
  for (const publicUrl of ['http://user:pass@host', 'http://host/path', 'file:///tmp/x', 'http://host/?token=x']) {
    assert.throws(() => createProxy({publicUrl}));
  }
});

test('opaque sandbox reads only explicit public assets or an upstream-verified capability', async t => {
  const port = await fixture(t);
  const sandbox = {Origin: 'null', 'Sec-Fetch-Site': 'cross-site'};
  const css = await request(port, {method: 'GET', path: '/api/dsh-tavern/client-assets/tavern.css', headers: sandbox, body: ''});
  assert.equal(css.status, 200);
  assert.equal(css.headers['access-control-allow-origin'], '*');
  assert.equal(css.headers['cross-origin-resource-policy'], 'cross-origin');
  assert.equal((await request(port, {method: 'GET', path: '/api/dsh-tavern/vendor/magvarupdate/bundle.js', headers: sandbox, body: ''})).status, 200);
  assert.equal((await request(port, {method: 'GET', path: '/api/dsh-tavern/session-resource?cap=signed-cap', headers: sandbox, body: ''})).status, 200);
  assert.equal((await request(port, {method: 'GET', path: '/api/dsh-tavern/session-resource?cap=forged', headers: sandbox, body: ''})).status, 403);
  assert.equal((await request(port, {method: 'GET', path: '/api/dsh-tavern/session-resource', headers: sandbox, body: ''})).status, 403);
  assert.equal((await request(port, {method: 'POST', path: '/api/dsh-tavern/getUpdateStatus', headers: sandbox})).status, 403);
  assert.equal((await request(port, {method: 'GET', path: '/api/settings/describe', headers: sandbox, body: ''})).status, 403);
});
