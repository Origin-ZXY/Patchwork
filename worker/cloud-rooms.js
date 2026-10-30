import { RoomError, createRoomRecord, joinRoomRecord, startRoomRecord, applyRoomAction, snapshotRoom, authenticateRoom, upgradeRoomInvite } from '../server/room-core.js';
import { roomCapacity } from '../server/request-security.js';

const LIFETIME = 7 * 24 * 60 * 60 * 1000;
const lifetime = record => record.status === 'waiting' ? 30 * 60000 : record.status === 'finished' ? 3600000 : LIFETIME;
const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const bytes = length => crypto.getRandomValues(new Uint8Array(length));
const randomCode = () => Array.from(bytes(6), byte => alphabet[byte % alphabet.length]).join('');
const randomToken = () => Array.from(bytes(24), byte => byte.toString(16).padStart(2, '0')).join('');
const randomSeed = () => new DataView(bytes(4).buffer).getUint32(0);

/** D1 is the authority. Every mutation commits only against its loaded version. */
export class CloudRooms {
  constructor(database, { now = () => Date.now(), seed = randomSeed, maximumRooms = 20, maximumCreatorRooms = 3 } = {}) {
    if (!database) throw new RoomError('联机服务正在准备，请稍后重试', 503);
    this.db = database.withSession?.('first-primary') ?? database;
    this.now = now;
    this.seed = seed;
    this.maximumRooms = roomCapacity(maximumRooms); this.maximumCreatorRooms = maximumCreatorRooms;
  }

  async load(code) {
    if (typeof code !== 'string' || !/^[A-Z2-9]{6}$/i.test(code)) throw new RoomError('房间码无效', 404);
    const row = await this.db.prepare('SELECT code, body, version FROM patchwork_rooms WHERE code = ? AND expires_at > ?').bind(code.toUpperCase(), this.now()).first();
    if (!row) throw new RoomError('没有找到房间，可能已过期，请检查邀请链接', 404);
    return row;
  }

  async presence(code) {
    const result = await this.db.prepare('SELECT seat FROM patchwork_presence WHERE room_code = ? AND last_seen > ?').bind(code, this.now() - 35000).all();
    const seats = new Set((result.results ?? []).map(row => row.seat));
    return [seats.has(0), seats.has(1)];
  }

  async snapshot(code, token) {
    const row = await this.load(code); let record = JSON.parse(row.body);
    const seat = authenticateRoom(record, token);
    if (!record.inviteKey && record.status === 'waiting' && seat === 0) record = await this.mutate(code, room => upgradeRoomInvite(room, token));
    const now = this.now(), window = Math.floor(now / 60000);
    const result = await this.db.prepare(`INSERT INTO patchwork_presence (room_code, seat, last_seen, read_window, read_count) VALUES (?, ?, ?, ?, 1)
      ON CONFLICT(room_code, seat) DO UPDATE SET last_seen = excluded.last_seen, read_window = excluded.read_window,
      read_count = CASE WHEN read_window = excluded.read_window THEN read_count + 1 ELSE 1 END RETURNING read_count`).bind(record.code, seat, now, window).first();
    if (result.read_count > 120) { const error = new RoomError('房间同步太频繁，请稍后重试', 429); error.retryAfter = 60 - Math.floor(now / 1000) % 60; throw error; }
    return { ...snapshotRoom(record, token, { connected: await this.presence(record.code) }), transport: 'poll', hosted: true };
  }

  async create({ name } = {}, identity = 'unknown') {
    const creator = await this.identityHash(identity);
    for (let attempt = 0; attempt < 5; attempt++) {
      const code = randomCode(), token = randomToken(), record = createRoomRecord({ code, name, token });
      const now = this.now();
      const result = await this.db.prepare(`INSERT OR IGNORE INTO patchwork_rooms (code, body, version, expires_at, creator_hash)
        SELECT ?, ?, 1, ?, ? WHERE (SELECT COUNT(*) FROM patchwork_rooms WHERE expires_at > ?) < ?
        AND (SELECT COUNT(*) FROM patchwork_rooms WHERE creator_hash = ? AND expires_at > ?) < ?`).bind(code, JSON.stringify(record), now + lifetime(record), creator, now, this.maximumRooms, creator, now, this.maximumCreatorRooms).run();
      if (result.meta.changes) return { code, token, seat: 0, room: await this.snapshot(code, token) };
      const counts = await this.db.prepare('SELECT COUNT(*) AS total, SUM(CASE WHEN creator_hash = ? THEN 1 ELSE 0 END) AS owned FROM patchwork_rooms WHERE expires_at > ?').bind(creator, now).first();
      if (counts.total >= this.maximumRooms || counts.owned >= this.maximumCreatorRooms) {
        const error = new RoomError(counts.total >= this.maximumRooms ? '棋桌暂时坐满了，请稍后再创建房间；已有房间可以继续玩' : '你已创建 3 个房间，请使用已有房间或等待空房过期', 429);
        error.retryAfter = 60; throw error;
      }
    }
    throw new RoomError('暂时无法创建房间，请重试', 503);
  }

  async mutate(code, operation) {
    for (let attempt = 0; attempt < 6; attempt++) {
      const row = await this.load(code), record = await operation(JSON.parse(row.body));
      const result = await this.db.prepare('UPDATE patchwork_rooms SET body = ?, version = version + 1, expires_at = ? WHERE code = ? AND version = ?').bind(JSON.stringify(record), this.now() + lifetime(record), row.code, row.version).run();
      if (result.meta.changes) return record;
    }
    throw new RoomError('房间正在同步，请根据最新棋盘重试', 409);
  }

  async join(code, { name, inviteKey } = {}) {
    const token = randomToken();
    const record = await this.mutate(code, room => joinRoomRecord(room, { name, token, inviteKey }));
    const seat = authenticateRoom(record, token);
    return { code: record.code, token, seat, room: await this.snapshot(record.code, token) };
  }

  async start(code, token, { rematch = false } = {}) {
    const seed = this.seed();
    const record = await this.mutate(code, async room => startRoomRecord(room, token, { rematch, seed, connected: await this.presence(room.code) }));
    return this.snapshot(record.code, token);
  }

  async action(code, token, payload) {
    const record = await this.mutate(code, room => applyRoomAction(room, token, payload));
    return this.snapshot(record.code, token);
  }

  async identityHash(identity) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity));
    return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
  }

  async authorize(code, token) {
    const row = await this.load(code); return authenticateRoom(JSON.parse(row.body), token);
  }

  async limit(category, identity, maximum, windowMs) {
    const hash = await this.identityHash(identity);
    const now = this.now(), key = `${category}:${hash}:${Math.floor(now / windowMs)}`;
    const result = await this.db.prepare('INSERT INTO patchwork_limits (key, count, expires_at) VALUES (?, 1, ?) ON CONFLICT(key) DO UPDATE SET count = count + 1 RETURNING count').bind(key, now + windowMs * 2).first();
    if (result.count > maximum) { const error = new RoomError('操作太频繁，请稍后重试', 429); error.retryAfter = Math.ceil((windowMs - now % windowMs) / 1000); throw error; }
  }

  async cleanup() {
    const now = this.now();
    await this.db.batch([
      this.db.prepare('DELETE FROM patchwork_presence WHERE last_seen < ?').bind(now - 120000),
      this.db.prepare('DELETE FROM patchwork_rooms WHERE expires_at < ?').bind(now),
      this.db.prepare('DELETE FROM patchwork_limits WHERE expires_at < ?').bind(now)
    ]);
  }
}
