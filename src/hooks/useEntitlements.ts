import { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform } from 'react-native';
import Purchases, { LOG_LEVEL } from 'react-native-purchases';
import RevenueCatUI, { PAYWALL_RESULT } from 'react-native-purchases-ui';
import { supabase } from '@/services/supabase';

export const REVENUECAT_ENTITLEMENT_ID=
  process.env.EXPO_PUBLIC_REVENUECAT_ENTITLEMENT_ID?.trim()||'NicePull Pro';
export const REVENUECAT_PRODUCT_IDS={
  lifetime:'lifetime',
  yearly:'yearly',
  monthly:'monthly',
} as const;

export const PRO_FEATURES={
  advancedAnalytics:'advanced_analytics',
  unlimitedPriceAlerts:'unlimited_price_alerts',
  collectionExport:'collection_export',
  insuranceReports:'insurance_reports',
  dealerTools:'dealer_tools',
  smartTradeBuilder:'smart_trade_builder',
} as const;
export type ProFeature=typeof PRO_FEATURES[keyof typeof PRO_FEATURES];
export type PurchaseStatus='idle'|'purchasing'|'restoring'|'managing'|'success'|'cancelled'|'error';

export interface Entitlements {
  isPro:boolean;
  isLoading:boolean;
  isConfigured:boolean;
  purchaseStatus:PurchaseStatus;
  priceString:string;
  error:string;
  message:string;
  canUse:(feature:ProFeature)=>boolean;
  willCheck:()=>Promise<boolean>;
  getCustomerInfo:()=>Promise<unknown>;
  presentPaywall:()=>Promise<void>;
  presentCustomerCenter:()=>Promise<void>;
  restorePurchases:()=>Promise<void>;
  /** Backwards-compatible alias. The hosted paywall now offers all three plans. */
  purchasePro:()=>Promise<void>;
}

type Snapshot=Pick<Entitlements,'isPro'|'isLoading'|'isConfigured'|'purchaseStatus'|'priceString'|'error'|'message'>;
const initialSnapshot:Snapshot={isPro:false,isLoading:true,isConfigured:false,purchaseStatus:'idle',priceString:'View plans',error:'',message:''};
let snapshot={...initialSnapshot};
let configured=false;
let configuredUserId='';
let initializedUserId='';
let initPromise:Promise<void>|null=null;
let operation:Promise<void>|null=null;
let customerListenerInstalled=false;
const listeners=new Set<()=>void>();
const emit=(patch:Partial<Snapshot>)=>{snapshot={...snapshot,...patch};listeners.forEach(listener=>listener());};

function platformKey(){
  // A Test Store key must never be used by a release binary. Set this flag only
  // for local development; Apple/Google sandbox tests use the platform keys.
  const useTestStore=__DEV__&&process.env.EXPO_PUBLIC_REVENUECAT_USE_TEST_STORE==='true';
  if(useTestStore)return process.env.EXPO_PUBLIC_REVENUECAT_TEST_API_KEY?.trim()||'';
  if(Platform.OS==='ios')return process.env.EXPO_PUBLIC_REVENUECAT_IOS_API_KEY?.trim()||'';
  if(Platform.OS==='android')return process.env.EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY?.trim()||'';
  return '';
}

const proEntitlement=(customerInfo:any)=>customerInfo?.entitlements?.active?.[REVENUECAT_ENTITLEMENT_ID];
const friendlyError=(reason:unknown,fallback:string)=>{
  const value=reason as {message?:string;userCancelled?:boolean;code?:string};
  if(value?.userCancelled)return 'Purchase cancelled.';
  if(value?.code==='PURCHASE_NOT_ALLOWED_ERROR')return 'Purchases are not allowed on this device.';
  if(value?.code==='STORE_PROBLEM_ERROR')return 'The store is temporarily unavailable. Try again shortly.';
  if(value?.code==='NETWORK_ERROR')return 'Check your internet connection and try again.';
  return value?.message||fallback;
};

