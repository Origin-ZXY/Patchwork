/**
 * Browser/server shared, immutable Patchwork rules.
 * All 33 ordinary patches use the classic physical edition shapes/cost/time/income.
 * Reference IDs and provenance: docs/classic-patches.md; independent fixture: tests/fixtures/classic-patches.json.
 * Time events follow the classic board with Lookout's 2017 leather-patch correction.
 * Chinese names and textile artwork are original; see docs/classic-time-board.md.
 */
export const GAME_VERSION = 3;
export const PATCH_SET_ID = 'classic-33-v1';
export const TIME_BOARD_ID = 'classic-corrected-2017';
export function isCompatibleGame(state) { return state?.version === GAME_VERSION && state.patchSet === PATCH_SET_ID && state.timeBoard === TIME_BOARD_ID; }
export const BOARD_SIZE = 9;
export const FINISH_TIME = 53;
export const INCOME_SPOTS = Object.freeze([5, 11, 17, 23, 29, 35, 41, 47, 53]);
export const LEATHER_SPOTS = Object.freeze([26, 32, 38, 44, 50]);
export const LEATHER_PATCH = Object.freeze({id:'leather', name:'皮革补丁', cost:0, time:0, income:0, color:'#a97849', shape:[[0,0]]});

export const PATCHES = [
  {"id":"p01","classicId":"A","name":"小布条","cost":2,"time":1,"income":0,"color":"#69a7f7","shape":[[0,0],[1,0]]},
  {"id":"p02","classicId":"B","name":"小弯角","cost":1,"time":3,"income":0,"color":"#f08d6c","shape":[[1,0],[0,1],[1,1]]},
  {"id":"p03","classicId":"D","name":"短桥","cost":2,"time":2,"income":0,"color":"#5fbfc2","shape":[[0,0],[1,0],[2,0]]},
  {"id":"p04","classicId":"I","name":"方巾","cost":6,"time":5,"income":2,"color":"#f1c84c","shape":[[0,0],[1,0],[0,1],[1,1]]},
  {"id":"p05","classicId":"M","name":"长条","cost":3,"time":3,"income":1,"color":"#8eb85b","shape":[[0,0],[1,0],[2,0],[3,0]]},
  {"id":"p06","classicId":"E","name":"阶梯四","cost":3,"time":2,"income":1,"color":"#64b883","shape":[[1,0],[2,0],[0,1],[1,1]]},
  {"id":"p07","classicId":"a","name":"钩形四","cost":4,"time":2,"income":1,"color":"#9b87f5","shape":[[0,0],[1,0],[2,0],[2,1]]},
  {"id":"p08","classicId":"f","name":"密扣阶梯","cost":7,"time":6,"income":3,"color":"#52a3a6","shape":[[1,0],[0,1],[1,1],[0,2]]},
  {"id":"p09","classicId":"K","name":"T形布","cost":2,"time":2,"income":0,"color":"#d79ce3","shape":[[1,0],[0,1],[1,1],[2,1]]},
  {"id":"p10","classicId":"T","name":"十字","cost":5,"time":4,"income":2,"color":"#df6f8f","shape":[[1,0],[0,1],[1,1],[2,1],[1,2]]},
  {"id":"p11","classicId":"O","name":"偏T五","cost":3,"time":4,"income":1,"color":"#e29b3c","shape":[[0,0],[1,0],[2,0],[3,0],[2,1]]},
  {"id":"p12","classicId":"C","name":"快缝弯角","cost":3,"time":1,"income":0,"color":"#c96b5c","shape":[[1,0],[0,1],[1,1]]},
  {"id":"p13","classicId":"d","name":"门框","cost":1,"time":2,"income":0,"color":"#78a4d4","shape":[[0,0],[1,0],[1,1],[0,2],[1,2]]},
  {"id":"p14","classicId":"P","name":"宽带","cost":7,"time":4,"income":2,"color":"#e8b351","shape":[[0,0],[1,0],[2,0],[3,0],[1,1],[2,1]]},
  {"id":"p15","classicId":"V","name":"宽十字","cost":5,"time":3,"income":1,"color":"#b77ad8","shape":[[1,0],[2,0],[0,1],[1,1],[2,1],[3,1],[1,2],[2,2]]},
  {"id":"p16","classicId":"e","name":"长折五","cost":2,"time":3,"income":1,"color":"#56b6a7","shape":[[2,0],[3,0],[0,1],[1,1],[2,1]]},
  {"id":"p17","classicId":"J","name":"斜阶六","cost":4,"time":2,"income":0,"color":"#d97070","shape":[[0,0],[1,0],[2,0],[1,1],[2,1],[3,1]]},
  {"id":"p18","classicId":"L","name":"宽门框","cost":1,"time":5,"income":1,"color":"#87b95f","shape":[[0,0],[3,0],[0,1],[1,1],[2,1],[3,1]]},
  {"id":"p19","classicId":"X","name":"短T","cost":5,"time":5,"income":2,"color":"#ef8f5f","shape":[[2,0],[0,1],[1,1],[2,1],[2,2]]},
  {"id":"p20","classicId":"H","name":"免费十字","cost":0,"time":3,"income":1,"color":"#6f95d6","shape":[[1,0],[0,1],[1,1],[2,1],[3,1],[1,2]]},
  {"id":"p21","classicId":"G","name":"大十字","cost":1,"time":4,"income":1,"color":"#ba6fad","shape":[[1,0],[1,1],[0,2],[1,2],[2,2],[1,3],[1,4]]},
  {"id":"p22","classicId":"W","name":"长L五","cost":10,"time":3,"income":2,"color":"#5caed1","shape":[[3,0],[0,1],[1,1],[2,1],[3,1]]},
  {"id":"p23","classicId":"U","name":"双门七","cost":2,"time":3,"income":0,"color":"#dbbd4e","shape":[[0,0],[1,0],[2,0],[1,1],[0,2],[1,2],[2,2]]},
  {"id":"p24","classicId":"c","name":"S形五","cost":10,"time":4,"income":3,"color":"#61bd84","shape":[[0,0],[1,0],[1,1],[2,1],[2,2]]},
  {"id":"p25","classicId":"F","name":"P形","cost":2,"time":2,"income":0,"color":"#d387b9","shape":[[0,0],[1,0],[2,0],[1,1],[2,1]]},
  {"id":"p26","classicId":"N","name":"高墙","cost":7,"time":1,"income":1,"color":"#79a06a","shape":[[0,0],[0,1],[0,2],[0,3],[0,4]]},
  {"id":"p27","classicId":"b","name":"长T六","cost":7,"time":2,"income":2,"color":"#cf7662","shape":[[3,0],[0,1],[1,1],[2,1],[3,1],[3,2]]},
  {"id":"p28","classicId":"Y","name":"宽靴","cost":10,"time":5,"income":3,"color":"#6aa0b8","shape":[[0,0],[1,0],[0,1],[1,1],[2,1],[3,1]]},
  {"id":"p29","classicId":"Q","name":"弯带六","cost":3,"time":6,"income":2,"color":"#d1a25b","shape":[[1,0],[2,0],[0,1],[1,1],[1,2],[2,2]]},
  {"id":"p30","classicId":"g","name":"曲折六","cost":8,"time":6,"income":3,"color":"#a77ad1","shape":[[2,0],[0,1],[1,1],[2,1],[0,2],[1,2]]},
  {"id":"p31","classicId":"R","name":"斜十字","cost":2,"time":1,"income":0,"color":"#67b58f","shape":[[2,0],[0,1],[1,1],[2,1],[3,1],[1,2]]},
  {"id":"p32","classicId":"S","name":"密扣钩形","cost":4,"time":6,"income":2,"color":"#d86583","shape":[[2,0],[0,1],[1,1],[2,1]]},
  {"id":"p33","classicId":"Z","name":"长阶六","cost":1,"time":2,"income":0,"color":"#4fb0b8","shape":[[0,0],[0,1],[1,1],[2,1],[3,1],[3,2]]},
];

