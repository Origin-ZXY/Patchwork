import { FINISH_TIME, INCOME_SPOTS, LEATHER_SPOTS } from './engine.js';
import { esc } from './art.js';

export const TIME_BOARD_SIDES = Object.freeze(['quilt', 'plain']);
export const normalizeTimeBoardSide = side => TIME_BOARD_SIDES.includes(side) ? side : 'quilt';
export const timeBoardSideName = side => normalizeTimeBoardSide(side) === 'quilt' ? '经典拼布面' : '经典素色面';
const round = value => Math.round(value * 100) / 100;

// The classic patchwork face has an enlarged start and central finish.
// Rectangles describe ordered spaces, not the 9x9 personal quilt board.
const quiltRects = [[0,0,3,1]];
for (let x=3;x<8;x++) quiltRects.push([x,0,1,1]);
for (let y=1;y<8;y++) quiltRects.push([7,y,1,1]);
for (let x=6;x>=0;x--) quiltRects.push([x,7,1,1]);
for (let y=6;y>=1;y--) quiltRects.push([0,y,1,1]);
quiltRects.push([1,1,2,1],[3,1,1,1],[4,1,1,1],[5,1,1,1],[6,1,1,1]);
for (let y=2;y<=6;y++) quiltRects.push([6,y,1,1]);
for (let x=5;x>=1;x--) quiltRects.push([x,6,1,1]);
quiltRects.push([1,5,1,1],[1,4,1,1],[1,2,1,2]);
quiltRects.push([2,2,2,1],[4,2,1,1],[5,2,1,1],[5,3,1,1],[5,4,1,1],[5,5,1,1],[3,5,2,1],[2,5,1,1],[2,3,1,2],[3,3,2,2]);

function quiltGeometry() {
  const unit=31,offset=12;
  return quiltRects.map(([x,y,w,h],index)=>{
    const rect={x:x*unit+offset,y:y*unit+offset,w:w*unit,h:h*unit};
    return {index,rect,center:[rect.x+rect.w/2,rect.y+rect.h/2]};
  });
}

// The reverse face is a continuous winding ribbon. Equal arc lengths keep
// the inner spaces readable; the two larger endpoint spaces match the board.
function plainGeometry() {
  const totalAngle=Math.PI*5.6,startAngle=-2.5;
  const point=t=>{
    const angle=startAngle+t*totalAngle,radius=115-103*t;
    const x=136+radius*Math.cos(angle),y=136+radius*Math.sin(angle);
    const dx=-103*Math.cos(angle)-radius*Math.sin(angle)*totalAngle;
    const dy=-103*Math.sin(angle)+radius*Math.cos(angle)*totalAngle;
    const length=Math.hypot(dx,dy);
    return {x,y,nx:-dy/length,ny:dx/length};
  };
  const samples=[{t:0,length:0}];let previous=point(0);
  for (let step=1;step<=1800;step++) {
    const t=step/1800,current=point(t);
    samples.push({t,length:samples.at(-1).length+Math.hypot(current.x-previous.x,current.y-previous.y)});
    previous=current;
  }
  const atLength=length=>{
    let low=0,high=samples.length-1;
    while(low<high){const mid=(low+high)>>1;if(samples[mid].length<length)low=mid+1;else high=mid;}
    const b=samples[low],a=samples[Math.max(0,low-1)];
    return a.t+(b.t-a.t)*(length-a.length)/(b.length-a.length||1);
  };
  const weights=Array.from({length:54},(_,i)=>i===0?3:i===53?1.4:1);
  const unit=samples.at(-1).length/weights.reduce((a,b)=>a+b,0);
  let distance=0;
  return weights.map((weight,index)=>{
    const a=atLength(distance),b=atLength(distance+weight*unit),middle=point(atLength(distance+weight*unit/2));
    distance+=weight*unit;
    const edges=[[],[]];
    for(let n=0;n<=8;n++){
      const p=point(a+(b-a)*n/8);
      edges[0].push([p.x+p.nx*13,p.y+p.ny*13]);
      edges[1].push([p.x-p.nx*13,p.y-p.ny*13]);
    }
    const polygon=[...edges[0],...edges[1].reverse()];
    const entry=point(a);
    return {index,center:[middle.x,middle.y],entry:[entry.x,entry.y],path:polygon.map(([x,y],i)=>`${i?'L':'M'}${round(x)} ${round(y)}`).join(' ')+'Z'};
  });
}

