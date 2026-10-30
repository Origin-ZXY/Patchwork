import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { CloudRooms } from '../worker/cloud-rooms.js';
import { createWorker } from '../worker/index.js';

const verificationEnv = { TURNSTILE_SITE_KEY: 'unit-site-key', TURNSTILE_SECRET_KEY: 'unit-private-key', TURNSTILE_EXPECTED_HOSTNAME: 'patchwork.example' };
function verificationFetch(result = {}) {
  const used = new Set();
  return async (url, options) => {
    assert.equal(url, 'https://challenges.cloudflare.com/turnstile/v0/siteverify');
    assert.equal(options.body.get('secret'), verificationEnv.TURNSTILE_SECRET_KEY);
    const token = options.body.get('response'), replay = used.has(token); used.add(token);
    return Response.json({ success: !replay, hostname: 'patchwork.example', action: 'patchwork_room', ...result });
  };
}

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
  const guest = await api.join(host.code, { name: '红线', inviteKey: host.room.inviteKey });
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
  const results = await Promise.allSettled(['甲', '乙', '丙'].map(name => new CloudRooms(db).join(host.code, { name, inviteKey: host.room.inviteKey })));
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
  const { db } = setup(t), tasks = [], worker = createWorker({ '/index.html': '<main>Patchwork</main>', '/app.js': 'console.log("game")' }, { verifyFetch: verificationFetch() });
  async function call(path, { method = 'GET', body, token, origin } = {}) {
    const response = await worker.fetch(new Request('https://patchwork.example' + path, {
      method,
      headers: { ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(origin ? { Origin: origin } : {}) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) })
    }), { DB: db, ...verificationEnv }, { waitUntil(promise) { tasks.push(promise); } });
    return { response, value: response.headers.get('Content-Type')?.includes('json') ? await response.json() : await response.text() };
  }
  assert.equal((await call('/')).response.status, 200);
  assert.equal((await call('/api/health')).value.transport, 'poll');
  const host = (await call('/api/rooms', { method: 'POST', body: { name: '房主', turnstileToken: 'host-test-token' } })).value;
  assert.equal((await call(`/api/rooms/${host.code}`)).response.status, 401);
  assert.equal((await call(`/api/rooms/${host.code}?token=${host.token}`)).value.players[0].name, '房主');
  const guest = (await call(`/api/rooms/${host.code}/join`, { method: 'POST', body: { name: '朋友', inviteKey: host.room.inviteKey, turnstileToken: 'guest-test-token' } })).value;
  const start = await call(`/api/rooms/${host.code}/start`, { method: 'POST', body: { token: host.token } });
  assert.equal(start.response.status, 200); assert.equal(start.value.status, 'playing');
  const action = await call(`/api/rooms/${host.code}/action`, { method: 'POST', token: host.token, body: { revision: start.value.revision, action: { type: 'advance' } } });
  assert.equal(action.response.status, 200); assert.equal(action.value.game.current, guest.seat);
  assert.equal((await call('/api/rooms', { method: 'POST', body: {}, origin: 'https://other.example' })).response.status, 403);
  assert.equal((await call(`/api/rooms/${host.code}/events`, { token: host.token })).value.transport, 'poll');
  for (const path of ['/server/room-core.js', '/worker/cloud-rooms.js', '/.patchwork-rooms/private.json', '/.openai/hosting.json', '/db/schema.sql', '/tests/cloud.test.mjs']) assert.equal((await call(path)).response.status, 404);
  await Promise.all(tasks);
});

test('append-only migrations preserve existing rooms and match the fresh schema', () => {
  const migrated = new DatabaseSync(':memory:'), fresh = new TestD1();
  try {
    const journal = JSON.parse(readFileSync(new URL('../drizzle/meta/_journal.json', import.meta.url), 'utf8'));
    assert.equal(journal.entries[0].tag, '0000_patchwork_rooms');
    migrated.exec(readFileSync(new URL('../drizzle/0000_patchwork_rooms.sql', import.meta.url), 'utf8'));
    migrated.prepare('INSERT INTO patchwork_rooms (code,body,expires_at) VALUES (?,?,?)').run('AAAAAA','untouched',9999999999999);
    for (const entry of journal.entries.slice(1)) migrated.exec(readFileSync(new URL('../drizzle/' + entry.tag + '.sql', import.meta.url), 'utf8'));
    assert.equal(migrated.prepare('SELECT body FROM patchwork_rooms').get().body, 'untouched');
    for (const table of ['patchwork_rooms','patchwork_presence','patchwork_limits']) {
      assert.deepEqual(migrated.prepare('PRAGMA table_info(' + table + ')').all(), fresh.database.prepare('PRAGMA table_info(' + table + ')').all());
      const indexes = db => db.prepare('PRAGMA index_list(' + table + ')').all().map(row => row.name).sort();
      assert.deepEqual(indexes(migrated), indexes(fresh.database));
    }
  } finally { migrated.close(); fresh.close(); }
});

