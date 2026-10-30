import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomClient, hostedMultiplayerRedirect, HOSTED_MULTIPLAYER_URL, readInvitation, invitationURL } from '../room-client.js';
import { GAME_VERSION, PATCH_SET_ID, TIME_BOARD_ID } from '../engine.js';

const SESSION_KEY = 'patchwork-room-v2';
const tick = () => new Promise(resolve => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const reply = (value, status = 200, headers = {}) => Response.json(structuredClone(value), { status, headers });
const room = (code = 'AAAAAA', revision = 0) => ({ code, revision, status: 'playing', players: [{ name: '甲', connected: true }, { name: '乙', connected: true }], game: { version: GAME_VERSION, patchSet: PATCH_SET_ID, timeBoard: TIME_BOARD_ID, revision, current: 0, finished: false } });
const credential = (snapshot, seat = 0) => ({ code: snapshot.code, token: `credential-${snapshot.code}-abcdefghijklmnop`, seat, room: snapshot });

test('GitHub Pages online entry uses the hosted lobby and preserves normalized room codes', () => {
  const destination = new URL(hostedMultiplayerRedirect('https://origin-zxy.github.io/Patchwork/?room=ab2c3d'));
  assert.equal(destination.origin, new URL(HOSTED_MULTIPLAYER_URL).origin);
  assert.equal(destination.searchParams.get('online'), '1');
  assert.equal(destination.searchParams.get('room'), 'AB2C3D');
  assert.equal(new URL(hostedMultiplayerRedirect('https://origin-zxy.github.io/Patchwork/index.html')).searchParams.get('online'), '1');
});

test('online routing keeps local and hosted sessions on their own service', () => {
  for (const url of [HOSTED_MULTIPLAYER_URL, 'http://127.0.0.1:4174/?room=AB2C3D', 'https://origin-zxy.github.io/OtherGame/']) {
    assert.equal(hostedMultiplayerRedirect(url), null);
  }
});

test('online routing never forwards credentials, arbitrary destinations or invalid room codes', () => {
  const destination = new URL(hostedMultiplayerRedirect('https://origin-zxy.github.io/Patchwork/?room=invalid&token=private&redirect=https://example.com'));
  assert.deepEqual([...destination.searchParams], [['online', '1']]);
});

/** Browser network/timer doubles: no sockets, dependencies, or real polling waits. */
function browser(t) {
  const keys = ['fetch', 'sessionStorage', 'EventSource', 'setInterval', 'clearInterval'];
  const originals = new Map(keys.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  const memory = new Map(), timers = new Map(), sources = [], calls = [], clients = [];
  let timerId = 0;
  const environment = {
    memory, timers, sources, calls,
    handler: () => { throw new Error('Unexpected request'); },
    client() { const value = new RoomClient(); clients.push(value); return value; },
  };
  globalThis.sessionStorage = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, value), removeItem: key => memory.delete(key) };
  globalThis.setInterval = callback => { timers.set(++timerId, callback); return timerId; };
  globalThis.clearInterval = id => timers.delete(id);
  globalThis.EventSource = class {
    constructor(url) { this.url = url; this.closed = false; sources.push(this); }
    close() { this.closed = true; }
    open() { this.onopen?.(); }
    emit(value) { this.onmessage?.({ data: JSON.stringify(value) }); }
  };
  globalThis.fetch = async (path, options = {}) => {
    const data = options.body ? JSON.parse(options.body) : undefined;
    calls.push({ path, data, headers: options.headers });
    if (path === '/api/health') return reply({ ok: true, transport: 'sse' });
    return environment.handler(path, data);
  };
  t.after(() => {
    for (const client of clients) client.leave();
    for (const [key, descriptor] of originals) if (descriptor) Object.defineProperty(globalThis, key, descriptor); else delete globalThis[key];
  });
  return environment;
}

test('leave during an in-flight action cannot restore an obsolete room or session', async t => {
  const env = browser(t), initial = room(), pending = deferred();
  env.handler = path => path === '/api/rooms' ? reply(credential(initial)) : pending.promise;
  const client = env.client(), changes = [];
  client.addEventListener('change', event => changes.push(event.detail));
  await client.create('甲'); await tick(); env.sources[0].open();
  const action = client.send({ type: 'advance' });
  assert.equal(client.busy, true);
  client.leave();
  pending.resolve(reply(room('AAAAAA', 1)));
  await action;
  assert.equal(client.session, null); assert.equal(client.room, null); assert.equal(client.busy, false);
  assert.equal(changes.length, 2); assert.equal(changes.at(-1), null);
  assert.equal(env.memory.has(SESSION_KEY), false); assert.equal(env.timers.size, 0); assert(env.sources[0].closed);
});