const geometry = Object.freeze({quilt:quiltGeometry(),plain:plainGeometry()});
export function getTimeBoardGeometry(side='quilt') {
  return structuredClone(geometry[normalizeTimeBoardSide(side)]);
}

function quiltBoundary(previous,current) {
  const a=previous.rect,b=current.rect,epsilon=.01;
  if(Math.abs(a.x+a.w-b.x)<epsilon||Math.abs(b.x+b.w-a.x)<epsilon){
    return [Math.abs(a.x+a.w-b.x)<epsilon?b.x:a.x,(Math.max(a.y,b.y)+Math.min(a.y+a.h,b.y+b.h))/2];
  }
  return [(Math.max(a.x,b.x)+Math.min(a.x+a.w,b.x+b.w))/2,Math.abs(a.y+a.h-b.y)<epsilon?b.y:a.y];
}

function buttonAt(x,y,r=5.5) {
  return `<g transform="translate(${round(x)} ${round(y)})"><circle r="${r+.7}" cy=".8" fill="#192e2d66"/><circle r="${r}" fill="#71b9c9" stroke="#214e5b" stroke-width=".8"/><circle r="${r*.69}" fill="none" stroke="#d7edf1" stroke-width=".6"/>${[[-1.5,-1.5],[1.5,-1.5],[-1.5,1.5],[1.5,1.5]].map(([cx,cy])=>`<circle cx="${cx}" cy="${cy}" r=".65" fill="#285261"/>`).join('')}</g>`;
}

function fabricDefs(prefix) {
  const colors=['#789779','#c1aa71','#89a5ac','#baaf89','#c18e79','#71959b','#ab9e70','#d3bc86'];
  return colors.map((color,index)=>`<pattern id="${prefix}-fabric-${index}" width="12" height="12" patternUnits="userSpaceOnUse"><rect width="12" height="12" fill="${color}"/>${index%3===0?'<path d="M0 3H12M3 0V12M0 9H12M9 0V12" stroke="#e4dfba" stroke-width=".7" opacity=".35"/>':index%3===1?'<circle cx="3" cy="3" r="1" fill="#f1e7bc" opacity=".5"/><circle cx="9" cy="9" r="1" fill="#f1e7bc" opacity=".5"/>':'<path d="M-6 0L6 12M0 0L12 12M6 0L18 12" stroke="#e3e5c8" stroke-width="1.1" opacity=".35"/>'}<path d="M0 1H12M1 0V12" stroke="#162d2c" stroke-width=".4" opacity=".1"/></pattern>`).join('');
}

