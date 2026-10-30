import { randomBytes } from 'node:crypto';
import { mkdirSync, readdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { RoomError, createRoomRecord, joinRoomRecord, startRoomRecord, applyRoomAction, snapshotRoom, authenticateRoom } from './room-core.js';
export { RoomError } from './room-core.js';

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

/** One authoritative, synchronous transaction queue per Node process. */
export class RoomStore {
  constructor({ directory = null } = {}) {
    this.directory = directory;
    this.rooms = new Map();
    this.listeners = new Map();
    this.connections = new Map();
    if (!directory) return;
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    for (const file of readdirSync(directory)) {
      if (!/^[A-Z2-9]{6}\.json$/.test(file)) continue;
      try {
        const room = JSON.parse(readFileSync(resolve(directory, file), 'utf8'));
        if (room.schema === 1 && room.code === file.slice(0, 6) && room.players?.length === 2 && room.players[0]?.token && Number.isInteger(room.revision)) this.rooms.set(room.code, room);
      } catch { /* A damaged room must not prevent other rooms from starting. */ }
    }
  }

  #room(code) {
    const room = this.rooms.get(String(code).toUpperCase());
    if (!room) throw new RoomError('没有找到这个房间，请检查房间码', 404);
    return room;
  }

  #seat(room, token) { return authenticateRoom(room, token); }

  #save(room) {
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

  #view(room) {
    return snapshotRoom(room, undefined, { connected: room.players.map((_, seat) => (this.connections.get(`${room.code}:${seat}`) ?? 0) > 0) });
  }

  create({ name } = {}) {
    let code;
    do { code = [...randomBytes(6)].map(byte => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join(''); } while (this.rooms.has(code));
    const token = randomBytes(24).toString('base64url');
    const room = createRoomRecord({ code, name, token });
    this.#save(room);
    return { code, token, seat: 0, room: this.#view(room) };
  }

  join(code, { name } = {}) {
    const token = randomBytes(24).toString('base64url');
    const room = joinRoomRecord(this.#room(code), { name, token });
    this.#save(room);
    return { code: room.code, token, seat: 1, room: this.#view(room) };
  }

  snapshot(code, token) {
    const room = this.#room(code); this.#seat(room, token); return this.#view(room);
  }

  start(code, token, { rematch = false } = {}) {
    const original = this.#room(code);
    const connected = original.players.map((_, seat) => (this.connections.get(`${original.code}:${seat}`) ?? 0) > 0);
    const room = startRoomRecord(original, token, { rematch, seed: randomBytes(4).readUInt32BE(), connected });
    this.#save(room); return this.#view(room);
  }

  action(code, token, data = {}) {
    const room = applyRoomAction(this.#room(code), token, data);
    this.#save(room); return this.#view(room);
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
