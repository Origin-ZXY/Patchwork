import { randomBytes } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RoomError, createRoomRecord, joinRoomRecord, startRoomRecord, applyRoomAction, snapshotRoom, authenticateRoom, upgradeRoomInvite } from './room-core.js';
import { roomCapacity } from './request-security.js';
export { RoomError } from './room-core.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** One authoritative, synchronous transaction queue per Node process. */
export class RoomStore {
  constructor({ directory = null, maximumRooms = 20, now = () => Date.now() } = {}) {
    this.directory = directory;
    this.maximumRooms = roomCapacity(maximumRooms); this.now = now;
    this.rooms = new Map();
    this.listeners = new Map();
    this.connections = new Map();
    if (!directory) return;
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    for (const file of readdirSync(directory)) {
      if (!/^[A-Z2-9]{6}\.json$/.test(file)) continue;
      try {
        const room = JSON.parse(readFileSync(resolve(directory, file), 'utf8'));
        if ([1, 2].includes(room.schema) && room.code === file.slice(0, 6) && room.players?.length === 2 && room.players[0]?.token && Number.isInteger(room.revision)) {
          room.expiresAt ??= this.now() + 7 * 86400000;
          if (room.expiresAt > this.now()) this.rooms.set(room.code, room);
        }
      } catch { /* A damaged room must not prevent other rooms from starting. */ }
    }
  }

  #room(code) {
    const room = this.rooms.get(String(code).toUpperCase());
    if (!room || room.expiresAt <= this.now()) throw new RoomError('没有找到这个房间，可能已过期，请检查邀请链接', 404);
    return room;
  }

  #seat(room, token) { return authenticateRoom(room, token); }

  #save(room) {
    room.expiresAt = this.now() + (room.status === 'waiting' ? 30 * 60000 : room.status === 'finished' ? 3600000 : 7 * 86400000);
    if (this.directory) {
      const path = resolve(this.directory, `${room.code}.json`);
      const temporary = `${path}.${randomBytes(6).toString('hex')}.tmp`;
      writeFileSync(temporary, JSON.stringify(room), { mode: 0o600 });
      renameSync(temporary, path);
    }
    this.rooms.set(room.code, room);
    this.#broadcast(room.code);
  }

  #broadcast(code) {
    for (const listener of this.listeners.get(code) ?? []) {
      try { listener(); } catch { /* A disconnected SSE stream is independent of game state. */ }
    }
  }

  #view(room, token) {
    return snapshotRoom(room, token, { connected: room.players.map((_, seat) => (this.connections.get(`${room.code}:${seat}`) ?? 0) > 0) });
  }

  create({ name } = {}) {
    for (const [code, room] of this.rooms) if (room.expiresAt <= this.now()) this.rooms.delete(code);
    if (this.rooms.size >= this.maximumRooms) throw new RoomError('棋桌暂时坐满了，请稍后再创建房间；已有房间可以继续玩', 429);
    let code;
    do { code = [...randomBytes(6)].map(byte => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join(''); } while (this.rooms.has(code));
    const token = randomBytes(24).toString('base64url');
    const room = createRoomRecord({ code, name, token });
    this.#save(room);
    return { code, token, seat: 0, room: this.#view(room, token) };
  }

  join(code, { name, inviteKey } = {}) {
    const token = randomBytes(24).toString('base64url');
    const room = joinRoomRecord(this.#room(code), { name, token, inviteKey });
    this.#save(room);
    return { code: room.code, token, seat: 1, room: this.#view(room, token) };
  }

  snapshot(code, token) {
    const original = this.#room(code); this.#seat(original, token);
    const room = upgradeRoomInvite(original, token); if (room !== original) this.#save(room);
    return this.#view(room, token);
  }

  start(code, token, { rematch = false } = {}) {
    const original = this.#room(code);
    const connected = original.players.map((_, seat) => (this.connections.get(`${original.code}:${seat}`) ?? 0) > 0);
    const room = startRoomRecord(original, token, { rematch, seed: randomBytes(4).readUInt32BE(), connected });
    this.#save(room); return this.#view(room, token);
  }

  action(code, token, data = {}) {
    const room = applyRoomAction(this.#room(code), token, data);
    this.#save(room); return this.#view(room, token);
  }

  subscribe(code, listener) {
    this.#room(code);
    if (!this.listeners.has(code)) this.listeners.set(code, new Set());
    this.listeners.get(code).add(listener);
    return () => { const set = this.listeners.get(code); set?.delete(listener); if (!set?.size) this.listeners.delete(code); };
  }

  connect(code, token) {
    const room = this.#room(code); const seat = this.#seat(room, token); const key = `${room.code}:${seat}`;
    this.connections.set(key, (this.connections.get(key) ?? 0) + 1); this.#broadcast(room.code);
    let closed = false;
    return () => {
      if (closed) return; closed = true;
      const count = (this.connections.get(key) ?? 1) - 1;
      if (count > 0) this.connections.set(key, count); else this.connections.delete(key);
      this.#broadcast(room.code);
    };
  }
}