async function syncSupabase(userId:string,customerInfo:any){
  const entitlement=proEntitlement(customerInfo);
  const isPro=Boolean(entitlement);
  const {data}=await supabase.from('profiles').select('pro_purchased_at').eq('id',userId).maybeSingle();
  const {error}=await supabase.from('profiles').update({
    is_pro:isPro,
    pro_purchased_at:isPro?(data?.pro_purchased_at??entitlement?.originalPurchaseDate??entitlement?.latestPurchaseDate??new Date().toISOString()):null,
    revenuecat_app_user_id:userId,
    revenuecat_product_id:entitlement?.productIdentifier??null,
    pro_expires_at:entitlement?.expirationDate??null,
  }).eq('id',userId);
  if(error)throw new Error(`Pro was verified, but profile sync failed: ${error.message}`);
}

async function acceptCustomerInfo(customerInfo:any,userId:string){
  const isPro=Boolean(proEntitlement(customerInfo));
  emit({isPro});
  try{await syncSupabase(userId,customerInfo);}
  catch(reason){emit({error:friendlyError(reason,'Could not sync Pro status to your profile.')});}
  return isPro;
}

async function loadOffering(){
  const offerings=await Purchases.getOfferings();
  const packages=offerings.current?.availablePackages??[];
  const lifetime=packages.find((item:any)=>item.product?.identifier===REVENUECAT_PRODUCT_IDS.lifetime);
  emit({priceString:lifetime?.product?.priceString??'View plans'});
}

async function initializeForUser(userId:string,force=false){
  if(!force&&initializedUserId===userId&&!snapshot.isLoading)return;
  if(initPromise)return initPromise;
  initPromise=(async()=>{
    emit({isLoading:true,error:'',message:''});
    const apiKey=platformKey();
    if(!apiKey||apiKey.includes('replace_with')){
      emit({isPro:false,isConfigured:false,isLoading:false,error:'RevenueCat is not configured for this build.'});
      return;
    }
    if(Platform.OS!=='ios'&&Platform.OS!=='android'){
      emit({isPro:false,isConfigured:false,isLoading:false,error:'Purchases are available in the iOS and Android apps.'});
      return;
    }
    if(!configured){
      Purchases.setLogLevel(__DEV__?LOG_LEVEL.DEBUG:LOG_LEVEL.ERROR);
      Purchases.configure({apiKey,appUserID:userId});
      configured=true;
      configuredUserId=userId;
    }else if(configuredUserId!==userId){
      await Purchases.logIn(userId);
      configuredUserId=userId;
    }
    if(!customerListenerInstalled){
      Purchases.addCustomerInfoUpdateListener((info:any)=>{if(configuredUserId)void acceptCustomerInfo(info,configuredUserId);});
      customerListenerInstalled=true;
    }
    const customerInfo=await Purchases.getCustomerInfo();
    await acceptCustomerInfo(customerInfo,userId);
    await loadOffering();
    initializedUserId=userId;
    emit({isConfigured:true,isLoading:false,error:''});
  })().catch(reason=>{
    emit({isPro:false,isLoading:false,isConfigured:configured,error:friendlyError(reason,'Could not verify your Pro access.')});
  }).finally(()=>{initPromise=null;});
  return initPromise;
}

async function currentUserId(){
  const {data}=await supabase.auth.getSession();
  const userId=data.session?.user.id;
  if(!userId)throw new Error('Sign in before managing NicePull Pro.');
  return userId;
}

async function refreshCustomerInfo(){
  const userId=await currentUserId();
  await initializeForUser(userId);
  if(!snapshot.isConfigured)throw new Error(snapshot.error||'RevenueCat is not configured.');
  const customerInfo=await Purchases.getCustomerInfo();
  await acceptCustomerInfo(customerInfo,userId);
  return customerInfo;
}

