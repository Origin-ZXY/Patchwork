import {transformShape, getPatch, LEATHER_PATCH} from './engine.js';

export function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[character]));
}

const safeId = value => String(value).replace(/[^a-zA-Z0-9_-]/g,'_');
const CELLS = 44;

function buttonDrawing(x,y,r,fill='#cfb97d',stroke='#74613d') {
  const h = r * .23, d = r * .25;
  return `<g transform="translate(${x} ${y})"><circle cy="${r*.12}" r="${r}" fill="#161714" opacity=".23"/><circle r="${r}" fill="${fill}" stroke="${stroke}" stroke-width="${r*.11}"/><circle r="${r*.72}" fill="none" stroke="${stroke}" stroke-width="${r*.07}" opacity=".52"/><path d="M ${-r*.62} ${-r*.36} A ${r*.72} ${r*.72} 0 0 1 ${r*.43} ${-r*.60}" fill="none" stroke="#fff4cc" stroke-width="${r*.10}" opacity=".62"/>${[[-d,-d],[d,-d],[-d,d],[d,d]].map(([cx,cy])=>`<circle cx="${cx}" cy="${cy}" r="${h}" fill="${stroke}"/>`).join('')}</g>`;
}

export function buttonIcon(size=16) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Number(size)||16}" height="${Number(size)||16}" viewBox="0 0 24 24" fill="none" aria-hidden="true" style="display:inline-block;vertical-align:middle;flex-shrink:0">${buttonDrawing(12,11.5,9,'currentColor','#3a3427')}</svg>`;
}

export function clockIcon(size=16) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Number(size)||16}" height="${Number(size)||16}" viewBox="0 0 24 24" fill="none" aria-hidden="true" style="display:inline-block;vertical-align:middle;flex-shrink:0"><circle cx="12" cy="12" r="8.5" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="12" r="6.5" stroke="currentColor" stroke-width=".55" opacity=".35"/><path d="M12 7v5l3 2" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/><path d="M10 1.5h4M12 1.5V3M19 4l1 1" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>`;
}

