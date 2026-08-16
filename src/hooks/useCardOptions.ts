import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/services/supabase';

export type CardOption={id:string;code:string;label:string;sort_order:number;is_active:boolean;value_multiplier?:number|null};
type OptionKind='conditions'|'variants'|'rarities';
type OptionBundle=Record<OptionKind,CardOption[]>;
type HookResult={options:CardOption[];isLoading:boolean;error:string;refresh:()=>Promise<void>};

const CACHE_KEY='pokescan.card-options.v2';
let bundle:OptionBundle|null=null;
let loadPromise:Promise<void>|null=null;
let hasAttempted=false;
const listeners=new Set<()=>void>();
const notify=()=>listeners.forEach(listener=>listener());

async function fetchOptions():Promise<OptionBundle>{
  const tables:OptionKind[]=['conditions','variants','rarities'];
  const responses=await Promise.all(tables.map(table=>supabase.from(table).select(table==='conditions'?'id,code,label,sort_order,is_active,value_multiplier':'id,code,label,sort_order,is_active').eq('is_active',true).order('sort_order',{ascending:true})));
  const failed=responses.find((response:{error:{message:string}|null})=>response.error);
  if(failed?.error)throw new Error(failed.error.message);
  return Object.fromEntries(tables.map((table,index)=>[table,(responses[index].data??[]) as CardOption[]])) as OptionBundle;
}

async function load(force=false){
  if(bundle&&!force)return Promise.resolve();
  if(loadPromise&&!force)return loadPromise;
  loadPromise=(async()=>{
    if(!bundle){
      const cached=await AsyncStorage.getItem(CACHE_KEY).catch(()=>null);
      if(cached){try{bundle=JSON.parse(cached) as OptionBundle;notify();}catch{/* Ignore invalid cache. */}}
    }
    try{const fresh=await fetchOptions();bundle=fresh;notify();await AsyncStorage.setItem(CACHE_KEY,JSON.stringify(fresh));}
    catch(error){if(!bundle)throw error;}
  })().finally(()=>{hasAttempted=true;loadPromise=null;notify();});
  return loadPromise;
}

function useOptions(kind:OptionKind):HookResult{
  const [,render]=useState(0);const [error,setError]=useState('');
  useEffect(()=>{const listener=()=>render(value=>value+1);listeners.add(listener);void load().catch(reason=>setError(reason instanceof Error?reason.message:'Could not load card options.'));return()=>{listeners.delete(listener);};},[]);
  const refresh=useCallback(async()=>{setError('');try{await load(true);}catch(reason){setError(reason instanceof Error?reason.message:'Could not refresh card options.');}},[]);
  return {options:bundle?.[kind]??[],isLoading:!bundle&&!hasAttempted,error,refresh};
}

export const useConditions=()=>useOptions('conditions');
export const useVariants=()=>useOptions('variants');
export const useRarities=()=>useOptions('rarities');
