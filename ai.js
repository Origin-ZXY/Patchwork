import {BOARD_SIZE, FINISH_TIME, INCOME_SPOTS, getAvailablePatches, legalPlacements, getFilledCount} from './engine.js';

function countSmallGaps(board) {
  const seen = new Set();
  let penalty = 0;
  for (let y=0; y<BOARD_SIZE; y++) for (let x=0; x<BOARD_SIZE; x++) {
    if (board[y][x] != null || seen.has(y*BOARD_SIZE+x)) continue;
    const queue = [[x,y]];
    seen.add(y*BOARD_SIZE+x);
    for (let i=0; i<queue.length; i++) {
      const [cx,cy] = queue[i];
      for (const [dx,dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
        const nx=cx+dx, ny=cy+dy, key=ny*BOARD_SIZE+nx;
        if (nx<0 || ny<0 || nx>=BOARD_SIZE || ny>=BOARD_SIZE || board[ny][nx]!=null || seen.has(key)) continue;
        seen.add(key); queue.push([nx,ny]);
      }
    }
    if (queue.length === 1) penalty += 5;
    else if (queue.length < 4) penalty += 1.5;
  }
  return penalty;
}

function placementQuality(board, placement, difficulty) {
  const {shape,x,y} = placement;
  const added = new Set(shape.map(([dx,dy]) => `${x+dx},${y+dy}`));
  let contact = 0;
  for (const [dx,dy] of shape) {
    const bx=x+dx, by=y+dy;
    for (const [sx,sy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx=bx+sx,ny=by+sy;
      if (nx<0 || ny<0 || nx>=BOARD_SIZE || ny>=BOARD_SIZE) contact += 0.6;
      else if (board[ny][nx]!=null && !added.has(`${nx},${ny}`)) contact += 1;
    }
  }
  // A compact quilt preserves large spaces for later patches. Corners break ties.
  let result = contact * 0.32 - (x+y) * 0.009;
  if (difficulty !== 'easy') {
    const next = board.map(row => row.slice());
    for (const [dx,dy] of shape) next[y+dy][x+dx] = true;
    result -= countSmallGaps(next) * (difficulty === 'hard' ? 0.9 : 0.65);
  }
  return result;
}

/** A deterministic local opponent. It receives exactly the public game state. */
export function chooseAction(state, {difficulty='normal'} = {}) {
  if (state.finished) return null;
  const player = state.players[state.current];
  if (state.pendingLeather > 0) {
    const placements = legalPlacements(state,'leather');
    if (!placements.length) return null;
    let best=placements[0], score=-Infinity;
    for (const placement of placements) {
      const quality=placementQuality(player.board,placement,difficulty);
      if (quality>score) {score=quality;best=placement;}
    }
    return {type:'leather',x:best.x,y:best.y};
  }
  const remainingIncome=INCOME_SPOTS.filter(spot => spot>player.time).length;
  const timeLeft=FINISH_TIME-player.time;
  const empty=BOARD_SIZE*BOARD_SIZE-getFilledCount(player);
  let best=null, bestScore=-Infinity;
  for (const patch of getAvailablePatches(state)) {
    if (patch.cost>player.buttons || patch.shape.length>empty) continue;
    const placements=legalPlacements(state,patch.id);
    if (!placements.length) continue;
    const value=patch.shape.length*2 + patch.income*remainingIncome*0.9 - patch.cost*0.85 - Math.min(patch.time,timeLeft)*0.5;
    for (const placement of placements) {
      const score=value+placementQuality(player.board,placement,difficulty);
      if (score>bestScore) {
        bestScore=score;
        best={type:'place',patchId:patch.id,x:placement.x,y:placement.y,rotation:placement.rotation,flipped:placement.flipped};
      }
    }
  }
  return best ?? {type:'advance'};
}
