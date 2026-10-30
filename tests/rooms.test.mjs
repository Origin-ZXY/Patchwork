import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { RoomStore } from '../server/rooms.js';
import { createApp } from '../server/index.js';

function pair(store = new RoomStore()) {
  const host = store.create({ name: '蓝线' });
  const guest = store.join(host.code, { name: '红线' });
  return { store, host, guest };
}

test('two seats only, unique credentials, and no credential in snapshots', () => {
  const { store, host, guest } = pair();
  assert.notEqual(host.token, guest.token);
  assert.throws(() => store.join(host.code, { name: '第三人' }), /坐满/);
  const snapshot = store.snapshot(host.code, host.token);
  assert.deepEqual(snapshot.players.map(player => player.name), ['蓝线', '红线']);
  assert(!JSON.stringify(snapshot).includes(host.token));
  assert(!JSON.stringify(snapshot).includes(guest.token));
  assert.throws(() => store.snapshot(host.code, 'invalid'), { status: 401 });
});

test('only host starts, and a second player is required', () => {
  const store = new RoomStore(); const host = store.create();
  assert.throws(() => store.start(host.code, host.token), /一位朋友/);
  const guest = store.join(host.code);
  assert.throws(() => store.start(host.code, guest.token), { status: 403 });
  assert.equal(store.start(host.code, host.token).status, 'playing');
  assert.throws(() => store.start(host.code, host.token), { status: 409 });
  assert.throws(() => store.join(host.code), /已经开始/);
});

test('server rejects acting out of turn and stale concurrent actions without mutation', () => {
  const { store, host, guest } = pair();
  const before = store.start(host.code, host.token);
  assert.equal(before.game.current, 0);
  assert.throws(() => store.action(host.code, guest.token, { revision: before.revision, action: { type: 'advance' } }), { status: 403 });
  assert.deepEqual(store.snapshot(host.code, host.token), before);
  const after = store.action(host.code, host.token, { revision: before.revision, action: { type: 'advance' } });
  assert.equal(after.revision, before.revision + 1);
  assert.throws(() => store.action(host.code, host.token, { revision: before.revision, action: { type: 'advance' } }), { status: 409 });
  assert.deepEqual(store.snapshot(host.code, guest.token), after);
});

test('illegal engine action is rejected and cannot change authoritative state', () => {
  const { store, host } = pair(); const before = store.start(host.code, host.token);
  assert.throws(() => store.action(host.code, host.token, { revision: before.revision, action: { type: 'place', patchId: 'not-a-patch', x: 0, y: 0 } }));
  assert.deepEqual(store.snapshot(host.code, host.token), before);
});

test('presence survives multiple same-seat streams and disconnect is idempotent', () => {
  const { store, host, guest } = pair(); let changes = 0;
  const unsubscribe = store.subscribe(host.code, () => changes++);
  const a = store.connect(host.code, host.token); const b = store.connect(host.code, host.token); const c = store.connect(host.code, guest.token);
  assert(store.snapshot(host.code, host.token).players.every(player => player.connected));
  a(); a(); assert(store.snapshot(host.code, guest.token).players[0].connected);
  b(); assert(!store.snapshot(host.code, guest.token).players[0].connected);
  c(); assert(!store.snapshot(host.code, host.token).players[1].connected);
  assert.equal(changes, 6); unsubscribe();
});

test('atomic room files restore credentials and current game after server restart', t => {
  const directory = mkdtempSync(resolve(tmpdir(), 'patchwork-rooms-')); t.after(() => rmSync(directory, { recursive: true, force: true }));
  const { store, host, guest } = pair(new RoomStore({ directory }));
  const before = store.start(host.code, host.token);
  const after = store.action(host.code, host.token, { revision: before.revision, action: { type: 'advance' } });
  const recovered = new RoomStore({ directory });
  assert.deepEqual(recovered.snapshot(host.code, guest.token), after);
  assert.deepEqual(readdirSync(directory), [`${host.code}.json`]);
});

test('complete authoritative two-player game reaches finished and can rematch', () => {
  const { store, host, guest } = pair();
  const disconnectA = store.connect(host.code, host.token); const disconnectB = store.connect(host.code, guest.token);
  let room = store.start(host.code, host.token); let actions = 0;
  while (room.status === 'playing' && actions++ < 120) {
    const token = room.game.current === 0 ? host.token : guest.token;
    const action = room.game.pendingLeather ? { type: 'leather', x: room.game.players[room.game.current].board[0].findIndex(cell => !cell), y: 0 } : { type: 'advance' };
    if (room.game.pendingLeather) {
      const board = room.game.players[room.game.current].board;
      for (let y = 0; y < 9; y++) { const x = board[y].findIndex(cell => !cell); if (x >= 0) { action.x = x; action.y = y; break; } }
    }
    room = store.action(host.code, token, { revision: room.revision, action });
  }
  assert.equal(room.status, 'finished');
  assert.throws(() => store.start(host.code, guest.token, { rematch: true }), { status: 403 });
  disconnectB(); assert.throws(() => store.start(host.code, host.token, { rematch: true }), /重新连接/);
  const reconnect = store.connect(host.code, guest.token);
  assert.equal(store.start(host.code, host.token, { rematch: true }).status, 'playing');
  disconnectA(); reconnect();
});

