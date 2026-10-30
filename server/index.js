import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, sep, extname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { networkInterfaces } from 'node:os';
import { RoomStore, RoomError } from './rooms.js';
import { RequestGate } from './request-security.js';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.woff2': 'font/woff2', '.json': 'application/json; charset=utf-8', '.ico': 'image/x-icon' };
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
const respond = (response, status, value, extra = {}) => { response.writeHead(status, { ...headers, 'Content-Type': 'application/json; charset=utf-8', ...extra }); response.end(JSON.stringify(value)); };
async function readBody(request) {
  if (!request.headers['content-type']?.startsWith('application/json')) throw new RoomError('请求需要 JSON 数据', 415);
  let data = '';
  for await (const chunk of request) { data += chunk; if (Buffer.byteLength(data) > 8192) throw new RoomError('请求内容过大', 413); }
  try { const value = JSON.parse(data); if (!value || typeof value !== 'object' || Array.isArray(value)) throw 0; return value; }
  catch { throw new RoomError('请求内容无效'); }
}

export function createApp({ directory = resolve(ROOT, '.patchwork-rooms'), store = new RoomStore({ directory }), staticRoot = ROOT } = {}) {
  staticRoot = resolve(staticRoot);
  const streams = new Set();
  const gate = new RequestGate();
  const server = createServer(async (request, response) => {
    let code, token;
    try {
      const host = request.headers.host;
      if (!host || /[\\\s]/.test(host)) throw new RoomError('请求地址无效', 400);
      const url = new URL(request.url, `http://${host}`);
      if (url.pathname.startsWith('/api/')) {
        const identity = request.socket.remoteAddress ?? 'unknown'; gate.check('api', identity, 300);
        if (request.headers.origin && request.headers.origin !== `http://${host}`) throw new RoomError('请从当前游戏页面操作', 403);
        if (request.method === 'GET' && url.pathname === '/api/health') { respond(response, 200, { ok: true, multiplayer: true }); return; }
        if (request.method === 'GET' && url.pathname === '/api/security') { respond(response, 200, { required: false, hosted: false, roomLimit: store.maximumRooms }); return; }
        if (request.method === 'POST' && url.pathname === '/api/rooms') { gate.check('create', identity, 2); respond(response, 201, store.create(await readBody(request))); return; }
        const match = url.pathname.match(/^\/api\/rooms\/([A-Z2-9]{6})(?:\/(join|start|action|rematch|events))?$/i);
        if (!match) throw new RoomError('没有这个接口', 404);
        code = match[1].toUpperCase(); const operation = match[2];
        if (request.method === 'POST' && operation === 'join') { gate.check('join', identity, 10); respond(response, 201, store.join(code, await readBody(request))); return; }
        gate.check(request.method === 'GET' ? 'read' : 'action', identity, request.method === 'GET' ? 180 : 120);
        token = url.searchParams.get('token') || request.headers.authorization?.replace(/^Bearer /, '');
        if (request.method === 'POST' && ['start', 'action', 'rematch'].includes(operation)) {
          const data = await readBody(request); token ||= data.token;
          const room = operation === 'action' ? store.action(code, token, data) : store.start(code, token, { rematch: operation === 'rematch' });
          respond(response, 200, room); return;
        }
        store.snapshot(code, token);
        if (request.method === 'GET' && operation === 'events') {
          response.writeHead(200, { ...headers, 'Content-Type': 'text/event-stream; charset=utf-8', 'Connection': 'keep-alive', 'X-Accel-Buffering': 'no' }); response.flushHeaders(); streams.add(response);
          const send = () => { if (!response.destroyed) response.write(`data: ${JSON.stringify(store.snapshot(code, token))}\n\n`); };
          const unsubscribe = store.subscribe(code, send); const disconnect = store.connect(code, token); send();
          const heartbeat = setInterval(() => { if (!response.destroyed) response.write(': heartbeat\n\n'); }, 15000); heartbeat.unref();
          response.on('close', () => { clearInterval(heartbeat); unsubscribe(); streams.delete(response); disconnect(); }); return;
        }
        if (request.method === 'GET' && !operation) { respond(response, 200, store.snapshot(code, token)); return; }
        throw new RoomError('没有这个接口', 404);
      }
      if (!['GET', 'HEAD'].includes(request.method)) throw new RoomError('不支持这个请求', 405);
      const path = decodeURIComponent(url.pathname);
      if (path.split('/').some(part => part.startsWith('.') || ['server', 'tests', 'worker', 'scripts', 'node_modules'].includes(part)) || path.includes('\\') || path.includes('\0')) throw new RoomError('找不到这个文件', 404);
      let file = resolve(staticRoot, `.${path}`);
      if (file !== staticRoot && !file.startsWith(staticRoot + sep)) throw new RoomError('找不到这个文件', 404);
      try { if ((await stat(file)).isDirectory()) file = resolve(file, 'index.html'); }
      catch { throw new RoomError('找不到这个页面', 404); }
      let data; try { data = await readFile(file); } catch { throw new RoomError('找不到这个文件', 404); }
      response.writeHead(200, { ...headers, 'Content-Type': MIME[extname(file)] ?? 'application/octet-stream' }); response.end(request.method === 'HEAD' ? undefined : data);
    } catch (error) {
      if (response.headersSent) { response.end(); return; }
      let room; if (error.status === 409 && code && token) try { room = store.snapshot(code, token); } catch {}
      respond(response, error.status ?? 500, { message: error.status ? error.message : '联机服务暂时无法处理，请稍后重试', ...(room ? { room } : {}) }, error.retryAfter ? { 'Retry-After': String(error.retryAfter) } : {});
    }
  });
  return { server, store, stopStreams() { for (const stream of streams) stream.end(); } };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const port = Number(process.env.PORT ?? 4174), host = process.env.HOST ?? '0.0.0.0';
  const app = createApp({ directory: process.env.PATCHWORK_ROOM_DIR ? resolve(process.env.PATCHWORK_ROOM_DIR) : undefined });
  app.server.listen(port, host, () => {
    console.log(`拼布对决：http://127.0.0.1:${port}`);
    if (host === '0.0.0.0') for (const interfaces of Object.values(networkInterfaces())) for (const address of interfaces ?? []) if (address.family === 'IPv4' && !address.internal) console.log(`同一网络的朋友可访问：http://${address.address}:${port}`);
  });
  const shutdown = () => { app.stopStreams(); app.server.close(() => process.exit(0)); };
  process.on('SIGINT', shutdown); process.on('SIGTERM', shutdown);
}