async function showPaywall(){
  if(operation)return operation;
  operation=(async()=>{
    emit({purchaseStatus:'purchasing',error:'',message:''});
    try{
      const userId=await currentUserId();
      await initializeForUser(userId);
      if(!snapshot.isConfigured)throw new Error(snapshot.error||'RevenueCat is not configured.');
      const result=await RevenueCatUI.presentPaywallIfNeeded({requiredEntitlementIdentifier:REVENUECAT_ENTITLEMENT_ID});
      const customerInfo=await Purchases.getCustomerInfo();
      const unlocked=await acceptCustomerInfo(customerInfo,userId);
      if(result===PAYWALL_RESULT.CANCELLED){emit({purchaseStatus:'cancelled',message:'Purchase cancelled.'});return;}
      if(result===PAYWALL_RESULT.ERROR)throw new Error('The paywall could not complete the purchase.');
      emit({purchaseStatus:'success',message:unlocked?'NicePull Pro is active.':'No purchase was made.'});
    }catch(reason){
      const cancelled=Boolean((reason as {userCancelled?:boolean})?.userCancelled);
      emit({purchaseStatus:cancelled?'cancelled':'error',error:cancelled?'':friendlyError(reason,'Could not open NicePull Pro.'),message:cancelled?'Purchase cancelled.':''});
    }
  })().finally(()=>{operation=null;});
  return operation;
}

async function restorePro(){
  if(operation)return operation;
  operation=(async()=>{
    emit({purchaseStatus:'restoring',error:'',message:''});
    try{
      const userId=await currentUserId();
      await initializeForUser(userId);
      if(!snapshot.isConfigured)throw new Error(snapshot.error||'RevenueCat is not configured.');
      const customerInfo=await Purchases.restorePurchases();
      const restored=await acceptCustomerInfo(customerInfo,userId);
      emit({purchaseStatus:'success',message:restored?'NicePull Pro restored.':'No previous NicePull Pro purchase was found.'});
    }catch(reason){emit({purchaseStatus:'error',error:friendlyError(reason,'Could not restore purchases.')});}
  })().finally(()=>{operation=null;});
  return operation;
}

async function showCustomerCenter(){
  if(operation)return operation;
  operation=(async()=>{
    emit({purchaseStatus:'managing',error:'',message:''});
    try{
      const userId=await currentUserId();
      await initializeForUser(userId);
      if(!snapshot.isConfigured)throw new Error(snapshot.error||'RevenueCat is not configured.');
      await RevenueCatUI.presentCustomerCenter();
      const customerInfo=await Purchases.getCustomerInfo();
      await acceptCustomerInfo(customerInfo,userId);
      emit({purchaseStatus:'success',message:'Purchase status updated.'});
    }catch(reason){emit({purchaseStatus:'error',error:friendlyError(reason,'Could not open subscription management.')});}
  })().finally(()=>{operation=null;});
  return operation;
}

export function useEntitlements():Entitlements{
  const [,render]=useState(0);
  useEffect(()=>{
    const listener=()=>render(value=>value+1);
    listeners.add(listener);
    void currentUserId().then(userId=>initializeForUser(userId)).catch(()=>emit({isPro:false,isLoading:false}));
    const {data}=supabase.auth.onAuthStateChange((_event:string,session:{user:{id:string}}|null)=>{
      if(session?.user.id)void initializeForUser(session.user.id,true);
      else{initializedUserId='';configuredUserId='';emit({...initialSnapshot,isLoading:false});}
    });
    return()=>{listeners.delete(listener);data.subscription.unsubscribe();};
  },[]);
  const canUse=useCallback((_feature:ProFeature)=>snapshot.isPro,[]);
  const willCheck=useCallback(async()=>{await refreshCustomerInfo();return snapshot.isPro;},[]);
  return useMemo(()=>({...snapshot,canUse,willCheck,getCustomerInfo:refreshCustomerInfo,presentPaywall:showPaywall,presentCustomerCenter:showCustomerCenter,restorePurchases:restorePro,purchasePro:showPaywall}),[canUse,willCheck,snapshot]);
}
