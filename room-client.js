import { isCompatibleGame } from './engine.js';

const SESSION_KEY = 'patchwork-room-v2';
export const HOSTED_MULTIPLAYER_URL = 'https://patchwork-stitch-table.zsj2957310036.chatgpt.site/';

export function readInvitation(value) {
  try {
    const url = new URL(value), key = new URLSearchParams(url.hash.slice(1)).get('invite') ?? '';
    return { code: (url.searchParams.get('room') ?? '').trim().toUpperCase(), inviteKey: /^[a-f0-9]{48}$/i.test(key) ? key.toLowerCase() : '' };
  } catch { return { code: '', inviteKey: /^[a-f0-9]{48}$/i.test(String(value).trim()) ? String(value).trim().toLowerCase() : '' }; }
}

export function invitationURL(pageURL, code, inviteKey) {
  if (!/^[A-Z2-9]{6}$/.test(code) || !/^[a-f0-9]{48}$/.test(inviteKey ?? '')) throw new Error('邀请链接正在准备，请刷新房间后重试');
  const url = new URL(pageURL); url.search = ''; url.hash = '';
  url.searchParams.set('room', code); url.hash = 'invite=' + inviteKey; return url.href;
}

/** Static GitHub Pages keeps local play; online play uses the deployed room service. */
export function hostedMultiplayerRedirect(pageURL) {
  const page = new URL(pageURL);
  if (page.hostname !== 'origin-zxy.github.io' || !/^\/Patchwork(?:\/(?:index\.html)?)?$/i.test(page.pathname)) return null;
  const destination = new URL(HOSTED_MULTIPLAYER_URL);
  destination.searchParams.set('online', '1');
  const code = (page.searchParams.get('room') ?? '').trim().toUpperCase();
  if (/^[A-Z2-9]{6}$/.test(code)) destination.searchParams.set('room', code);
  const { inviteKey } = readInvitation(pageURL);
  if (inviteKey && /^[A-Z2-9]{6}$/.test(code)) destination.hash = 'invite=' + inviteKey;
  return destination.href;
}

/** The browser proposes actions; only the server can change an online game. */
export class RoomClient extends EventTarget {
  constructor() {
    super(); this.session = null; this.room = null; this.source = null; this.poll = null; this.connected = false; this.busy = false; this.generation = 0;
  }

  #event(type, detail) { this.dispatchEvent(new CustomEvent(type, { detail })); }

