import { createGame, applyAction, isCompatibleGame } from '../engine.js';

export class RoomError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const cleanName = value => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 16) || '拼布玩家';
export const INVITE_KEY_PATTERN = /^[a-f0-9]{48}$/i;
export const newInviteKey = () => Array.from(crypto.getRandomValues(new Uint8Array(24)), byte => byte.toString(16).padStart(2, '0')).join('');

function equalSecret(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || left.length !== right.length) return false;
  let difference = 0;
  for (let i = 0; i < left.length; i++) difference |= left.charCodeAt(i) ^ right.charCodeAt(i);
  return difference === 0;
}

export function upgradeRoomInvite(original, token) {
  if (original.inviteKey || original.status !== 'waiting' || authenticateRoom(original, token) !== 0) return original;
  return { ...structuredClone(original), schema: 2, inviteKey: newInviteKey() };
}

function requireCompatibleGame(room) {
  if (room.game && !isCompatibleGame(room.game)) throw new RoomError('此房间使用旧版棋盘规则，请创建新房间开始经典版对局。', 410);
}

export function authenticateRoom(room, token) {
  if (!room) throw new RoomError('没有找到这个房间，请检查房间码', 404);
  if (typeof token !== 'string' || token.length < 20) throw new RoomError('座位凭证无效，请重新加入房间', 401);
  const seat = room.players.findIndex(player => player?.token === token);
  if (seat < 0) throw new RoomError('座位凭证无效，请重新加入房间', 401);
  requireCompatibleGame(room);
  return seat;
}

export function snapshotRoom(room, token, { connected = [false, false] } = {}) {
  if (!room) throw new RoomError('没有找到这个房间，请检查房间码', 404);
  if (token !== undefined) authenticateRoom(room, token);
  requireCompatibleGame(room);
  return {
    code: room.code, status: room.status, revision: room.revision,
    players: room.players.map((player, seat) => player ? { name: player.name, connected: Boolean(connected[seat]) } : null),
    game: room.game ? structuredClone(room.game) : null,
    ...(token === room.players[0]?.token && room.status === 'waiting' && room.inviteKey ? { inviteKey: room.inviteKey } : {}),
  };
}

export function createRoomRecord({ code, name, token }) {
  if (!/^[A-Z2-9]{6}$/.test(code) || typeof token !== 'string' || token.length < 20) throw new RoomError('房间初始化失败', 500);
  return { schema: 2, code, inviteKey: newInviteKey(), status: 'waiting', revision: 0, players: [{ name: cleanName(name), token }, null], game: null };
}

export function joinRoomRecord(original, { name, token, inviteKey }) {
  if (!original) throw new RoomError('没有找到这个房间，请检查房间码', 404);
  if (!original.inviteKey) throw new RoomError('邀请链接已升级，请让房主刷新页面并重新发送邀请', 403);
  if (!INVITE_KEY_PATTERN.test(inviteKey ?? '') || !equalSecret(original.inviteKey, inviteKey)) throw new RoomError('邀请口令无效，请使用房主发来的完整邀请链接', 403);
  const room = structuredClone(original);
  if (room.status !== 'waiting') throw new RoomError('对局已经开始，无法加入', 409);
  if (room.players[1]) throw new RoomError('房间已经坐满两位玩家', 409);
  if (typeof token !== 'string' || token.length < 20) throw new RoomError('座位初始化失败', 500);
  room.players[1] = { name: cleanName(name), token }; room.revision += 1;
  return room;
}

export function startRoomRecord(original, token, { rematch = false, seed, connected = [true, true] } = {}) {
  const room = structuredClone(original);
  if (authenticateRoom(room, token) !== 0) throw new RoomError('只有房主可以开始对局', 403);
  if (!room.players[1]) throw new RoomError('还需要一位朋友加入');
  if (!rematch && room.status !== 'waiting') throw new RoomError('对局已经开始', 409);
  if (rematch && room.status !== 'finished') throw new RoomError('请先完成这一局，再开始新局', 409);
  if (rematch && connected.some(value => !value)) throw new RoomError('请等待两位玩家都重新连接');
  room.game = createGame({ seed, names: room.players.map(player => player.name) });
  room.status = 'playing'; room.revision += 1;
  return room;
}

export function applyRoomAction(original, token, { revision, action } = {}) {
  const room = structuredClone(original); const seat = authenticateRoom(room, token);
  if (room.status !== 'playing') throw new RoomError(room.status === 'finished' ? '这一局已经结束' : '请等待房主开始对局', 409);
  if (!Number.isInteger(revision) || revision !== room.revision) throw new RoomError('棋局刚刚更新，请重新操作', 409);
  if (room.game.current !== seat) throw new RoomError('现在轮到对方行动，请稍等', 403);
  try { room.game = applyAction(room.game, action); }
  catch (error) { throw new RoomError(error.message || '这一步无法执行'); }
  room.status = room.game.finished ? 'finished' : 'playing'; room.revision += 1;
  return room;
}
