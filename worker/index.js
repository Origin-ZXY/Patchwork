import { CloudRooms } from './cloud-rooms.js';
import { RoomError } from '../server/room-core.js';

const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml', '.json': 'application/json; charset=utf-8' };
const headers = { 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer' };
const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' } });

async function payload(request) {
  if (!request.headers.get('Content-Type')?.startsWith('application/json')) throw new RoomError('请求需要 JSON 数据', 415);
  const reader = request.body?.getReader();
  if (!reader) throw new RoomError('请求内容无效');
  const decoder = new TextDecoder(); let text = '', length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read(); if (done) break;
      length += value.byteLength; if (length > 32768) throw new RoomError('请求内容过大', 413);
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally { await reader.cancel().catch(() => {}); }
  try { const value = JSON.parse(text); if (!value || typeof value !== 'object' || Array.isArray(value)) throw 0; return value; }
  catch { throw new RoomError('请求内容无效'); }
}

export function createWorker(assets) {
  return {
    async fetch(request, env, context) {
      const url = new URL(request.url); let api, code, token;
      try {
        if (url.pathname.startsWith('/api/')) {
          if (request.headers.get('Origin') && request.headers.get('Origin') !== url.origin) throw new RoomError('请从当前游戏页面操作', 403);
          api = new CloudRooms(env.DB);
          if (request.method === 'GET' && url.pathname === '/api/health') {
            await api.db.prepare('SELECT code FROM patchwork_rooms LIMIT 1').first();
            return json({ ok: true, multiplayer: true, hosted: true, transport: 'poll' });
          }
          const identity = request.headers.get('CF-Connecting-IP') ?? 'unknown';
          if (request.method === 'POST' && url.pathname === '/api/rooms') {
            await api.limit('create', identity, 12, 3600000);
            const value = await api.create(await payload(request));
            context?.waitUntil(api.cleanup().catch(() => {}));
            return json(value, 201);
          }
          const match = url.pathname.match(/^\/api\/rooms\/([A-Z2-9]{6})(?:\/(join|start|action|rematch|events))?$/i);
          if (!match) throw new RoomError('没有这个接口', 404);
          code = match[1].toUpperCase(); const operation = match[2]?.toLowerCase();
          if (request.method === 'POST' && operation === 'join') {
            await api.limit('join', identity, 40, 60000);
            return json(await api.join(code, await payload(request)), 201);
          }
          token = request.headers.get('Authorization')?.replace(/^Bearer /, '') || url.searchParams.get('token');
          if (request.method === 'GET' && (!operation || operation === 'events')) {
            const room = await api.snapshot(code, token);
            return operation === 'events' ? json({ transport: 'poll', room }) : json(room);
          }
          if (request.method === 'POST' && ['start', 'action', 'rematch'].includes(operation)) {
            const data = await payload(request); token ||= data.token;
            if (!token) throw new RoomError('请先加入房间', 401);
            await api.limit('action', token, 240, 60000);
            return json(operation === 'action' ? await api.action(code, token, data) : await api.start(code, token, { rematch: operation === 'rematch' }));
          }
          throw new RoomError('没有这个接口', 404);
        }
        if (!['GET', 'HEAD'].includes(request.method)) throw new RoomError('不支持这个请求', 405);
        let path;
        try { path = decodeURIComponent(url.pathname); } catch { throw new RoomError('请求地址无效', 400); }
        if (path.endsWith('/')) path += 'index.html';
        if (!Object.hasOwn(assets, path)) throw new RoomError('找不到这个页面', 404);
        const extension = path.slice(path.lastIndexOf('.'));
        return new Response(request.method === 'HEAD' ? null : assets[path], { headers: { ...headers, 'Content-Type': MIME[extension] ?? 'text/plain; charset=utf-8' } });
      } catch (error) {
        let room;
        if (api && code && token) try { room = await api.snapshot(code, token); } catch {}
        if (!error.status) console.error('Patchwork room service:', error.name, error.message);
        return json({ message: error.status ? error.message : '联机服务暂时不可用，请稍后重试', ...(room ? { room } : {}) }, error.status ?? 503);
      }
    }
  };
}
