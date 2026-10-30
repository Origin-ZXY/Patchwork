import { createGame, applyAction, isCompatibleGame } from '../engine.js';

export class RoomError extends Error {
  constructor(message, status = 400) { super(message); this.status = status; }
}
const cleanName = value => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 16) || '拼布玩家';

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
  };
}

export function createRoomRecord({ code, name, token }) {
  if (!/^[A-Z2-9]{6}$/.test(code) || typeof token !== 'string' || token.length < 20) throw new RoomError('房间初始化失败', 500);
  return { schema: 1, code, status: 'waiting', revision: 0, players: [{ name: cleanName(name), token }, null], game: null };
}

export function joinRoomRecord(original, { name, token }) {
  if (!original) throw new RoomError('没有找到这个房间，请检查房间码', 404);
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