  #accept(room) {
    if (!this.session || !room || room.code !== this.session.code || (this.room && room.revision < this.room.revision)) return;
    if (room.game && !isCompatibleGame(room.game)) {
      const error = new Error('此房间使用旧版棋盘规则，请创建经典版新房间。'); error.status = 410; throw error;
    }
    if (this.session.seat === 0 && /^[a-f0-9]{48}$/.test(room.inviteKey ?? '')) {
      this.session.inviteKey = room.inviteKey;
      try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(this.session)); } catch {}
    }
    if (this.room && room.revision === this.room.revision && JSON.stringify(room.players) === JSON.stringify(this.room.players)) return;
    this.room = room; this.#event('change', room);
  }

  #connection(connected) { if (this.connected === connected) return; this.connected = connected; this.#event('connection', { connected }); }

  async #request(path, data, token) {
    let response;
    try { response = await fetch(path, { method: data === undefined ? 'GET' : 'POST', headers: { ...(data === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: `Bearer ${token}` } : {}) }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) }); }
    catch { throw new Error('无法连接联机服务，请检查网络或启动本地服务'); }
    let value;
    try { value = await response.json(); }
    catch { throw new Error('此页面没有联机服务，请先用 npm start 启动项目'); }
    if (!response.ok) { if (value.room) this.#accept(value.room); const error = new Error(value.message || '联机操作失败，请重试'); error.status = response.status; error.retryAfter = Math.max(1, Math.min(3600, Number(response.headers.get('Retry-After')) || 60)); throw error; }
    return value;
  }

  #attach(value) {
    this.#disconnect(); this.session = { code: value.code, token: value.token, seat: value.seat };
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(this.session)); } catch {}
    this.room = null;
    try { this.#accept(value.room); }
    catch (error) { this.leave(); throw error; }
    this.#listen(); return this.room;
  }

  #disconnect() {
    this.generation += 1; this.source?.close(); this.source = null; clearInterval(this.poll); this.poll = null;
  }

  async #listen() {
    if (!this.session) return;
    this.#connection(false); const generation = this.generation;
    const { code, token } = this.session;
    let polling = false, retryAt = 0;
    const refresh = async () => {
      if (polling || generation !== this.generation || Date.now() < retryAt) return;
      polling = true;
      try {
        const room = await this.#request(`/api/rooms/${code}`, undefined, token);
        if (generation === this.generation) { this.#accept(room); this.#connection(true); }
      } catch (error) {
        if (generation === this.generation) {
          this.#connection(false);
          if (error.status === 429) retryAt = Date.now() + error.retryAfter * 1000;
          if ([401, 404, 410].includes(error.status)) { this.#disconnect(); this.#event('error', error.message); }
        }
      } finally { polling = false; }
    };
    this.poll = setInterval(refresh, 2000);
    let health;
    try { health = await this.#request('/api/health'); } catch { /* The next poll can recover a transient failure. */ }
    if (generation !== this.generation) return;
    if (health?.transport === 'poll') { refresh(); return; }
    this.source = new EventSource(`/api/rooms/${code}/events?token=${encodeURIComponent(token)}`);
    this.source.onopen = () => this.#connection(true);
    this.source.onmessage = event => { try { this.#accept(JSON.parse(event.data)); } catch {} };
    this.source.onerror = () => this.#connection(false);
  }

  async create(name, turnstileToken) { return this.#attach(await this.#request('/api/rooms', { name, turnstileToken })); }
  async join(code, name, invitation, turnstileToken) {
    const parsed = readInvitation(invitation);
    code = parsed.code || code;
    code = String(code).trim().toUpperCase();
    if (!/^[A-Z2-9]{6}$/.test(code)) throw new Error('请输入 6 位房间码');
    if (!parsed.inviteKey) throw new Error('请输入房主发来的完整邀请链接或邀请口令');
    return this.#attach(await this.#request(`/api/rooms/${code}/join`, { name, inviteKey: parsed.inviteKey, turnstileToken }));
  }

  async restore() {
    let session;
    try { session = JSON.parse(sessionStorage.getItem(SESSION_KEY)); } catch { return false; }
    if (!session?.token || !/^[A-Z2-9]{6}$/.test(session.code) || ![0, 1].includes(session.seat)) return false;
    try {
      const room = await this.#request(`/api/rooms/${session.code}`, undefined, session.token);
      this.#attach({ ...session, room }); return true;
    } catch (error) {
      if ([401, 404, 410].includes(error.status)) { this.leave(); }
      this.#event('error', error.message); return false;
    }
  }

  async #command(operation, payload = {}) {
    if (!this.session) throw new Error('请先创建或加入房间');
    if (this.busy) throw new Error('上一步正在同步，请稍等');
    this.busy = true; const generation = this.generation;
    try { const room = await this.#request(`/api/rooms/${this.session.code}/${operation}`, { token: this.session.token, ...payload }); if (generation === this.generation) this.#accept(room); return room; }
    finally { if (generation === this.generation) this.busy = false; }
  }

  start() { return this.#command('start'); }
  send(action) { return this.#command('action', { revision: this.room?.revision, action }); }
  rematch() { return this.#command('rematch'); }
  leave() {
    this.#disconnect(); this.session = null; this.room = null; this.busy = false;
    try { sessionStorage.removeItem(SESSION_KEY); } catch {}
    this.#connection(false); this.#event('change', null);
  }
}
