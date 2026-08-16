export type PokemonSetDefinition={code:string;name:string;aliases?:readonly string[]};

// Printed English set codes. Add future sets here; OCR parsing and the scan
// scanner normalization and result ranking consume this single catalog.
export const POKEMON_SETS:readonly PokemonSetDefinition[]=[
  {code:'SVI',name:'Scarlet & Violet'},{code:'PAL',name:'Paldea Evolved'},{code:'OBF',name:'Obsidian Flames'},{code:'MEW',name:'151'},
  {code:'PAR',name:'Paradox Rift'},{code:'PAF',name:'Paldean Fates'},{code:'TEF',name:'Temporal Forces'},{code:'TWM',name:'Twilight Masquerade'},
  {code:'SFA',name:'Shrouded Fable'},{code:'SCR',name:'Stellar Crown'},{code:'SSP',name:'Surging Sparks'},{code:'PRE',name:'Prismatic Evolutions'},
  {code:'JTG',name:'Journey Together'},{code:'DRI',name:'Destined Rivals'},
  {code:'SSH',name:'Sword & Shield'},{code:'RCL',name:'Rebel Clash'},{code:'DAA',name:'Darkness Ablaze'},{code:'CPA',name:"Champion's Path"},
  {code:'VIV',name:'Vivid Voltage'},{code:'SHF',name:'Shining Fates'},{code:'BST',name:'Battle Styles'},{code:'CRE',name:'Chilling Reign'},
  {code:'EVS',name:'Evolving Skies'},{code:'CEL',name:'Celebrations'},{code:'FST',name:'Fusion Strike'},{code:'BRS',name:'Brilliant Stars'},
  {code:'ASR',name:'Astral Radiance'},{code:'PGO',name:'Pokémon GO'},{code:'LOR',name:'Lost Origin'},{code:'SIT',name:'Silver Tempest'},{code:'CRZ',name:'Crown Zenith'},
  {code:'SUM',name:'Sun & Moon'},{code:'GRI',name:'Guardians Rising'},{code:'BUS',name:'Burning Shadows'},{code:'SLG',name:'Shining Legends'},
  {code:'CIN',name:'Crimson Invasion'},{code:'UPR',name:'Ultra Prism'},{code:'FLI',name:'Forbidden Light'},{code:'CES',name:'Celestial Storm'},
  {code:'DRM',name:'Dragon Majesty'},{code:'LOT',name:'Lost Thunder'},{code:'TEU',name:'Team Up'},{code:'DET',name:'Detective Pikachu'},
  {code:'UNB',name:'Unbroken Bonds'},{code:'UNM',name:'Unified Minds'},{code:'HIF',name:'Hidden Fates'},{code:'CEC',name:'Cosmic Eclipse'},
  {code:'EVO',name:'XY Evolutions'},{code:'FCO',name:'Fates Collide'},{code:'STS',name:'Steam Siege'},{code:'BKT',name:'BREAKthrough'},
  {code:'BKP',name:'BREAKpoint'},{code:'GEN',name:'Generations'},{code:'AOR',name:'Ancient Origins'},{code:'ROS',name:'Roaring Skies'},
  {code:'PRC',name:'Primal Clash'},{code:'PHF',name:'Phantom Forces'},{code:'FFI',name:'Furious Fists'},{code:'FLF',name:'Flashfire'},
  {code:'XY',name:'XY'},
];

const clean=(value:string)=>value.toUpperCase().replace(/[^A-Z0-9]/g,'');
const repairGlyphs=(value:string)=>clean(value).replace(/0/g,'O').replace(/[1L|]/g,'I').replace(/5/g,'S').replace(/8/g,'B');
const distance=(a:string,b:string)=>{
  const row=Array.from({length:b.length+1},(_,index)=>index);
  for(let i=1;i<=a.length;i++){let previous=row[0];row[0]=i;for(let j=1;j<=b.length;j++){const saved=row[j];row[j]=Math.min(row[j]+1,row[j-1]+1,previous+(a[i-1]===b[j-1]?0:1));previous=saved;}}
  return row[b.length];
};

export type SetCodeMatch={set:PokemonSetDefinition;confidence:number;raw:string};

export function matchPrintedSetCode(lines:readonly string[]):SetCodeMatch|undefined{
  const tokens=lines.flatMap(line=>line.split(/\s+/)).map(raw=>({raw,value:repairGlyphs(raw)}))
    .filter(token=>{
      const letters=token.raw.replace(/[^A-Za-z]/g,'');
      const codeLikeCase=letters===letters.toUpperCase()||/^[A-Z0-9]{2,3}[lIoO]$/.test(token.raw);
      return token.value.length>=2&&token.value.length<=4&&codeLikeCase;
    });
  const matches:SetCodeMatch[]=[];
  for(const token of tokens){
    for(const set of POKEMON_SETS){
      const variants=[set.code,...(set.aliases??[])].map(repairGlyphs);
      const edits=Math.min(...variants.map(code=>distance(token.value,code)));
      const confidence=edits===0?1:edits===1&&token.value.length>=3?.78:0;
      if(confidence)matches.push({set,confidence,raw:token.raw});
    }
  }
  matches.sort((a,b)=>b.confidence-a.confidence);
  const best=matches[0];
  if(!best)return undefined;
  // Never turn an equally-close OCR token such as CRI into an arbitrary set.
  const tied=matches.some(match=>match.set.code!==best.set.code&&match.raw===best.raw&&match.confidence===best.confidence);
  return best.confidence<1&&tied?undefined:best;
}

export function findSet(value:string):PokemonSetDefinition|undefined{
  const normalized=clean(value);
  return POKEMON_SETS.find(set=>clean(set.code)===normalized||clean(set.name)===normalized||(set.aliases??[]).some(alias=>clean(alias)===normalized));
}