test('strong invitations are host-only, required to join and separate from seat credentials', async t => {
  const { api } = setup(t), host = await api.create();
  const inviteKey = host.room.inviteKey;
  assert.match(inviteKey, /^[a-f0-9]{48}$/); assert.notEqual(inviteKey, host.token);
  for (const value of [undefined, '', 'a'.repeat(48), host.token]) {
    if (value !== inviteKey) await assert.rejects(() => api.join(host.code, { inviteKey: value }), error => error.status === 403);
  }
  assert.equal((await api.snapshot(host.code, host.token)).players[1], null);
  const guest = await api.join(host.code, { inviteKey });
  assert.equal(guest.room.inviteKey, undefined);
  assert.equal((await api.snapshot(host.code, guest.token)).inviteKey, undefined);
  assert.equal((await api.start(host.code, host.token)).inviteKey, undefined);
});

test('legacy waiting hosts receive a secure invitation without losing their room or seats', async t => {
  const { db, api } = setup(t), host = await api.create();
  const record = JSON.parse(db.database.prepare('SELECT body FROM patchwork_rooms WHERE code=?').get(host.code).body);
  delete record.inviteKey; record.schema = 1;
  db.database.prepare('UPDATE patchwork_rooms SET body=? WHERE code=?').run(JSON.stringify(record), host.code);
  await assert.rejects(() => api.join(host.code, { inviteKey: host.room.inviteKey }), error => error.status === 403);
  const upgraded = await api.snapshot(host.code, host.token);
  assert.match(upgraded.inviteKey, /^[a-f0-9]{48}$/); assert.equal(upgraded.code, host.code); assert.equal(upgraded.revision, 0);
  assert.deepEqual(upgraded.players, host.room.players);
  const guest = await api.join(host.code, { inviteKey: upgraded.inviteKey });
  assert.equal(guest.seat, 1);
});

test('atomic global capacity holds across concurrent Worker instances; expired waiting rooms release space', async t => {
  let now = Date.now(); const { db, api } = setup(t, { now: () => now, maximumRooms: 4 });
  const results = await Promise.allSettled(Array.from({ length: 12 }, (_, i) => new CloudRooms(db, { now: () => now, maximumRooms: 4 }).create({}, `ip-${i}`)));
  const hosts = results.filter(result => result.status === 'fulfilled').map(result => result.value);
  assert.equal(hosts.length, 4); assert.equal(results.filter(result => result.reason?.status === 429).length, 8);
  assert.equal(db.database.prepare('SELECT count(*) AS n FROM patchwork_rooms WHERE expires_at>?').get(now).n, 4);
  const guest = await api.join(hosts[0].code, { inviteKey: hosts[0].room.inviteKey });
  await api.start(hosts[0].code, hosts[0].token);
  now += 30 * 60000 + 1;
  await assert.rejects(() => api.snapshot(hosts[1].code, hosts[1].token), error => error.status === 404);
  assert.equal((await api.snapshot(hosts[0].code, guest.token)).status, 'playing');
  assert.equal((await api.create({}, 'fresh-ip')).seat, 0);
});

test('one creator can reserve only three rooms and their address is hashed', async t => {
  const { db, api } = setup(t);
  for (let i = 0; i < 3; i++) await api.create({}, '203.0.113.77');
  await assert.rejects(() => api.create({}, '203.0.113.77'), error => error.status === 429);
  assert.equal((await api.create({}, '203.0.113.78')).seat, 0);
  assert.equal(JSON.stringify(db.database.prepare('SELECT creator_hash FROM patchwork_rooms').all()).includes('203.0.113.'), false);
});

test('authenticated read budget persists across instances and recovers in the next minute', async t => {
  let now = 120000; const { db, api } = setup(t, { now: () => now }), host = await api.create();
  for (let i = 1; i < 120; i++) await new CloudRooms(db, { now: () => now }).snapshot(host.code, host.token);
  await assert.rejects(() => api.snapshot(host.code, host.token), error => error.status === 429 && error.retryAfter > 0);
  assert.equal(db.database.prepare('SELECT count(*) AS n FROM patchwork_presence').get().n, 1);
  now += 60000; assert.equal((await api.snapshot(host.code, host.token)).code, host.code);
});

