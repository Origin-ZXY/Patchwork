import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { CloudRooms } from '../worker/cloud-rooms.js';
import { createWorker } from '../worker/index.js';

// Execute production SQL against real SQLite. Async boundaries reproduce racing
// requests which both load the same version before the conditional update.
class TestD1 {
  constructor() {
    this.database = new DatabaseSync(':memory:');
    this.database.exec('PRAGMA foreign_keys=ON;');
    this.database.exec(readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'));
  }
  withSession() { return this; }
  prepare(sql) {
    const database = this.database; let values = [];
    const statement = {
      bind(...args) { values = args; return statement; },
      execute() { const result = database.prepare(sql).run(...values); return { success: true, meta: { changes: Number(result.changes) } }; },
      async first() { await Promise.resolve(); return database.prepare(sql).get(...values) ?? null; },
      async all() { await Promise.resolve(); return { results: database.prepare(sql).all(...values) }; },
      async run() { await Promise.resolve(); return statement.execute(); }
    };
    return statement;
  }
  async batch(statements) {
    this.database.exec('BEGIN');
    try { const results = statements.map(statement => statement.execute()); this.database.exec('COMMIT'); return results; }
    catch (error) { this.database.exec('ROLLBACK'); throw error; }
  }
  close() { this.database.close(); }
}

function setup(t, options) {
  const db = new TestD1(); t.after(() => db.close());
  return { db, api: new CloudRooms(db, { seed: () => 42, ...options }) };
}
async function started(api) {
  const host = await api.create({ name: '蓝线' });
  const guest = await api.join(host.code, { name: '红线' });
  await api.start(host.code, host.token);
  return [host, guest];
}
function nextAction(game) {
  if (!game.pendingLeather) return { type: 'advance' };
  const board = game.players[game.current].board;
  for (let y = 0; y < 9; y++) for (let x = 0; x < 9; x++) if (board[y][x] == null) return { type: 'leather', x, y };
  throw new Error('Unexpected full board');
}

test('cloud sessions persist across Worker instances without exposing seat credentials', async t => {
  const { db, api } = setup(t), sessions = await started(api);
  for (const session of sessions) {
    const view = await new CloudRooms(db).snapshot(session.code, session.token);
    assert.equal(view.status, 'playing'); assert.equal(view.hosted, true); assert.equal(view.transport, 'poll');
    assert.equal(view.players.length, 2); assert.equal(view.game.players[0].name, '蓝线');
    for (const other of sessions) assert.equal(JSON.stringify(view).includes(other.token), false);
  }
  for (const token of [undefined, null, '', 'f'.repeat(48)]) await assert.rejects(() => api.snapshot(sessions[0].code, token), error => error.status === 401);
});

test('concurrent joins reserve exactly one guest seat and never overwrite the winner', async t => {
  const { db, api } = setup(t), host = await api.create({ name: '房主' });
  const results = await Promise.allSettled(['甲', '乙', '丙'].map(name => new CloudRooms(db).join(host.code, { name })));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected' && result.reason.status === 409).length, 2);
  const winner = results.find(result => result.status === 'fulfilled').value;
  const view = await api.snapshot(host.code, winner.token);
  assert.equal(view.players[1].name, winner.room.players[1].name);
  assert.equal(view.revision, 1);
});

test('CAS commits one racing action and rejects stale or repeated submissions', async t => {
  const { db, api } = setup(t), sessions = await started(api), host = sessions[0];
  const before = await api.snapshot(host.code, host.token), data = { revision: before.revision, action: { type: 'advance' } };
  const results = await Promise.allSettled([0, 1].map(() => new CloudRooms(db).action(host.code, host.token, data)));
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.equal(results.filter(result => result.status === 'rejected' && result.reason.status === 409).length, 1);
  const after = await api.snapshot(host.code, host.token);
  assert.equal(after.revision, before.revision + 1); assert.equal(after.game.players[0].time, 1);
  await assert.rejects(() => api.action(host.code, host.token, data), error => [403, 409].includes(error.status));
});

test('authority rejects non-host starts, wrong turns and impossible placement', async t => {
  const { api } = setup(t), sessions = await started(api), [host, guest] = sessions;
  await assert.rejects(() => api.start(host.code, guest.token), error => error.status === 403);
  const before = await api.snapshot(host.code, host.token);
  await assert.rejects(() => api.action(host.code, guest.token, { revision: before.revision, action: { type: 'advance' } }), error => error.status === 403);
  await assert.rejects(() => api.action(host.code, host.token, { revision: before.revision, action: { type: 'place', patchId: before.game.market[0], x: -10, y: 0 } }), error => error.status === 400);
  const after = await api.snapshot(host.code, host.token);
  assert.deepEqual(after.game, before.game); assert.equal(after.revision, before.revision);
});

test('a complete persisted two-player game finishes and supports host rematch', async t => {
  const { db, api } = setup(t), sessions = await started(api), host = sessions[0];
  let view = await api.snapshot(host.code, host.token), moves = 0;
  while (view.status !== 'finished' && moves++ < 180) {
    const session = sessions[view.game.current];
    view = await new CloudRooms(db).action(host.code, session.token, { revision: view.revision, action: nextAction(view.game) });
  }
  assert.equal(view.status, 'finished'); assert.ok(view.game.players.every(player => player.time === 53));
  await assert.rejects(() => api.start(host.code, sessions[1].token, { rematch: true }), error => error.status === 403);
  await api.snapshot(host.code, sessions[1].token);
  const rematch = await api.start(host.code, host.token, { rematch: true });
  assert.equal(rematch.status, 'playing'); assert.ok(rematch.game.players.every(player => player.time === 0));
});

test('room expiry, guest heartbeat and atomic hashed rate limits use production SQL', async t => {
  let now = 1000;
  const { db, api } = setup(t, { now: () => now }), sessions = await started(api), host = sessions[0];
  assert.ok((await api.snapshot(host.code, host.token)).players.every(player => player.connected));
  now += 36000;
  const view = await api.snapshot(host.code, host.token);
  assert.equal(view.players[0].connected, true); assert.equal(view.players[1].connected, false);
  const limits = await Promise.allSettled(Array.from({ length: 5 }, () => api.limit('create', '203.0.113.8', 2, 60000)));
  assert.equal(limits.filter(result => result.status === 'fulfilled').length, 2);
  assert.equal(limits.filter(result => result.status === 'rejected' && result.reason.status === 429).length, 3);
  assert.equal(JSON.stringify(db.database.prepare('SELECT key FROM patchwork_limits').all()).includes('203.0.113.8'), false);
  now += 7 * 24 * 60 * 60 * 1000 + 1;
  await assert.rejects(() => api.snapshot(host.code, host.token), error => error.status === 404);
  await api.cleanup(); assert.equal(db.database.prepare('SELECT count(*) AS n FROM patchwork_rooms').get().n, 0);
});

test('hosted HTTP matches the browser protocol and keeps private source paths inaccessible', async t => {
  const { db } = setup(t), tasks = [], worker = createWorker({ '/index.html': '<main>Patchwork</main>', '/app.js': 'console.log("game")' });
  async function call(path, { method = 'GET', body, token, origin } = {}) {
    const response = await worker.fetch(new Request('https://patchwork.example' + path, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(origin ? { Origin: origin } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    }), { DB: db }, { waitUntil(promise) { tasks.push(promise); } });
    return { response, value: response.headers.get('Content-Type')?.includes('json') ? await response.json() : await response.text() };
  }
  assert.equal((await call('/')).response.status, 200);
  assert.equal((await call('/api/health')).value.transport, 'poll');
  const host = (await call('/api/rooms', { method: 'POST', body: { name: '房主' } })).value;
  assert.equal((await call(`/api/rooms/${host.code}`)).response.status, 401);
  assert.equal((await call(`/api/rooms/${host.code}?token=${host.token}`)).value.players[0].name, '房主');
  const guest = (await call(`/api/rooms/${host.code}/join`, { method: 'POST', body: { name: '朋友' } })).value;
  const start = await call(`/api/rooms/${host.code}/start`, { method: 'POST', body: { token: host.token } });
  assert.equal(start.response.status, 200); assert.equal(start.value.status, 'playing');
  const action = await call(`/api/rooms/${host.code}/action`, { method: 'POST', token: host.token, body: { revision: start.value.revision, action: { type: 'advance' } } });
  assert.equal(action.response.status, 200); assert.equal(action.value.game.current, guest.seat);
  assert.equal((await call('/api/rooms', { method: 'POST', body: {}, origin: 'https://other.example' })).response.status, 403);
  assert.equal((await call(`/api/rooms/${host.code}/events`, { token: host.token })).value.transport, 'poll');
  for (const path of ['/server/room-core.js', '/worker/cloud-rooms.js', '/.patchwork-rooms/private.json', '/.openai/hosting.json', '/db/schema.sql', '/tests/cloud.test.mjs']) assert.equal((await call(path)).response.status, 404);
  await Promise.all(tasks);
});

test('versioned migration matches the canonical database schema', () => {
  assert.equal(readFileSync(new URL('../db/schema.sql', import.meta.url), 'utf8'), readFileSync(new URL('../drizzle/0000_patchwork_rooms.sql', import.meta.url), 'utf8'));
  const journal = JSON.parse(readFileSync(new URL('../drizzle/meta/_journal.json', import.meta.url), 'utf8'));
  assert.equal(journal.entries[0].tag, '0000_patchwork_rooms');
});
