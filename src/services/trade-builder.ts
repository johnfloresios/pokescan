export type TradeSide='giving'|'receiving';

export interface TradeCollectionCard {
  id:string;
  card_name:string;
  set_name:string;
  set_code:string|null;
  set_number:string;
  rarity:string|null;
  image_url:string|null;
  price_estimate:number|string|null;
  quantity:number|null;
  condition:string|null;
}

export interface TradeItem {
  instanceId:string;
  card:TradeCollectionCard;
  condition:string;
}

export interface TradeSuggestion {
  card:TradeCollectionCard;
  condition:string;
  adjustedValue:number;
  remainingDifference:number;
  score:number;
}

export type MultiplierMap=Readonly<Record<string,number>>;

export const adjustedCardValue=(card:TradeCollectionCard,condition:string,multipliers:MultiplierMap)=>
  Math.max(0,Number(card.price_estimate)||0)*(multipliers[condition]??1);

export const tradeTotal=(items:readonly TradeItem[],multipliers:MultiplierMap)=>
  items.reduce((total,item)=>total+adjustedCardValue(item.card,item.condition,multipliers),0);

const desirability=(rarity:string|null)=>{
  const value=(rarity??'').toLowerCase();
  if(/special illustration|hyper/.test(value))return 1;
  if(/illustration|double rare/.test(value))return .8;
  if(/rare/.test(value))return .55;
  return .25;
};

/** Ranks owned, unused cards by closeness to the amount needed and collectability. */
export function suggestBalanceCards(
  collection:readonly TradeCollectionCard[],
  amountNeeded:number,
  excludedCounts:Readonly<Record<string,number>>,
  multipliers:MultiplierMap,
  limit=5,
):TradeSuggestion[]{
  if(amountNeeded<=.005)return [];
  const suggestions:TradeSuggestion[]=[];
  for(const card of collection){
    const owned=Math.max(1,Number(card.quantity)||1);
    if((excludedCounts[card.id]??0)>=owned)continue;
    const condition=card.condition||'NM';
    const adjustedValue=adjustedCardValue(card,condition,multipliers);
    if(adjustedValue<=0)continue;
    const remainingDifference=Math.abs(amountNeeded-adjustedValue);
    const closeness=1-Math.min(1,remainingDifference/Math.max(amountNeeded,1));
    const score=closeness*90+desirability(card.rarity)*10;
    suggestions.push({card,condition,adjustedValue,remainingDifference,score});
  }
  return suggestions.sort((a,b)=>b.score-a.score||a.remainingDifference-b.remainingDifference).slice(0,limit);
}