test('a new room with the same revision is accepted; old responses cannot clear its busy state', async t => {
  const env = browser(t), oldPending = deferred(), newPending = deferred(); let creations = 0;
  env.handler = (path) => {
    if (path === '/api/rooms') return reply(credential(room(++creations === 1 ? 'AAAAAA' : 'BBBBBB', 2)));
    return path.includes('/AAAAAA/') ? oldPending.promise : newPending.promise;
  };
  const client = env.client(); await client.create('甲');
  const oldAction = client.send({ type: 'advance' });
  client.leave(); await client.create('丙');
  assert.equal(client.room.code, 'BBBBBB'); assert.equal(client.room.revision, 2);
  const newAction = client.send({ type: 'advance' });
  oldPending.resolve(reply(room('AAAAAA', 3))); await oldAction;
  assert.equal(client.room.code, 'BBBBBB'); assert.equal(client.busy, true);
  newPending.resolve(reply(room('BBBBBB', 3))); await newAction;
  assert.equal(client.room.code, 'BBBBBB'); assert.equal(client.room.revision, 3); assert.equal(client.busy, false);
});

test('refresh restores the same seat using sessionStorage and reconnects once', async t => {
  const env = browser(t), snapshot = room('CCCCCC', 8), saved = credential(snapshot, 1);
  env.memory.set(SESSION_KEY, JSON.stringify({ code: saved.code, token: saved.token, seat: saved.seat }));
  env.handler = path => {
    assert.equal(path, `/api/rooms/${saved.code}`);
    return reply(snapshot);
  };
  const client = env.client(); assert.equal(await client.restore(), true); await tick();
  assert.deepEqual(client.session, { code: saved.code, token: saved.token, seat: 1 });
  assert.equal(client.room.revision, 8); assert.equal(env.sources.length, 1); assert.equal(env.timers.size, 1);
  env.sources[0].open(); assert.equal(client.connected, true);
});

test('expired stored credentials are removed and produce a recoverable error', async t => {
  const env = browser(t), saved = credential(room('DDDDDD'));
  env.memory.set(SESSION_KEY, JSON.stringify({ code: saved.code, token: saved.token, seat: 0 }));
  env.handler = () => reply({ message: '座位凭证无效，请重新加入房间' }, 401);
  const client = env.client(), errors = [];
  client.addEventListener('error', event => errors.push(event.detail));
  assert.equal(await client.restore(), false);
  assert.equal(client.session, null); assert.equal(client.room, null); assert.equal(env.memory.has(SESSION_KEY), false);
  assert.equal(errors.length, 1); assert.match(errors[0], /座位凭证无效/); assert.equal(env.timers.size, 0);
});

test('busy prevents duplicate commands and clears after both success and conflict', async t => {
  const env = browser(t), pending = deferred(); let attempt = 0;
  env.handler = (path, data) => {
    if (path === '/api/rooms') return reply(credential(room('EEEEEE', 4)));
    assert.equal(data.revision, attempt === 0 ? 4 : 5);
    return ++attempt === 1 ? pending.promise : reply({ message: '棋局刚刚更新，请重新操作', room: room('EEEEEE', 6) }, 409);
  };
  const client = env.client(); await client.create('甲');
  const first = client.send({ type: 'advance' });
  await assert.rejects(client.send({ type: 'advance' }), /正在同步/);
  assert.equal(attempt, 1);
  pending.resolve(reply(room('EEEEEE', 5))); await first;
  assert.equal(client.busy, false); assert.equal(client.room.revision, 5);
  await assert.rejects(client.send({ type: 'advance' }), /棋局刚刚更新/);
  assert.equal(client.busy, false); assert.equal(client.room.revision, 6);
});

test('classic update releases obsolete online seats and permits creating a fresh room', async t => {
  const env=browser(t),saved=credential(room('DDDDDD'));
  env.memory.set(SESSION_KEY,JSON.stringify({code:saved.code,token:saved.token,seat:0}));
  env.handler=()=>reply({message:'此房间使用旧版自制布料，请创建新房间开始经典版对局。'},410);
  const client=env.client(),errors=[];
  client.addEventListener('error',event=>errors.push(event.detail));
  assert.equal(await client.restore(),false);
  assert.equal(client.session,null);assert.equal(client.room,null);
  assert.equal(env.memory.has(SESSION_KEY),false);
  assert.match(errors[0],/经典版/);
  env.handler=()=>reply(credential(room('EEEEEE')));
  await client.create('甲');
  assert.equal(client.session.code,'EEEEEE');
});