function httpSecurityFixture(t, result, configured = true) {
  const { db } = setup(t), worker = createWorker({}, { verifyFetch: verificationFetch(result) });
  const env = { DB: db, ...(configured ? verificationEnv : {}) };
  const call = async (path, body, ip = '203.0.113.1', token) => worker.fetch(new Request('https://patchwork.example' + path, {
    method: body === undefined ? 'GET' : 'POST', headers: { 'CF-Connecting-IP': ip, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...(token ? { Authorization: 'Bearer ' + token } : {}) }, ...(body === undefined ? {} : { body: JSON.stringify(body) })
  }), env);
  return { db, call };
}

test('hosted create/join require verified, single-use, correctly scoped Turnstile tokens', async t => {
  const { db, call } = httpSecurityFixture(t);
  assert.equal((await call('/api/rooms', {})).status, 403);
  const response = await call('/api/rooms', { turnstileToken: 'one-use' }); assert.equal(response.status, 201);
  const host = await response.json();
  assert.equal((await call('/api/rooms', { turnstileToken: 'one-use' }, '203.0.113.2')).status, 403);
  assert.equal((await call(`/api/rooms/${host.code}/join`, { inviteKey: host.room.inviteKey })).status, 403);
  assert.equal((await call(`/api/rooms/${host.code}/join`, { turnstileToken: 'guest' })).status, 403);
  const joined = await call(`/api/rooms/${host.code}/join`, { turnstileToken: 'guest', inviteKey: host.room.inviteKey }); assert.equal(joined.status, 201);
  assert.equal((await joined.json()).room.inviteKey, undefined);
  const security = await (await call('/api/security')).json();
  assert.equal(security.siteKey, verificationEnv.TURNSTILE_SITE_KEY); assert.equal(security.roomLimit, 20);
  assert.equal(JSON.stringify(security).includes(verificationEnv.TURNSTILE_SECRET_KEY), false);
  assert.equal(db.database.prepare('SELECT count(*) AS n FROM patchwork_rooms').get().n, 1);
});

for (const [name, result] of [['failed challenge', { success: false }], ['foreign hostname', { hostname: 'evil.example' }], ['wrong action', { action: 'other_form' }]]) {
  test(`Turnstile rejects ${name} before touching D1`, async t => {
    const { db, call } = httpSecurityFixture(t, result); let queries = 0;
    db.prepare = () => { queries++; throw new Error('Must not touch D1'); };
    assert.equal((await call('/api/rooms', { turnstileToken: 'value' })).status, 403); assert.equal(queries, 0);
  });
}

test('missing verification config fails closed; malformed and flooded requests avoid database work', async t => {
  const { db, call } = httpSecurityFixture(t, undefined, false); let queries = 0;
  db.prepare = () => { queries++; throw new Error('Must not touch D1'); };
  assert.equal((await call('/api/security')).status, 503);
  assert.equal((await call('/api/rooms', { turnstileToken: 'value' })).status, 503);
  assert.equal((await call('/api/health')).status, 200);
  assert.equal((await call('/api/no-such-route')).status, 404);
  assert.equal((await call('/api/rooms/AAAAAA', undefined, '203.0.113.2', 'bad')).status, 401);
  for (let i = 0; i < 181; i++) {
    const response = await call('/api/rooms/AAAAAA', undefined, '203.0.113.3');
    assert.equal(response.status, i < 180 ? 401 : 429);
    if (i === 180) assert.ok(Number(response.headers.get('Retry-After')) > 0);
  }
  assert.equal(queries, 0);
});

test('forged seat tokens never create action rate-limit rows or trigger resync reads', async t => {
  const { db, call } = httpSecurityFixture(t), api = new CloudRooms(db), host = await api.create();
  const before = db.database.prepare('SELECT count(*) AS n FROM patchwork_limits').get().n;
  for (let i = 0; i < 5; i++) {
    const response = await call(`/api/rooms/${host.code}/action`, { token: (i + 1).toString().repeat(48), revision: 0, action: { type: 'advance' } });
    assert.equal(response.status, 401); assert.equal((await response.json()).room, undefined);
  }
  assert.equal(db.database.prepare('SELECT count(*) AS n FROM patchwork_limits').get().n, before);
});