for (const patch of PATCHES) {
  for (const cell of patch.shape) Object.freeze(cell);
  Object.freeze(patch.shape);
  Object.freeze(patch);
}
Object.freeze(PATCHES);
const patchById = new Map(PATCHES.map(patch => [patch.id, patch]));

export function getPatch(id) { return id === 'leather' ? LEATHER_PATCH : patchById.get(id) ?? null; }

function seededRandom(seed) {
  let value = 2166136261;
  for (const letter of String(seed)) value = Math.imul(value ^ letter.charCodeAt(0), 16777619);
  return () => {
    value += 0x6d2b79f5;
    let n = value;
    n = Math.imul(n ^ n >>> 15, n | 1);
    n ^= n + Math.imul(n ^ n >>> 7, n | 61);
    return ((n ^ n >>> 14) >>> 0) / 4294967296;
  };
}

export function createGame({seed = Date.now(), names = ['你', '缝纫师']} = {}) {
  const random = seededRandom(seed);
  const market = PATCHES.map(patch => patch.id);
  for (let i = market.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [market[i], market[j]] = [market[j], market[i]];
  }
  // The neutral pawn starts immediately clockwise after the smallest (1x2) patch.
  const next = (market.indexOf('p01') + 1) % market.length;
  return {
    version: GAME_VERSION,
    patchSet: PATCH_SET_ID,
    timeBoard: TIME_BOARD_ID,
    seed,
    players: [0,1].map(index => ({
      name: typeof names[index] === 'string' ? names[index].slice(0,24) : `玩家 ${index + 1}`,
      buttons: 5, time: 0, income: 0, bonus: false,
      board: Array.from({length:BOARD_SIZE}, () => Array(BOARD_SIZE).fill(null)),
    })),
    current: 0,
    market: market.slice(next).concat(market.slice(0,next)),
    pendingLeather: 0,
    leatherAvailable: [...LEATHER_SPOTS],
    bonusOwner: null,
    finished: false,
    finishOrder: [],
    revision: 0,
    log: [{text:'新一局开始，选择木棋子后方的三块布料之一。',type:'start'}],
  };
}

