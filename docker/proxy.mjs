import http from 'node:http';
import { pathToFileURL } from 'node:url';

export function createProxy({ publicUrl, upstreamPort = 3081 }) {
  const publicOrigin = new URL(publicUrl);
  if (!['http:', 'https:'].includes(publicOrigin.protocol) || publicOrigin.username || publicOrigin.password || publicOrigin.pathname !== '/' || publicOrigin.search || publicOrigin.hash) {
    throw new Error('DSH_TAVERN_PUBLIC_URL must be an HTTP(S) origin, e.g. http://192.168.1.10:3088');
  }
  const internalAuthority = `127.0.0.1:${upstreamPort}`;
  const internalOrigin = `http://${internalAuthority}`;
  function publicRead(req) {
    if (req.method !== 'GET') return false;
    let url, pathname;
    try { url = new URL(req.url, 'http://docker.invalid'); pathname = decodeURIComponent(url.pathname); }
    catch { return false; }
    if (pathname.includes('\\') || pathname.split('/').includes('..') || pathname.includes('\0')) return false;
    // These two routes already require a scoped upstream-signed capability, not a browser cookie.
    if (['/api/dsh-tavern/session-resource', '/api/dsh-tavern/helper-history'].includes(pathname)) {
      return url.searchParams.getAll('cap').length === 1 && Boolean(url.searchParams.get('cap'));
    }
    // Explicitly public/cacheable resource routes from Tavern. No settings, API POSTs,
    // arbitrary files or general /api prefix is allowed through this exception.
    return ['/api/dsh-tavern/vendor/st-prompt-template/', '/api/dsh-tavern/vendor/runtime-assets/',
      '/api/dsh-tavern/client-assets/', '/api/dsh-tavern/plugin-assets/'].some(prefix => pathname.startsWith(prefix))
      || pathname === '/api/dsh-tavern/vendor/magvarupdate/bundle.js'
      || pathname === '/api/dsh-tavern/static-assets'
      || /^\/api\/dsh-tavern\/remote-assets\/[0-9a-f]{64}(?:\/[^/]*)?$/i.test(pathname);
  }
  function accepted(req) {
    const host = req.headers.host;
    const localHealth = ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)
      && host === `127.0.0.1:${req.socket.localPort}` && req.method === 'GET' && req.url === '/' && !req.headers.origin;
    if (localHealth) return true;
    if (!req.url.startsWith('/') || req.url.startsWith('//')) return false;
    if (host !== publicOrigin.host) return false;
    // Sandboxed card frames have opaque origins and cannot send SameSite=Strict cookies.
    if (publicRead(req) && (req.headers.origin === undefined || req.headers.origin === 'null' || req.headers.origin === publicOrigin.origin)) return true;
    if (req.headers['sec-fetch-site'] === 'cross-site') return false;
    // Reject external origins BEFORE rewriting headers for the loopback-only Tavern API.
    if (req.headers.origin !== undefined && req.headers.origin !== publicOrigin.origin) return false;
    if (!req.url.startsWith('/') || req.url.startsWith('//')) return false;
    return true;
  }
  function upstreamHeaders(req, upgrade = false) {
    const headers = { ...req.headers, host: internalAuthority };
    if (headers.origin !== undefined && !publicRead(req)) headers.origin = internalOrigin;
    delete headers.forwarded;
    for (const key of Object.keys(headers)) if (key.startsWith('x-forwarded-')) delete headers[key];
    if (!upgrade) {
      for (const key of String(headers.connection || '').split(',').map(s => s.trim().toLowerCase())) {
        if (key && key !== 'host' && key !== 'origin' && key !== 'cookie') delete headers[key];
      }
      delete headers.connection;
      delete headers.upgrade;
    }
    return headers;
  }
  // Tavern's custom routes do not all use the Connection authentication carrier.
  // Ask DSH to verify its signed cookie before exposing any non-index route.
  function authenticated(req) {
    if (!req.headers.cookie) return Promise.resolve(401);
    return new Promise(resolve => {
      const probe = http.request({ hostname: '127.0.0.1', port: upstreamPort, path: '/', method: 'GET',
        headers: { Host: internalAuthority, Cookie: req.headers.cookie } }, reply => {
        const status = reply.statusCode === 200 ? 200 : reply.statusCode === 401 ? 401 : 502;
        reply.destroy();
        resolve(status);
      });
      probe.on('error', () => resolve(502));
      probe.setTimeout(5000, () => { probe.destroy(); resolve(502); });
      probe.end();
    });
  }
  const server = http.createServer(async (req, res) => {
    if (!accepted(req)) { res.writeHead(403); res.end('Docker proxy: untrusted Host or Origin'); return; }
    if (req.url.split('?')[0] !== '/' && !publicRead(req)) {
      const status = await authenticated(req);
      if (status !== 200) { res.writeHead(status, { 'Cache-Control': 'no-store' }); res.end(status === 401 ? 'unauthorized; reopen the token URL' : 'DSH upstream unavailable'); return; }
    }
    const upstream = http.request({ hostname: '127.0.0.1', port: upstreamPort, path: req.url, method: req.method, headers: upstreamHeaders(req) }, reply => {
      // Preserve Set-Cookie and streaming bodies; DSH still authenticates every request.
      const headers = { ...reply.headers };
      if (headers.location?.startsWith(internalOrigin + '/')) headers.location = publicOrigin.origin + headers.location.slice(internalOrigin.length);
      res.writeHead(reply.statusCode, headers);
      reply.pipe(res);
      reply.on('error', () => res.destroy());
    });
    upstream.on('error', () => { if (!res.headersSent) { res.writeHead(502); res.end('DSH upstream unavailable'); } else res.destroy(); });
    req.on('aborted', () => upstream.destroy());
    res.on('close', () => upstream.destroy());
    req.pipe(upstream);
  });
  server.on('upgrade', async (req, socket, head) => {
    if (!accepted(req)) { socket.end('HTTP/1.1 403 Forbidden\r\nConnection: close\r\n\r\n'); return; }
    const status = await authenticated(req);
    if (status !== 200) { socket.end(`HTTP/1.1 ${status} Rejected\r\nConnection: close\r\n\r\n`); return; }
    const upstream = http.request({ hostname: '127.0.0.1', port: upstreamPort, path: req.url, method: req.method, headers: upstreamHeaders(req, true) });
    upstream.on('upgrade', (reply, peer, upstreamHead) => {
      socket.write(`HTTP/1.1 ${reply.statusCode} ${reply.statusMessage}\r\n`);
      for (let i = 0; i < reply.rawHeaders.length; i += 2) socket.write(`${reply.rawHeaders[i]}: ${reply.rawHeaders[i + 1]}\r\n`);
      socket.write('\r\n');
      if (upstreamHead.length) socket.write(upstreamHead);
      if (head.length) peer.write(head);
      socket.pipe(peer).pipe(socket);
      socket.on('error', () => peer.destroy());
      peer.on('error', () => socket.destroy());
      socket.on('close', () => peer.destroy());
      peer.on('close', () => socket.destroy());
    });
    upstream.on('response', reply => {
      socket.write(`HTTP/1.1 ${reply.statusCode} ${reply.statusMessage}\r\nConnection: close\r\n\r\n`);
      reply.pipe(socket);
    });
    upstream.on('error', () => socket.destroy());
    socket.on('error', () => upstream.destroy());
    upstream.end();
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  if (!process.env.DSH_TAVERN_PUBLIC_URL) throw new Error('Set DSH_TAVERN_PUBLIC_URL to your browser address');
  const server = createProxy({ publicUrl: process.env.DSH_TAVERN_PUBLIC_URL, upstreamPort: Number(process.env.DSH_TAVERN_PORT || 3081) });
  server.listen(3080, '0.0.0.0', () => console.log(`Docker public URL: ${process.env.DSH_TAVERN_PUBLIC_URL}`));
  for (const signal of ['SIGTERM', 'SIGINT']) process.on(signal, () => {
    server.close();
    server.closeAllConnections();
    setTimeout(() => process.exit(0), 1000).unref();
  });
}