/** Read-only projection: side changes never alter a game, event, or player. */
export function timeBoardSVG(state,{side='quilt',seat=0,prefix='time'}={}) {
  side=normalizeTimeBoardSide(side);
  prefix=String(prefix).replace(/[^\w-]/g,'_');
  const cells=geometry[side],quilt=side==='quilt';
  const tiles=cells.map(cell=>{
    const {index,center:[cx,cy]}=cell;
    const endpoint=index===0||index===FINISH_TIME;
    const fill=endpoint?(quilt?'#b77c68':'#b18b45'):quilt?`url(#${prefix}-fabric-${(index*5+Math.floor(index/7))%8})`:index%2?'#bcae7b':'#cfbc73';
    const shape=quilt?`<rect x="${cell.rect.x+.5}" y="${cell.rect.y+.5}" width="${cell.rect.w-1}" height="${cell.rect.h-1}" rx="1.1" fill="${fill}" stroke="#697760" stroke-width=".7"/><rect x="${cell.rect.x+2}" y="${cell.rect.y+2}" width="${cell.rect.w-4}" height="${cell.rect.h-4}" rx="1" fill="none" stroke="#ede3bd" stroke-width=".45" stroke-dasharray="1.4 1.4" opacity=".65"/>`:`<path d="${cell.path}" fill="${fill}" stroke="#716d4a" stroke-width=".8"/><path d="${cell.path}" fill="url(#${prefix}-linen)" opacity=".2"/>`;
    const label=endpoint?(index===0?'起点':'53'):String(index);
    const tx=quilt?(endpoint?cx:cell.rect.x+3):cx,ty=quilt?(endpoint?cy-2:cell.rect.y+9):cy-3;
    return `<g data-time-space="${index}"><title>${index===0?'起点':index===53?'终点 53':'时间 '+index}${LEATHER_SPOTS.includes(index)?' · 首位到达或经过者获得皮革补丁':''}</title>${shape}<text x="${round(tx)}" y="${round(ty)}" text-anchor="${quilt&&!endpoint?'start':'middle'}" fill="${endpoint?'#fff0c9':'#364739'}" font-size="${endpoint?9:7.3}" font-family="sans-serif" font-weight="${endpoint?600:500}" paint-order="stroke" stroke="${endpoint?'#926b52':'#ece3bb'}" stroke-width=".35">${label}</text>${index===53?`<text x="${round(cx)}" y="${round(cy+9)}" text-anchor="middle" fill="#fff0c9" font-size="6.5" font-family="sans-serif">终点</text>`:''}</g>`;
  }).join('');
  const income=INCOME_SPOTS.map(spot=>{
    const [x,y]=quilt?quiltBoundary(cells[spot-1],cells[spot]):cells[spot].entry;
    return `<g data-income-at="${spot}" role="img" aria-label="进入第 ${spot} 格时领取纽扣收入"><title>越过 ${spot-1} → ${spot} 的纽扣标记，领取当前收入</title>${buttonAt(x,y)}</g>`;
  }).join('');
  const leather=LEATHER_SPOTS.map(spot=>{
    const [x,y]=cells[spot].center,available=state.leatherAvailable.includes(spot);
    const dx=quilt?4:0,dy=quilt?3:5;
    return `<g data-leather-at="${spot}" data-available="${available}" role="img" aria-label="第 ${spot} 格皮革补丁${available?'，可领取':'，已领取'}"><title>第 ${spot} 格皮革补丁${available?'：首位到达或经过者获得':'已被领取'}</title><rect x="${round(x+dx-5)}" y="${round(y+dy-5)}" width="10" height="10" rx=".8" transform="rotate(-7 ${round(x+dx)} ${round(y+dy)})" fill="${available?'#b78b62':'#9c9a7c'}" stroke="#6d5841" stroke-width=".6" opacity="${available?1:.3}"/><rect x="${round(x+dx-3.7)}" y="${round(y+dy-3.7)}" width="7.4" height="7.4" rx=".5" fill="none" stroke="#f3dbb1" stroke-width=".6" stroke-dasharray="1.2 1.2" opacity="${available?1:.3}"/></g>`;
  }).join('');
  const tokens=[1-state.current,state.current].map(index=>{
    const player=state.players[index],[cx,cy]=cells[player.time].center;
    const same=state.players[0].time===state.players[1].time,dx=same?(index===state.current?3.2:-3.2):0,dy=same?(index===state.current?-2.6:2.6):0;
    return `<g data-time-token="${index}" data-position="${player.time}" aria-label="${esc(player.name)}在第 ${player.time} 格"><circle cx="${round(cx+dx)}" cy="${round(cy+dy+1.6)}" r="7" fill="#213f3766"/><circle cx="${round(cx+dx)}" cy="${round(cy+dy)}" r="6.8" fill="${index===0?'#68b7b1':'#ce896c'}" stroke="${index===state.current?'#fff1bb':'#edd3ae'}" stroke-width="1.4"/><circle cx="${round(cx+dx)}" cy="${round(cy+dy)}" r="4.2" fill="none" stroke="#fff1bb88" stroke-width=".7"/></g>`;
  }).join('');
  return `<svg viewBox="0 0 272 272" xmlns="http://www.w3.org/2000/svg" role="img" data-time-board-side="${side}" aria-label="${timeBoardSideName(side)}时间轴，你在${state.players[seat].time}，对手在${state.players[1-seat].time}"><defs>${fabricDefs(prefix)}<pattern id="${prefix}-linen" width="4" height="4" patternUnits="userSpaceOnUse"><rect width="4" height="4" fill="${quilt?'#9b9d85':'#777a5c'}"/><path d="M0 .8H4M.8 0V4" stroke="#efe3b5" stroke-width=".4" opacity=".09"/><path d="M0 2.8H4M2.8 0V4" stroke="#273e2d" stroke-width=".35" opacity=".09"/></pattern></defs><rect x="3" y="3" width="266" height="266" rx="${quilt?6:11}" fill="${quilt?'#aaa18c':'#7d7c5c'}" stroke="#d2bb88" stroke-width="1.5"/><rect x="7" y="7" width="258" height="258" rx="${quilt?3:8}" fill="url(#${prefix}-linen)" stroke="#e6d3a366" stroke-width=".7" stroke-dasharray="2 2"/>${tiles}${income}${leather}${tokens}</svg>`;
}