/** Preserve early local classic games only if no changed leather event was reached. */
export function upgradeTimeBoard(previous) {
  if (isCompatibleGame(previous)) return previous;
  if (previous?.version !== 2 || previous.patchSet !== PATCH_SET_ID || previous.pendingLeather !== 0 || previous.finished ||
      previous.players?.length !== 2 || !previous.players.every(player=>Number.isInteger(player.time)&&player.time>=0&&player.time<20) ||
      JSON.stringify(previous.leatherAvailable) !== '[20,26,32,38,44]') return null;
  const state=structuredClone(previous);
  state.version=GAME_VERSION;state.timeBoard=TIME_BOARD_ID;state.leatherAvailable=[...LEATHER_SPOTS];
  state.log.push({text:'时间轴已按经典版官方勘误校准，对局进度保留。',type:'update'});
  return state;
}

export function getAvailablePatches(state) {
  return state.market.slice(0,3).map(id => getPatch(id));
}

/** Rotation is the number of clockwise quarter-turns; reflect first, then rotate. */
export function transformShape(shape, rotation = 0, flipped = false) {
  if (!Array.isArray(shape) || shape.length === 0) return [];
  let cells = shape.map(([x,y]) => [flipped ? -x : x,y]);
  const turns = ((rotation % 4) + 4) % 4;
  for (let turn = 0; turn < turns; turn++) cells = cells.map(([x,y]) => [-y,x]);
  const minX = Math.min(...cells.map(([x]) => x));
  const minY = Math.min(...cells.map(([,y]) => y));
  return cells.map(([x,y]) => [x-minX,y-minY]).sort((a,b) => a[1]-b[1] || a[0]-b[0]);
}