function mix(hex, target, amount) {
  if (!/^#[a-f\d]{6}$/i.test(hex)) hex='#8d9d8b';
  const channel = index => Math.round(parseInt(hex.slice(index,index+2),16)*(1-amount)+parseInt(target.slice(index,index+2),16)*amount).toString(16).padStart(2,'0');
  return '#'+channel(1)+channel(3)+channel(5);
}

function fabricDefs(patch, prefix) {
  const id = `${safeId(prefix)}-${safeId(patch.id)}`;
  const number = Number(String(patch.id).replace(/\D/g,'')) || 0;
  const color = mix(patch.color,'#66745d',.13);
  const light = mix(color,'#fff5d9',.45), dark = mix(color,'#292a24',.43);
  const family = number % 7;
  const motifs = [
    `<rect width="9" height="9" fill="${light}" opacity=".30"/><rect x="9" y="9" width="9" height="9" fill="${light}" opacity=".30"/><path d="M0 9H18M9 0V18" stroke="${dark}" stroke-width=".6" opacity=".3"/>`,
    `<path d="M-9 0L9 18M0 0L18 18M9 0L27 18" stroke="${light}" stroke-width="2.4" opacity=".38"/><path d="M-6 0L12 18M3 0L21 18" stroke="${dark}" stroke-width=".7" opacity=".28"/>`,
    `<circle cx="4.5" cy="4.5" r="1.6" fill="${light}" opacity=".60"/><circle cx="13.5" cy="13.5" r="1.6" fill="${light}" opacity=".60"/>`,
    `<g fill="${light}" opacity=".57"><ellipse cx="9" cy="5.9" rx="1.4" ry="2.4"/><ellipse cx="9" cy="12.1" rx="1.4" ry="2.4"/><ellipse cx="5.9" cy="9" rx="2.4" ry="1.4"/><ellipse cx="12.1" cy="9" rx="2.4" ry="1.4"/></g><circle cx="9" cy="9" r="1.3" fill="${dark}" opacity=".6"/><path d="M0 0l3 3M15 15l3 3" stroke="${light}" opacity=".25"/>`,
    `<path d="M0 0l4.5 4.5L9 0l4.5 4.5L18 0M0 9l4.5 4.5L9 9l4.5 4.5L18 9" stroke="${light}" stroke-width="1.1" fill="none" opacity=".42"/><path d="M0 4.5L4.5 9 9 4.5 13.5 9 18 4.5M0 13.5L4.5 18 9 13.5 13.5 18 18 13.5" stroke="${dark}" stroke-width=".55" fill="none" opacity=".25"/>`,
    `<path d="M4 0V18M0 4H18" stroke="${dark}" stroke-width="3" opacity=".33"/><path d="M10 0V18M0 10H18" stroke="${light}" stroke-width="1.1" opacity=".55"/><path d="M13 0V18M0 13H18" stroke="${light}" stroke-width=".6" opacity=".3"/>`,
    `<path d="M5 2v6M2 5h6M14 11v6M11 14h6" stroke="${light}" stroke-width="1" opacity=".6"/><circle cx="14" cy="5" r=".8" fill="${light}" opacity=".38"/><circle cx="5" cy="14" r=".8" fill="${light}" opacity=".38"/>`,
  ];
  const motif = patch.id==='leather'
    ? `<path d="M1 3l3 .4M11 7l2 -.3M5 14l4 .6" stroke="${dark}" stroke-width=".8" opacity=".28"/><circle cx="14" cy="15" r=".7" fill="${light}" opacity=".22"/>`
    : motifs[family];
  return `<pattern id="${id}-fabric" patternUnits="userSpaceOnUse" width="18" height="18"><rect width="18" height="18" fill="${color}"/>${motif}<path d="M0 1H18M0 4H18M0 7H18M0 10H18M0 13H18M0 16H18" stroke="#fff8df" stroke-width=".45" opacity=".12"/><path d="M1 0V18M4 0V18M7 0V18M10 0V18M13 0V18M16 0V18" stroke="#262821" stroke-width=".45" opacity=".10"/></pattern><linearGradient id="${id}-light" x1="0" y1="0" x2="1" y2="1"><stop stop-color="#fff8db" stop-opacity=".14"/><stop offset=".46" stop-color="#fff8db" stop-opacity="0"/><stop offset="1" stop-color="#252923" stop-opacity=".18"/></linearGradient>`;
}

function cellPath(cells,unit=CELLS) {
  return cells.map(([x,y])=>`M${x*unit} ${y*unit}h${unit}v${unit}h${-unit}Z`).join('');
}

/** Directed boundary edges. Shared cell edges never appear in this outline. */
function boundary(cells) {
  const filled = new Set(cells.map(([x,y])=>`${x},${y}`));
  const edges = [];
  for (const [x,y] of cells) {
    if(!filled.has(`${x},${y-1}`))edges.push({a:[x,y],b:[x+1,y],dir:0});
    if(!filled.has(`${x+1},${y}`))edges.push({a:[x+1,y],b:[x+1,y+1],dir:1});
    if(!filled.has(`${x},${y+1}`))edges.push({a:[x+1,y+1],b:[x,y+1],dir:2});
    if(!filled.has(`${x-1},${y}`))edges.push({a:[x,y+1],b:[x,y],dir:3});
  }
  return edges;
}

function outlinePath(cells,unit=CELLS) {
  const edges=boundary(cells), starts=new Map();
  edges.forEach((edge,index)=>{
    const key=edge.a.join(',');
    if(!starts.has(key))starts.set(key,[]);
    starts.get(key).push(index);
  });
  const used=new Set();
  let path='';
  for(let first=0;first<edges.length;first++) {
    if(used.has(first))continue;
    let index=first;
    const start=edges[first].a;
    path+=`M${start[0]*unit} ${start[1]*unit}`;
    for(let count=0;count<=edges.length;count++) {
      const edge=edges[index];
      used.add(index);
      path+=`L${edge.b[0]*unit} ${edge.b[1]*unit}`;
      if(edge.b[0]===start[0] && edge.b[1]===start[1]){path+='Z';break;}
      const candidates=(starts.get(edge.b.join(','))??[]).filter(next=>!used.has(next));
      if(!candidates.length)break;
      const priority={1:0,0:1,3:2,2:3};
      candidates.sort((a,b)=>priority[(edges[a].dir-edge.dir+4)%4]-priority[(edges[b].dir-edge.dir+4)%4]);
      index=candidates[0];
    }
  }
  return path;
}

function stitchesPath(cells,unit=CELLS) {
  const margin=3.7;
  return boundary(cells).map(({a,b,dir})=>{
    const vectors=[[1,0],[0,1],[-1,0],[0,-1]], [dx,dy]=vectors[dir];
    const nx=-dy,ny=dx;
    return `M${a[0]*unit+dx*margin+nx*margin} ${a[1]*unit+dy*margin+ny*margin}L${b[0]*unit-dx*margin+nx*margin} ${b[1]*unit-dy*margin+ny*margin}`;
  }).join('');
}

function fabricPiece(patch,cells,prefix,{income=0,shadow=true}={}) {
  const id=`${safeId(prefix)}-${safeId(patch.id)}`, outline=outlinePath(cells), fill=cellPath(cells);
  return `<g class="fabric-piece" data-patch="${esc(patch.id)}">${shadow?`<path d="${outline}" fill="#191b16" opacity=".24" transform="translate(0 1.8)"/>`:''}<path d="${fill}" fill="url(#${id}-fabric)"/><path d="${fill}" fill="url(#${id}-light)"/><path d="${outline}" fill="none" stroke="#25271f" stroke-opacity=".55" stroke-width="1.5" stroke-linejoin="round"/><path d="${stitchesPath(cells)}" fill="none" stroke="#fff4d1" stroke-opacity=".62" stroke-width="1" stroke-dasharray="3 3.3" stroke-linecap="round"/>${cells.slice(0,income).map(([x,y])=>buttonDrawing((x+.5)*CELLS,(y+.5)*CELLS,6.3,'#e8d5a0','#77613b')).join('')}</g>`;
}

export function patchSVG(patch,{rotation=0,flipped=false,width=100,height=76,prefix='patch'}={}) {
  if(!patch)return '';
  const shape=transformShape(patch.shape,rotation,flipped);
  if(!shape.length)return '';
  const columns=Math.max(...shape.map(([x])=>x))+1,rows=Math.max(...shape.map(([,y])=>y))+1;
  const pad=7,viewWidth=columns*CELLS+pad*2,viewHeight=rows*CELLS+pad*2;
  return `<svg xmlns="http://www.w3.org/2000/svg" class="patch-art" width="${Number(width)||100}" height="${Number(height)||76}" viewBox="${-pad} ${-pad} ${viewWidth} ${viewHeight}" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${esc(patch.name)}，${shape.length}格布料"><defs>${fabricDefs(patch,prefix)}</defs>${fabricPiece(patch,shape,prefix,{income:patch.income})}</svg>`;
}

export function boardSVG(player,{prefix='board'}={}) {
  const id=safeId(prefix), groups=new Map();
  for(let y=0;y<9;y++)for(let x=0;x<9;x++) {
    const cell=player.board[y]?.[x];
    if(cell==null)continue;
    const key=cell.placedId??cell.patchId??String(cell);
    if(!groups.has(key))groups.set(key,{patch:getPatch(cell.patchId)??{...LEATHER_PATCH,id:`custom-${groups.size}`,color:cell.color??String(cell)},cells:[]});
    groups.get(key).cells.push([x,y]);
  }
  const patches=[...new Map([...groups.values()].map(group=>[group.patch.id,group.patch])).values()];
  let grid='';
  for(let y=0;y<9;y++)for(let x=0;x<9;x++) {
    if((x+y)%2===0)grid+=`<rect x="${x*CELLS}" y="${y*CELLS}" width="44" height="44" fill="#846f4f" opacity=".045"/>`;
    grid+=`<circle cx="${(x+.5)*CELLS}" cy="${(y+.5)*CELLS}" r=".8" fill="#786448" opacity=".20"/>`;
  }
  for(let line=1;line<9;line++)grid+=`<path d="M${line*CELLS} 0V396M0 ${line*CELLS}H396" stroke="#776449" stroke-opacity=".36" stroke-width=".75"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" class="quilt-svg" viewBox="0 0 396 396" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${esc(player.name)}的9乘9拼布板"><defs><pattern id="${id}-linen" width="6" height="6" patternUnits="userSpaceOnUse"><rect width="6" height="6" fill="#c5b492"/><path d="M0 .5H6M0 3.5H6" stroke="#fff4db" stroke-width=".65" opacity=".2"/><path d="M.5 0V6M3.5 0V6" stroke="#6a5941" stroke-width=".5" opacity=".13"/></pattern>${patches.map(patch=>fabricDefs(patch,prefix)).join('')}</defs><rect width="396" height="396" fill="url(#${id}-linen)"/>${grid}${[...groups.values()].map(({patch,cells})=>fabricPiece(patch,cells,prefix,{shadow:false,income:patch.income})).join('')}<rect x=".75" y=".75" width="394.5" height="394.5" fill="none" stroke="#726047" stroke-opacity=".75" stroke-width="1.5"/></svg>`;
}

/** SVG fragment, intended to be layered directly over the 396×396 board. */
export function previewSVG(shape,x,y,{valid=true}={}) {
  if(!Array.isArray(shape)||!shape.length||!Number.isInteger(x)||!Number.isInteger(y))return '';
  const cells=shape.map(([dx,dy])=>[x+dx,y+dy]),outline=outlinePath(cells);
  const color=valid?'#eed295':'#ed8d7d';
  return `<g class="placement-preview ${valid?'valid':'invalid'}" pointer-events="none" aria-hidden="true"><path d="${cellPath(cells)}" fill="${color}" fill-opacity="${valid?'.32':'.26'}"/><path d="${outline}" fill="none" stroke="#28271e" stroke-opacity=".6" stroke-width="5.5" stroke-linejoin="round"/><path d="${outline}" fill="none" stroke="${color}" stroke-width="2.8" stroke-linejoin="round" stroke-dasharray="${valid?'0':'6 3'}"/></g>`;
}