async function httpFixture(t) {
  const app = createApp({ directory: null });
  await new Promise((resolve, reject) => { app.server.once('error', reject); app.server.listen(0, '127.0.0.1', resolve); });
  t.after(async () => { app.stopStreams(); app.server.closeAllConnections(); await new Promise(resolve => app.server.close(resolve)); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const post = async (path, value) => { const response = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(value) }); return { status: response.status, value: await response.json() }; };
  return { app, base, post };
}

test('HTTP serves game, rejects hidden/internal files, and enforces same-origin commands', async t => {
  const { base } = await httpFixture(t);
  assert.equal((await fetch(base + '/')).status, 200);
  assert.equal((await fetch(base + '/api/health')).status, 200);
  for (const path of ['/.git/config', '/server/index.js', '/tests/rooms.test.mjs', '/.patchwork-rooms/AAAAAA.json', '/%2e%2e/.git/config', '/worker/index.js']) assert.equal((await fetch(base + path)).status, 404, path);
  assert.equal((await fetch(base + '/api/rooms', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: 'https://other.example' }, body: '{}' })).status, 403);
  assert.equal((await fetch(base + '/api/rooms', { method: 'POST', body: '{}' })).status, 415);
});

test('HTTP API uses credentials and revision and reports current snapshot after conflict', async t => {
  const { base, post } = await httpFixture(t);
  const host = (await post('/api/rooms', { name: '甲' })).value;
  const guest = (await post(`/api/rooms/${host.code}/join`, { name: '乙' })).value;
  assert.equal((await fetch(`${base}/api/rooms/${host.code}?token=wrong`)).status, 401);
  assert.equal((await post(`/api/rooms/${host.code}/start`, { token: guest.token })).status, 403);
  const started = (await post(`/api/rooms/${host.code}/start`, { token: host.token })).value;
  const wrongTurn = await post(`/api/rooms/${host.code}/action`, { token: guest.token, revision: started.revision, action: { type: 'advance' } });
  assert.equal(wrongTurn.status, 403);
  const moved = await post(`/api/rooms/${host.code}/action`, { token: host.token, revision: started.revision, action: { type: 'advance' } });
  assert.equal(moved.status, 200);
  const stale = await post(`/api/rooms/${host.code}/action`, { token: guest.token, revision: started.revision, action: { type: 'advance' } });
  assert.equal(stale.status, 409); assert.equal(stale.value.room.revision, moved.value.revision);
});

test('SSE streams synchronize host and guest with authoritative updates', async t => {
  const { base, post } = await httpFixture(t);
  const host = (await post('/api/rooms', { name: '甲' })).value;
  const guest = (await post(`/api/rooms/${host.code}/join`, { name: '乙' })).value;
  const abortA = new AbortController(); const abortB = new AbortController();
  t.after(() => { abortA.abort(); abortB.abort(); });
  async function open(player, signal) {
    const response = await fetch(`${base}/api/rooms/${host.code}/events?token=${player.token}`, { signal });
    assert.equal(response.headers.get('content-type'), 'text/event-stream; charset=utf-8');
    const reader = response.body.getReader(); let buffer = '';
    return async revision => {
      while (true) {
        const split = buffer.indexOf('\n\n');
        if (split >= 0) { const frame = buffer.slice(0, split); buffer = buffer.slice(split + 2); if (frame.startsWith('data: ')) { const room = JSON.parse(frame.slice(6)); if (room.revision >= revision) return room; } continue; }
        let timer;
        const value = await Promise.race([reader.read(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('SSE event timeout')), 3000); })]).finally(() => clearTimeout(timer));
        if (value.done) throw new Error('SSE ended early');
        buffer += new TextDecoder().decode(value.value);
      }
    };
  }
  const readA = await open(host, abortA.signal); const readB = await open(guest, abortB.signal);
  const started = (await post(`/api/rooms/${host.code}/start`, { token: host.token })).value;
  assert.equal((await readA(started.revision)).status, 'playing');
  assert.equal((await readB(started.revision)).status, 'playing');
  const moved = (await post(`/api/rooms/${host.code}/action`, { token: host.token, revision: started.revision, action: { type: 'advance' } })).value;
  assert.deepEqual((await readA(moved.revision)).game, moved.game);
  assert.deepEqual((await readB(moved.revision)).game, moved.game);
});