export function canPlace(board, shape, x, y) {
  if (!Number.isInteger(x) || !Number.isInteger(y) || !Array.isArray(shape) || !shape.length) return false;
  const seen = new Set();
  return shape.every(([dx,dy]) => {
    const bx = x + dx, by = y + dy;
    if (!Number.isInteger(dx) || !Number.isInteger(dy) || bx < 0 || by < 0 || bx >= BOARD_SIZE || by >= BOARD_SIZE || !board[by] || board[by][bx] != null) return false;
    const key = `${bx},${by}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function getFilledCount(player) { return player.board.reduce((n,row) => n + row.filter(cell => cell != null).length,0); }
export function getScore(player) { return player.buttons + (player.bonus ? 7 : 0) - (BOARD_SIZE * BOARD_SIZE - getFilledCount(player)) * 2; }

export function hasSevenSquare(board) {
  for (let sy = 0; sy <= BOARD_SIZE - 7; sy++) {
    for (let sx = 0; sx <= BOARD_SIZE - 7; sx++) {
      let full = true;
      for (let y = sy; y < sy + 7 && full; y++) {
        for (let x = sx; x < sx + 7; x++) if (board[y][x] == null) { full = false; break; }
      }
      if (full) return true;
    }
  }
  return false;
}

export function getWinner(state) {
  if (!state.finished) return null;
  const difference = getScore(state.players[0]) - getScore(state.players[1]);
  return difference === 0 ? state.finishOrder[0] ?? 0 : difference > 0 ? 0 : 1;
}

/** List every unique legal orientation/anchor for the current player's board. */
export function legalPlacements(state, patchId) {
  const patch = getPatch(patchId);
  if (!patch) return [];
  const board = state.players[state.current].board;
  const seen = new Set(), placements = [];
  for (const flipped of [false,true]) for (let rotation=0; rotation<4; rotation++) {
    const shape = transformShape(patch.shape,rotation,flipped);
    const key = JSON.stringify(shape);
    if (seen.has(key)) continue;
    seen.add(key);
    const maxX = Math.max(...shape.map(([x]) => x)), maxY = Math.max(...shape.map(([,y]) => y));
    for (let y=0; y<BOARD_SIZE-maxY; y++) for (let x=0; x<BOARD_SIZE-maxX; x++) {
      if (canPlace(board,shape,x,y)) placements.push({x,y,rotation,flipped,shape});
    }
  }
  return placements;
}

function appendLog(state, text, player, type) {
  state.log.push({text,player,type});
  if (state.log.length > 80) state.log.splice(0,state.log.length-80);
}

function checkBonus(state, actor) {
  if (state.bonusOwner === null && hasSevenSquare(state.players[actor].board)) {
    state.bonusOwner = actor;
    state.players[actor].bonus = true;
    appendLog(state,`${state.players[actor].name}率先完成 7×7 方块，获得 7 分奖励。`,actor,'bonus');
  }
}

function finishTurn(state, actor) {
  // Special patches cannot be placed when the board is already completely full.
  if (state.pendingLeather && getFilledCount(state.players[actor]) === BOARD_SIZE * BOARD_SIZE) {
    appendLog(state,`${state.players[actor].name}的拼布板已满，剩余皮革补丁弃置。`,actor,'leather-discard');
    state.pendingLeather = 0;
  }
  if (state.pendingLeather > 0) { state.current = actor; return; }
  if (state.players.every(player => player.time === FINISH_TIME)) {
    state.finished = true;
    appendLog(state,'两名玩家均到达终点，拼布完成。',actor,'finish');
    return;
  }
  const other = 1 - actor;
  state.current = state.players[actor].time <= state.players[other].time ? actor : other;
}

function moveTime(state, actor, distance) {
  const player = state.players[actor];
  const from = player.time;
  player.time = Math.min(FINISH_TIME,from + distance);
  // Income includes the patch just purchased and is credited once per crossed marker.
  const incomes = INCOME_SPOTS.filter(spot => spot > from && spot <= player.time).length;
  if (incomes && player.income) {
    const earned = incomes * player.income;
    player.buttons += earned;
    appendLog(state,`${player.name}经过 ${incomes} 个收入点，获得 ${earned} 枚纽扣。`,actor,'income');
  }
  const leather = state.leatherAvailable.filter(spot => spot > from && spot <= player.time);
  if (leather.length) {
    state.pendingLeather += leather.length;
    state.leatherAvailable = state.leatherAvailable.filter(spot => !leather.includes(spot));
    appendLog(state,`${player.name}获得 ${leather.length} 块皮革补丁，请先填补空格。`,actor,'leather');
  }
  if (player.time === FINISH_TIME && !state.finishOrder.includes(actor)) state.finishOrder.push(actor);
}

/** Apply one complete game action without mutating the previous state. */
export function applyAction(previous, action) {
  if (!isCompatibleGame(previous)) throw new Error('棋盘规则已更新，请开始经典版新局。');
  if (!action || typeof action !== 'object') throw new Error('无效的操作。');
  if (previous.finished) throw new Error('本局已结束，请开始新一局。');
  const actor = previous.current;
  const player = previous.players[actor];
  if (previous.pendingLeather > 0 && action.type !== 'leather') throw new Error('请先放置获得的皮革补丁。');
  if (action.type === 'leather' && previous.pendingLeather <= 0) throw new Error('当前没有待放置的皮革补丁。');
  let patch, shape, index;
  if (action.type === 'place') {
    index = previous.market.indexOf(action.patchId);
    if (index < 0 || index >= 3) throw new Error('只能选择木棋子后方的三块布料。');
    patch = getPatch(action.patchId);
    if (player.buttons < patch.cost) throw new Error('纽扣不足，请选择其他布料或前进拿纽扣。');
    if (action.rotation !== undefined && (!Number.isInteger(action.rotation) || action.rotation < 0 || action.rotation > 3)) throw new Error('旋转参数无效。');
    if (action.flipped !== undefined && typeof action.flipped !== 'boolean') throw new Error('翻转参数无效。');
    shape = transformShape(patch.shape,action.rotation ?? 0,action.flipped ?? false);
    if (!canPlace(player.board,shape,action.x,action.y)) throw new Error('布料不能重叠或超出拼布板。');
  } else if (action.type === 'leather') {
    if (!canPlace(player.board,[[0,0]],action.x,action.y)) throw new Error('皮革补丁必须放在空格上。');
  } else if (action.type !== 'advance') throw new Error('未知操作。');

  const state = structuredClone(previous);
  const currentPlayer = state.players[actor];
  if (action.type === 'place') {
    // The next available patch is the one immediately after the chosen patch.
    state.market = state.market.slice(index+1).concat(state.market.slice(0,index));
    currentPlayer.buttons -= patch.cost;
    currentPlayer.income += patch.income;
    const placedId = `${patch.id}-${state.revision+1}`;
    for (const [dx,dy] of shape) currentPlayer.board[action.y+dy][action.x+dx] = {patchId:patch.id,color:patch.color,placedId};
    appendLog(state,`${currentPlayer.name}花费 ${patch.cost} 枚纽扣，缝上「${patch.name}」，前进 ${Math.min(patch.time,FINISH_TIME-currentPlayer.time)} 格。`,actor,'place');
    checkBonus(state,actor);
    moveTime(state,actor,patch.time);
  } else if (action.type === 'advance') {
    const target = Math.min(FINISH_TIME,state.players[1-actor].time+1);
    const distance = Math.max(0,target-currentPlayer.time);
    if (!distance) throw new Error('已经到达终点。');
    currentPlayer.buttons += distance;
    appendLog(state,`${currentPlayer.name}前进 ${distance} 格，获得 ${distance} 枚纽扣。`,actor,'advance');
    moveTime(state,actor,distance);
  } else {
    currentPlayer.board[action.y][action.x] = {patchId:'leather',color:LEATHER_PATCH.color,placedId:`leather-${state.revision+1}`};
    state.pendingLeather--;
    appendLog(state,`${currentPlayer.name}缝上一块皮革补丁。`,actor,'leather-place');
    checkBonus(state,actor);
  }
  state.revision++;
  finishTurn(state,actor);
  return state;
}