test('a legacy snapshot cannot be attached to a classic client even if its revision is newer', async t => {
  const env=browser(t),legacy=room('DDDDDD');
  legacy.game.version=1;delete legacy.game.patchSet;
  env.handler=()=>reply(credential(legacy));
  const client=env.client();
  await assert.rejects(client.create('甲'),error=>error.status===410&&/经典版/.test(error.message));
  assert.equal(client.room,null);
  assert.equal(client.session,null);
  assert.equal(env.memory.has(SESSION_KEY),false);
});

test('duplicate and older events preserve selection by avoiding redundant change events', async t => {
  const env = browser(t), initial = room('FFFFFF', 7);
  env.handler = () => reply(credential(initial));
  const client = env.client(), changes = [];
  client.addEventListener('change', event => changes.push(event.detail));
  await client.create('甲'); await tick();
  const source = env.sources[0];
  source.emit(initial); source.emit(room('FFFFFF', 6)); source.emit(room('GGGGGG', 99));
  assert.equal(changes.length, 1);
  const presence = structuredClone(initial); presence.players[1].connected = false; source.emit(presence);
  assert.equal(changes.length, 2); assert.equal(client.room.revision, 7);
  source.emit(room('FFFFFF', 8)); assert.equal(changes.length, 3); assert.equal(client.room.revision, 8);
});

test('join normalizes the room code and publishes the assigned guest seat', async t => {
  const env = browser(t), snapshot = room('HHHHHH', 1);
  env.handler = (path, data) => {
    assert.equal(path, '/api/rooms/HHHHHH/join'); assert.equal(data.name, '朋友'); assert.equal(data.inviteKey, 'a'.repeat(48)); assert.equal(data.turnstileToken, 'verification-token'); return reply(credential(snapshot, 1));
  };
  const client = env.client(); await client.join('  hhhhhh  ', '朋友', 'a'.repeat(48), 'verification-token');
  assert.equal(client.session.seat, 1); assert.equal(client.room.code, 'HHHHHH');
  await assert.rejects(client.join('bad', '朋友'), /6 位房间码/);
});

test('safe invitations keep the join secret in a fragment and survive static-site routing', () => {
  const inviteKey = 'b'.repeat(48), url = invitationURL('https://origin-zxy.github.io/Patchwork/?token=remove#old', 'AB2C3D', inviteKey);
  assert.equal(new URL(url).search, '?room=AB2C3D'); assert.equal(new URL(url).hash, '#invite=' + inviteKey);
  assert.deepEqual(readInvitation(url), { code: 'AB2C3D', inviteKey });
  assert.deepEqual(readInvitation(inviteKey.toUpperCase()), { code: '', inviteKey });
  const cloud = new URL(hostedMultiplayerRedirect(url)); assert.equal(cloud.hash, '#invite=' + inviteKey);
  assert.equal(cloud.searchParams.get('token'), null);
  assert.throws(() => invitationURL(HOSTED_MULTIPLAYER_URL, 'AB2C3D', 'bad'), /刷新房间/);
});

test('restored snapshots use bearer headers and preserve host invitation credentials', async t => {
  const env = browser(t), snapshot = room('CCCCCC', 1), inviteKey = 'c'.repeat(48); snapshot.status = 'waiting'; snapshot.game = null; snapshot.inviteKey = inviteKey;
  env.handler = () => reply(credential(snapshot));
  const client = env.client(); await client.create('甲');
  assert.equal(client.session.inviteKey, inviteKey); client.leave();
  const saved = credential(snapshot); env.handler = () => reply(snapshot); env.memory.set(SESSION_KEY, JSON.stringify({ code: saved.code, token: saved.token, seat: 0 }));
  assert.equal(await client.restore(), true);
  const call = env.calls.find(value => value.path === '/api/rooms/CCCCCC');
  assert.equal(call.headers.Authorization, 'Bearer ' + saved.token); assert.equal(call.path.includes('token='), false);
  assert.equal(JSON.parse(env.memory.get(SESSION_KEY)).inviteKey, inviteKey);
});

test('rate-limited polling honors Retry-After instead of retrying every two seconds', async t => {
  const env = browser(t), snapshot = room('CCCCCC');
  env.handler = path => path === '/api/rooms' ? reply(credential(snapshot)) : reply({ message: '稍后重试' }, 429, { 'Retry-After': '60' });
  const client = env.client(); await client.create('甲'); await tick();
  const refresh = [...env.timers.values()][0]; await refresh(); const before = env.calls.length;
  await refresh(); await refresh(); assert.equal(env.calls.length, before);
});
