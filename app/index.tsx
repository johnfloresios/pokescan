import { forwardRef, useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Dimensions, FlatList, ImageBackground, Keyboard, KeyboardAvoidingView, PanResponder, Platform, Pressable, RefreshControl, ScrollView, StyleSheet, Text, TextInput, View, type ScrollViewProps } from 'react-native';
import type { Session } from '@supabase/supabase-js';
import { Camera, type CameraRef, useCameraDevice, useCameraPermission, useFrameOutput, usePhotoOutput } from 'react-native-vision-camera';
import { useTextRecognition } from 'react-native-vision-camera-ocr-plus';
import { scheduleOnRN } from 'react-native-worklets';
import { Image } from 'expo-image';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Feather, Ionicons, MaterialCommunityIcons } from '@expo/vector-icons';
import { Card } from '@/types';
import { C, shadow } from '@/theme';
import { analyzeLiveText, recognizeCard, ScanText } from '@/services/scanner';
import { cardImageSource, getCard, rankCards, scoreCardEvidence, searchCards } from '@/services/pokewallet';
import { isSupabaseConfigured, supabase } from '@/services/supabase';
import { useEntitlements } from '@/hooks/useEntitlements';
import { useConditions, useRarities, useVariants } from '@/hooks/useCardOptions';

type Screen = 'home' | 'collection' | 'camera' | 'analyzing' | 'matches' | 'detail';
const money = (n: number | null) => n == null ? '—' : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const KeyboardAwareScrollView=forwardRef<ScrollView,ScrollViewProps>(function KeyboardAwareScrollView({children,...props},ref){
  return <ScrollView ref={ref} automaticallyAdjustKeyboardInsets contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" keyboardDismissMode={Platform.OS==='ios'?'interactive':'on-drag'} {...props}>{children}</ScrollView>;
});
const revealFocusedInput=(ref:{current:ScrollView|null},target:any,extraOffset=18)=>setTimeout(()=>ref.current?.scrollResponderScrollNativeHandleToKeyboard(target,extraOffset,true),220);

export default function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const { hasPermission, requestPermission } = useCameraPermission();
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<Card[]>([]);
  const [selected, setSelected] = useState<Card | null>(null);
  const [selectedIsSaved, setSelectedIsSaved] = useState(false);
  const [selectedSavedRow, setSelectedSavedRow] = useState<ScannedCardRow|null>(null);
  const [error, setError] = useState('');
  const [session, setSession] = useState<Session | null | undefined>(undefined);

  useEffect(() => {
    if (!isSupabaseConfigured) { setSession(null); return; }
    supabase.auth.getSession().then(({ data }: { data: { session: Session | null } }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event: string, nextSession: Session | null) => setSession(nextSession));
    return () => data.subscription.unsubscribe();
  }, []);

  const searchWithScan = async (actual: string, scan?: ScanText) => {
    setError(''); setScreen('analyzing'); setQuery(actual);
    let cards: Card[] = [];
    const candidates = (scan?.queries ?? [actual]).slice(0, 5);
    for (const candidate of candidates) {
      const found = await searchCards(candidate);
      cards = [...cards, ...found.filter(item => !cards.some(existing => existing.id === item.id))];
      if(!scan)break;
      const scored=cards.map(card=>scoreCardEvidence(card,scan.hints)).sort((a,b)=>b.score-a.score);
      const lead=(scored[0]?.score??0)-(scored[1]?.score??0);
      // Stop cascading API queries only when several independent card clues
      // produce a decisive leader; an isolated collector number is not enough.
      if((scored[0]?.score??0)>=340&&lead>=90&&(scored[0]?.signals.length??0)>=3)break;
    }
    setMatches(scan ? rankCards(cards, scan.hints) : cards); setScreen('matches');
  };

  const lookup = async (q: string, uri?: string) => {
    try {
      setError('');
      if (uri) {
        setScreen('analyzing');
        const scan=await recognizeCard(uri);
        await searchWithScan(scan.query,scan);return;
      }
      await searchWithScan(q.trim());
    } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong.'); setScreen(uri ? 'camera' : 'home'); }
  };
  const openCamera = async () => {
    if (!hasPermission) { const granted = await requestPermission(); if (!granted) return; }
    setError(''); setScreen('camera');
  };
  const choose = async (card: Card) => {
    await Haptics.selectionAsync(); setSelectedIsSaved(false); setSelectedSavedRow(null); setSelected(card); setScreen('detail');
    try { setSelected(await getCard(card.id)); } catch { /* search data is still useful */ }
  };
  const openSavedCard = async (row: ScannedCardRow) => {
    await Haptics.selectionAsync();
    setSelectedSavedRow(row);
    setScreen('analyzing');
    try {
      const cards = await searchCards(`${row.card_name} ${row.set_number}`);
      const exact = cards.find(card => row.set_number.toLowerCase().includes(card.number.toLowerCase())) ?? cards[0];
      if (exact) {
        setSelectedIsSaved(true);
        setSelected(await getCard(exact.id).catch(() => exact));
      } else {
        setSelectedIsSaved(true);
        setSelected({ id: row.id, name: row.card_name, setName: row.set_name, setCode: '', number: row.set_number, rarity: '—', type: '—', imageUrl: row.image_url ?? '', prices: [{ market: Number(row.price_estimate) || 0, low: null, high: null, source: 'Saved estimate' }] });
      }
      setScreen('detail');
    } catch (e) { setError(e instanceof Error ? e.message : 'Could not load card details.'); setScreen('collection'); }
  };
  const saveToCollection = async (card: Card) => {
    if (!session?.user.id) throw new Error('Sign in before saving a card.');
    const market = card.prices.find(price => price.market != null)?.market ?? 0;
    const { data: savedRow, error: saveError } = await supabase.from('scanned_cards').insert({
      user_id: session.user.id,
      card_name: card.name,
      set_name: card.setName,
      set_code: card.setCode,
      set_number: [card.setCode, card.number].filter(Boolean).join(' '),
      rarity: card.rarity,
      image_url: card.imageUrl,
      price_estimate: market,
      price_change_24h: null,
      quantity: 1,
      notes: '',
    }).select().single();
    if (saveError) throw new Error(saveError.message);
    const row=savedRow as ScannedCardRow;setSelectedSavedRow(row);setSelectedIsSaved(true);return row;
  };
  const updateSavedCard = async (updates:Pick<ScannedCardRow,'quantity'|'condition'|'variant'|'notes'>) => {
    if(!session?.user.id||!selectedSavedRow)throw new Error('Saved card could not be found.');
    const {data,error:updateError}=await supabase.from('scanned_cards').update(updates).eq('id',selectedSavedRow.id).eq('user_id',session.user.id).select().single();
    if(updateError)throw new Error(updateError.message);
    setSelectedSavedRow(data as ScannedCardRow);
  };
  const deleteSelectedCard = async () => {
    if(!session?.user.id||!selectedSavedRow)throw new Error('Saved card could not be found.');
    const {error:deleteError}=await supabase.from('scanned_cards').delete().eq('id',selectedSavedRow.id).eq('user_id',session.user.id);
    if(deleteError)throw new Error(deleteError.message);
    setSelectedSavedRow(null);setSelectedIsSaved(false);setScreen('collection');
  };

  if (!isSupabaseConfigured) return <AuthPlaceholder configured={false} />;
  if (session === undefined) return <View style={[s.page,s.center]}><ActivityIndicator color={C.cyan} size="large"/><Text style={s.cameraHelp}>Loading your collection…</Text></View>;
  if (!session) return <AuthPlaceholder configured />;
  if (screen === 'camera') return <CameraScreen onClose={() => setScreen('home')} onPhoto={(path:string)=>lookup('',`file://${path}`)} error={error} />;
  if (screen === 'analyzing') return <Analyzing />;
  if (screen === 'collection') return <CollectionScreen userId={session.user.id} onBack={() => setScreen('home')} onScan={openCamera} onSelect={openSavedCard} />;
  if (screen === 'matches') return <Matches query={query} cards={matches} onBack={() => setScreen('home')} onCollection={() => setScreen('collection')} onSelect={choose} onSearch={lookup} onScan={openCamera} />;
  if (screen === 'detail' && selected) return <Detail card={selected} savedRow={selectedSavedRow} onBack={() => setScreen(selectedIsSaved ? 'collection' : 'matches')} onHome={() => setScreen('home')} onCollection={() => setScreen('collection')} onSave={saveToCollection} onUpdateSaved={updateSavedCard} onDeleteSaved={deleteSelectedCard} onScan={openCamera} initiallySaved={selectedIsSaved} />;
  const displayName = [session.user.user_metadata?.nickname, session.user.user_metadata?.first_name, session.user.user_metadata?.full_name, session.user.user_metadata?.name, session.user.email?.split('@')[0]].find(value => typeof value === 'string' && value.trim())?.trim() ?? 'Collector';
  return <Home userId={session.user.id} name={displayName} email={session.user.email ?? 'Collector'} onScan={openCamera} onCollection={() => setScreen('collection')} onSelectCard={openSavedCard} onSearch={lookup} onLogout={() => supabase.auth.signOut()} error={error} />;
}

function Brand({ dark = false }: { dark?: boolean }) {
  return <View style={s.brand}><Image source={require('../assets/nicepull-icon.png')} style={s.brandLogo} contentFit="cover"/><Text style={[s.brandText, dark && { color: C.ink }]}>Nice<Text style={{ color: C.cyan }}>Pull</Text></Text></View>;
}
function TierBadge() { const {isPro,isLoading}=useEntitlements();return <View style={s.tierBadge}><Feather name="shield" size={11} color={C.yellow}/><Text style={s.tierBadgeText}>{isLoading?'…':isPro?'PRO':'FREE'}</Text></View>; }
function AppHeader({title,onBack,onClose,actions}:{title?:string;onBack?:()=>void;onClose?:()=>void;actions?:any}) { return <View style={s.top}><View><Brand/><Text style={s.headerPageTitle}>{title??"Know what you've pulled."}</Text></View><View style={s.topActions}>{onBack&&<Pressable onPress={onBack} style={s.headerAction}><Feather name="arrow-left" size={19} color={C.white}/></Pressable>}{onClose&&<Pressable onPress={onClose} style={s.headerAction}><Feather name="x" size={20} color={C.white}/></Pressable>}{actions??<TierBadge/>}</View></View>; }

function BottomNav({active,onHome,onCollection,onScan}:{active:'home'|'collection'|'other';onHome:()=>void;onCollection:()=>void;onScan:()=>void}) {
  const sell=()=>Alert.alert('Sell cards','The selling marketplace is coming soon.');
  const itemStyle=[s.navItem,{flex:1,width:undefined}];
  return <View style={s.bottomNav}><Pressable onPress={onHome} style={itemStyle}><Feather name="home" size={20} color={active==='home'?C.yellow:C.muted}/><Text style={[s.navText,active==='home'&&{color:C.yellow}]}>Home</Text></Pressable><Pressable onPress={onCollection} style={itemStyle}><Feather name="layers" size={20} color={active==='collection'?C.yellow:C.muted}/><Text style={[s.navText,active==='collection'&&{color:C.yellow}]}>Collection</Text></Pressable><Pressable onPress={onScan} style={itemStyle}><MaterialCommunityIcons name="line-scan" size={20} color={C.muted}/><Text style={s.navText}>Scan</Text></Pressable><Pressable onPress={sell} style={itemStyle}><Feather name="tag" size={20} color={C.green}/><Text style={[s.navText,{color:C.green}]}>Sell</Text></Pressable></View>;
}

type ScannedCardRow = { id:string;card_name:string;set_name:string;set_code:string|null;set_number:string;rarity:string|null;image_url:string|null;price_estimate:number|string|null;price_change_24h:number|string|null;quantity:number|null;condition:string|null;variant:string|null;notes:string|null;is_graded:boolean|null;created_at:string };

function AuthPlaceholder({ configured }: { configured: boolean }) {
  const [mode,setMode]=useState<'signin'|'signup'>('signin');
  const [email,setEmail]=useState('');
  const [password,setPassword]=useState('');
  const [firstName,setFirstName]=useState('');
  const [lastName,setLastName]=useState('');
  const [nickname,setNickname]=useState('');
  const [showPassword,setShowPassword]=useState(false);
  const [loading,setLoading]=useState(false);
  const [message,setMessage]=useState('');
  const [authError,setAuthError]=useState('');

  const submit=async()=>{
    const cleanEmail=email.trim().toLowerCase();
    setAuthError('');setMessage('');
    if(mode==='signup'&&(!firstName.trim()||!lastName.trim())){setAuthError('Enter your first and last name.');return;}
    if(!/^\S+@\S+\.\S+$/.test(cleanEmail)){setAuthError('Enter a valid email address.');return;}
    if(password.length<6){setAuthError('Password must be at least 6 characters.');return;}
    setLoading(true);
    const result=mode==='signin'
      ?await supabase.auth.signInWithPassword({email:cleanEmail,password})
      :await supabase.auth.signUp({email:cleanEmail,password,options:{data:{first_name:firstName.trim(),last_name:lastName.trim(),nickname:nickname.trim()||null,full_name:`${firstName.trim()} ${lastName.trim()}`,name:nickname.trim()||firstName.trim()}}});
    setLoading(false);
    if(result.error){setAuthError(result.error.message);return;}
    if(mode==='signup'&&!result.data.session)setMessage('Check your email to confirm your account, then sign in.');
  };
  const resetPassword=async()=>{
    const cleanEmail=email.trim().toLowerCase();setAuthError('');setMessage('');
    if(!/^\S+@\S+\.\S+$/.test(cleanEmail)){setAuthError('Enter your email above first.');return;}
    setLoading(true);const {error}=await supabase.auth.resetPasswordForEmail(cleanEmail);setLoading(false);
    if(error)setAuthError(error.message);else setMessage('Password reset instructions were sent to your email.');
  };

  if(!configured)return <View style={s.page}><LinearGradient colors={['#160D2B',C.ink,'#07050C']} style={StyleSheet.absoluteFill}/><SafeAreaView style={s.safe}><AppHeader/><View style={s.centerContent}><View style={s.authMark}><MaterialCommunityIcons name="database-alert" size={40} color={C.yellow}/></View><Text style={s.authTitle}>Connect Supabase</Text><Text style={s.authCopy}>Add EXPO_PUBLIC_SUPABASE_URL and EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY to .env, then restart Expo.</Text></View></SafeAreaView></View>;
  return <View style={s.page}><LinearGradient colors={['#160D2B',C.ink,'#07050C']} style={StyleSheet.absoluteFill}/><KeyboardAvoidingView style={s.safe} behavior={Platform.OS==='ios'?'padding':'height'}><SafeAreaView style={s.safe}><AppHeader/><ScrollView contentContainerStyle={s.authScroll} automaticallyAdjustKeyboardInsets contentInsetAdjustmentBehavior="automatic" keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive"><View style={s.authMark}><MaterialCommunityIcons name="pokeball" size={42} color={C.yellow}/></View><Text style={s.authTitle}>{mode==='signin'?'Welcome back':'Create your account'}</Text><Text style={s.authCopy}>{mode==='signin'?'Sign in to view your collection and scan history.':'Start tracking the cards you scan and their value.'}</Text><View style={s.authForm}>
    {mode==='signup'&&<><View style={s.authNameRow}><View style={s.authNameField}><Text style={s.authLabel}>FIRST NAME</Text><View style={s.authInputWrap}><TextInput value={firstName} onChangeText={setFirstName} placeholder="First" placeholderTextColor="#687B95" style={s.authInput} autoCapitalize="words" textContentType="givenName"/></View></View><View style={s.authNameField}><Text style={s.authLabel}>LAST NAME</Text><View style={s.authInputWrap}><TextInput value={lastName} onChangeText={setLastName} placeholder="Last" placeholderTextColor="#687B95" style={s.authInput} autoCapitalize="words" textContentType="familyName"/></View></View></View><Text style={s.authLabel}>NICKNAME <Text style={s.optional}>(OPTIONAL)</Text></Text><View style={s.authInputWrap}><Feather name="smile" size={18} color={C.muted}/><TextInput value={nickname} onChangeText={setNickname} placeholder="What should we call you?" placeholderTextColor="#687B95" style={s.authInput} autoCapitalize="words"/></View></>}
    <Text style={s.authLabel}>EMAIL</Text><View style={s.authInputWrap}><Feather name="mail" size={18} color={C.muted}/><TextInput value={email} onChangeText={setEmail} placeholder="you@example.com" placeholderTextColor="#687B95" style={s.authInput} keyboardType="email-address" autoCapitalize="none" autoCorrect={false} textContentType="emailAddress" selectionColor={C.cyan}/></View><Text style={s.authLabel}>PASSWORD</Text><View style={s.authInputWrap}><Feather name="lock" size={18} color={C.muted}/><TextInput value={password} onChangeText={setPassword} placeholder="At least 6 characters" placeholderTextColor="#687B95" style={s.authInput} secureTextEntry={!showPassword} autoCapitalize="none" autoCorrect={false} textContentType={mode==='signin'?'password':'newPassword'} selectionColor={C.cyan} onSubmitEditing={submit}/><Pressable onPress={()=>setShowPassword(value=>!value)} hitSlop={10}><Feather name={showPassword?'eye-off':'eye'} size={18} color={C.muted}/></Pressable></View>{mode==='signin'&&<Pressable onPress={resetPassword} disabled={loading} style={s.forgot}><Text style={s.forgotText}>Forgot password?</Text></Pressable>}{!!authError&&<View style={s.authNoticeError}><Feather name="alert-circle" size={15} color="#FF8B96"/><Text style={s.authErrorText}>{authError}</Text></View>}{!!message&&<View style={s.authNoticeSuccess}><Feather name="check-circle" size={15} color={C.green}/><Text style={s.authSuccessText}>{message}</Text></View>}<Pressable onPress={submit} disabled={loading} style={({pressed})=>[s.authSubmit,(pressed||loading)&&{opacity:.7}]}>{loading?<ActivityIndicator color={C.ink}/>:<><Text style={s.authSubmitText}>{mode==='signin'?'SIGN IN':'CREATE ACCOUNT'}</Text><Feather name="arrow-right" size={18} color={C.ink}/></>}</Pressable><View style={s.authSwitch}><Text style={s.authSwitchCopy}>{mode==='signin'?"Don't have an account?":'Already have an account?'}</Text><Pressable onPress={()=>{setMode(value=>value==='signin'?'signup':'signin');setAuthError('');setMessage('');}}><Text style={s.authSwitchAction}>{mode==='signin'?'Create one':'Sign in'}</Text></Pressable></View></View></ScrollView></SafeAreaView></KeyboardAvoidingView></View>;
}

function Home({ userId, name, email, onScan, onCollection, onSelectCard, onSearch, onLogout, error }: { userId:string;name:string;email:string;onScan:()=>void;onCollection:()=>void;onSelectCard:(row:ScannedCardRow)=>void;onSearch:(q:string)=>void;onLogout:()=>void;error:string }) {
  const scrollRef=useRef<ScrollView>(null);
  const [text, setText] = useState('');
  const [cards,setCards]=useState<ScannedCardRow[]>([]);
  const [totalValue,setTotalValue]=useState(0);
  const [totalCount,setTotalCount]=useState(0);
  const [loading,setLoading]=useState(true);
  const [dataError,setDataError]=useState('');
  const loadDashboard=useCallback(async()=>{
    setLoading(true);setDataError('');
    const [values,recent]=await Promise.all([
      supabase.from('scanned_cards').select('price_estimate,quantity',{count:'exact'}).eq('user_id',userId),
      supabase.from('scanned_cards').select('id,card_name,set_name,set_code,set_number,rarity,image_url,price_estimate,price_change_24h,quantity,condition,variant,notes,is_graded,created_at').eq('user_id',userId).order('created_at',{ascending:false}).limit(5),
    ]);
    if(values.error||recent.error){setDataError(values.error?.message??recent.error?.message??'Could not load collection.');}
    const rows=(values.data??[]) as Array<{price_estimate:number|string|null;quantity:number|null}>;
    setTotalValue(rows.reduce((sum,row)=>sum+(Number(row.price_estimate)||0)*Math.max(1,Number(row.quantity)||1),0));
    setTotalCount(rows.reduce((sum,row)=>sum+Math.max(1,Number(row.quantity)||1),0));setCards((recent.data??[]) as ScannedCardRow[]);setLoading(false);
  },[userId]);
  useEffect(()=>{void loadDashboard();},[loadDashboard]);
  return <View style={s.page}>
    <LinearGradient colors={['#160D2B', C.ink, '#07050C']} style={StyleSheet.absoluteFill} />
    <KeyboardAvoidingView style={s.safe} behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={Platform.OS==='ios'?18:0}>
    <SafeAreaView style={s.safe}>
      <AppHeader actions={<><TierBadge/><Pressable onPress={onLogout} style={s.logout}><Feather name="log-out" size={15} color={C.white}/><Text style={s.logoutText}>Log out</Text></Pressable></>}/>
      <ScrollView ref={scrollRef} contentContainerStyle={s.dashboardScroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive" refreshControl={<RefreshControl refreshing={loading} onRefresh={loadDashboard} tintColor={C.cyan}/>}>
        <View style={s.dashboardHello}><Text style={s.dashboardEyebrow}>YOUR COLLECTION</Text><Text style={s.dashboardTitle}>Welcome back, {name}.</Text><Text style={s.dashboardEmail}>{email}</Text></View>
        <PremiumPurchaseCard/>
        <View style={s.metricRow}><Pressable onPress={onCollection} style={s.metricCard}><Text style={s.metricLabel}>PORTFOLIO VALUE</Text><Text style={s.metricValue}>{money(totalValue)}</Text><View style={s.metricTrend}><Feather name="trending-up" size={13} color={C.green}/><Text style={s.metricTrendText}>Live estimates</Text></View></Pressable><Pressable onPress={onCollection} style={s.metricCard}><Text style={s.metricLabel}>TOTAL CARDS</Text><Text style={s.metricValue}>{totalCount}</Text><Text style={s.metricHint}>Scanned cards</Text></Pressable></View>
        <Pressable onPress={onScan} style={({pressed})=>[s.heroScan,pressed&&{transform:[{scale:.98}]}]}><LinearGradient colors={['#9333EA','#6D28D9','#4C1D95']} start={{x:0,y:0}} end={{x:1,y:1}} style={s.heroScanGradient}><View style={s.heroScanIcon}><MaterialCommunityIcons name="line-scan" size={34} color={C.ink}/></View><View style={{flex:1}}><Text style={s.heroScanTitle}>SCAN CARD</Text><Text style={s.heroScanSub}>Identify and value a new card</Text></View><Feather name="arrow-up-right" size={24} color={C.white}/></LinearGradient></Pressable>
        <View style={s.divider}><View style={s.divLine} /><Text style={s.or}>OR SEARCH MANUALLY</Text><View style={s.divLine} /></View>
        <View style={s.searchBox}><Feather name="search" size={20} color={C.muted} /><TextInput value={text} onChangeText={setText} onFocus={event=>revealFocusedInput(scrollRef,event.target)} onSubmitEditing={() => text.trim() && onSearch(text.trim())} placeholder="Card name or number" placeholderTextColor="#7F91AA" selectionColor={C.cyan} cursorColor={C.cyan} style={s.input} returnKeyType="search" autoCorrect={false} autoCapitalize="words" /><Pressable onPress={() => text.trim() && onSearch(text.trim())} style={s.searchGo}><Feather name="arrow-right" size={18} color={C.ink} /></Pressable></View>
        {!!(error||dataError)&&<Text style={s.error}>{error||dataError}</Text>}
        <View style={s.sectionRow}><Text style={s.dashboardSection}>RECENT SCANS</Text><Pressable onPress={onCollection} hitSlop={10}><Text style={s.seeAll}>View collection</Text></Pressable></View>
        {!loading&&!cards.length?<View style={s.recentEmpty}><MaterialCommunityIcons name="cards-outline" size={34} color={C.muted}/><Text style={s.emptyTitle}>No scans yet</Text><Text style={s.emptySub}>Scan your first card to start a collection.</Text></View>:cards.map(card=><Pressable key={card.id} onPress={()=>onSelectCard(card)} accessibilityRole="button" accessibilityLabel={`View ${card.card_name} details`} style={({pressed})=>[s.recentCard,pressed&&{opacity:.72}]}>{card.image_url?<Image source={{uri:card.image_url}} style={s.recentImage} contentFit="cover"/>:<View style={[s.recentImage,s.recentPlaceholder]}><MaterialCommunityIcons name="cards" size={22} color={C.muted}/></View>}<View style={s.recentInfo}><Text style={s.recentName} numberOfLines={1}>{card.card_name}</Text><Text style={s.recentSet} numberOfLines={1}>{card.set_name} · {card.set_number}</Text></View><Text style={s.recentPrice}>{money(Number(card.price_estimate)||0)}</Text><Feather name="chevron-right" size={17} color={C.muted}/></Pressable>)}
      </ScrollView>
      <BottomNav active="home" onHome={()=>{}} onCollection={onCollection} onScan={onScan}/>
    </SafeAreaView>
    </KeyboardAvoidingView>
  </View>;
}
function Stat({ icon, value, label }: { icon: any; value: string; label: string }) { return <View style={s.stat}><Feather name={icon} size={17} color={C.cyan} /><Text style={s.statValue}>{value}</Text><Text style={s.statLabel}>{label}</Text></View>; }

function PremiumPurchaseCard(){
  const {isPro,isLoading,purchaseStatus,priceString,error,message,presentPaywall,presentCustomerCenter,restorePurchases}=useEntitlements();
  const busy=isLoading||['purchasing','restoring','managing'].includes(purchaseStatus);
  return <View style={[s.premiumCard,isPro&&s.premiumCardActive]}><View style={s.premiumCardTop}><View style={s.premiumIcon}><Feather name={isPro?'check':'star'} size={18} color={isPro?C.green:C.yellow}/></View><View style={{flex:1}}><Text style={s.premiumTitle}>{isPro?'NicePull Pro is active':'Upgrade to NicePull Pro'}</Text><Text style={s.premiumCopy}>{isPro?'Manage your purchase or subscription.':'Choose Lifetime, Yearly, or Monthly on the secure paywall.'}</Text></View><Text style={s.premiumPrice}>{isPro?'PRO':priceString}</Text></View>{!isPro&&<Pressable disabled={busy} onPress={()=>void presentPaywall()} style={({pressed})=>[s.premiumBuy,(pressed||busy)&&{opacity:.6}]}>{purchaseStatus==='purchasing'?<ActivityIndicator color={C.ink}/>:<Text style={s.premiumBuyText}>VIEW PRO OPTIONS</Text>}</Pressable>}{isPro&&<Pressable disabled={busy} onPress={()=>void presentCustomerCenter()} style={({pressed})=>[s.premiumBuy,(pressed||busy)&&{opacity:.6}]}>{purchaseStatus==='managing'?<ActivityIndicator color={C.ink}/>:<Text style={s.premiumBuyText}>MANAGE PURCHASE</Text>}</Pressable>}<Pressable disabled={busy} onPress={()=>void restorePurchases()} style={s.restoreButton}>{purchaseStatus==='restoring'?<ActivityIndicator size="small" color={C.cyan}/>:<Text style={s.restoreText}>Restore Purchases</Text>}</Pressable>{!!error&&<Text style={s.premiumError}>{error}</Text>}{!!message&&<Text style={s.premiumMessage}>{message}</Text>}</View>;
}

const COLLECTION_PAGE_SIZE=20;
type CollectionSort='newest'|'value_high'|'value_low'|'name'|'gainers';

const mockCardChange=(id:string)=>{
  const hash=[...id].reduce((sum,char)=>sum+char.charCodeAt(0),0);
  return Number((((hash%81)-30)/10).toFixed(1));
};
const cardChange=(card:ScannedCardRow)=>card.price_change_24h==null?mockCardChange(card.id):Number(card.price_change_24h)||0;

function CollectionChip({label,active,onPress}:{label:string;active:boolean;onPress:()=>void}) {
  return <Pressable onPress={onPress} style={[s.filterChip,active&&s.filterChipActive]}><Text style={[s.filterChipText,active&&s.filterChipTextActive]}>{label}</Text></Pressable>;
}

function Sparkline({positive=true,value,change}:{positive?:boolean;value:number;change:number}) {
  const values=positive?[24,25,24.5,27,28.5,28,31,30.5,34,36,35.5,39,38,41,43,45]:[45,43,44,41,39,40,36,37,34,32,33,29,30,27,26,24];
  const width=Math.min(W-72,340),height=54,step=width/(values.length-1),min=Math.min(...values),max=Math.max(...values);
  const point=(index:number)=>({x:index*step,y:height-7-((values[index]-min)/(max-min))*(height-16)});
  const color=positive?C.green:C.red;
  return <View style={{alignSelf:'center'}}><View style={[s.sparkline,{width,height}]}><LinearGradient colors={[positive?'rgba(69,212,131,.13)':'rgba(244,63,80,.13)','rgba(16,29,48,0)']} style={StyleSheet.absoluteFill}/><View style={[s.chartGrid,{top:height*.33}]}/><View style={[s.chartGrid,{top:height*.68}]}/>{values.slice(0,-1).map((_item,index)=>{const a=point(index),b=point(index+1),dx=b.x-a.x,dy=b.y-a.y,length=Math.sqrt(dx*dx+dy*dy),angle=Math.atan2(dy,dx)*180/Math.PI;return <View key={index} style={[s.sparkSegment,{backgroundColor:color,width:length,left:(a.x+b.x)/2-length/2,top:(a.y+b.y)/2-1.25,transform:[{rotate:`${angle}deg`}]}]}/>;})}<View style={[s.chartDot,{left:point(0).x-3,top:point(0).y-3,borderColor:color}]}/><View style={[s.chartCurrentHalo,{left:point(values.length-1).x-7,top:point(values.length-1).y-7,borderColor:color}]}/><View style={[s.chartCurrentDot,{left:point(values.length-1).x-3.5,top:point(values.length-1).y-3.5,backgroundColor:color}]}/></View><View style={[s.chartLabels,{width}]}><View><Text style={s.chartTime}>24H AGO</Text><Text style={s.chartValue}>{money(value-change)}</Text></View><View style={{alignItems:'flex-end'}}><Text style={s.chartTime}>NOW</Text><Text style={[s.chartValue,{color}]}>{money(value)}</Text></View></View></View>;
}

function RarityBadge({rarity}:{rarity:string|null}) {
  const label=rarity?.trim()||'Unknown';
  const special=/illustration|hyper|double|secret/i.test(label);
  return <View style={[s.rarityBadge,special&&s.rarityBadgeSpecial]}><Text style={[s.rarityText,special&&s.rarityTextSpecial]} numberOfLines={1}>{label}</Text></View>;
}

function CollectionSkeleton() {
  return <View>{[0,1,2,3].map(index=><View key={index} style={s.skeletonRow}><View style={[s.skeletonBlock,s.skeletonImage]}/><View style={{flex:1,gap:9}}><View style={[s.skeletonBlock,{width:'72%',height:14}]}/><View style={[s.skeletonBlock,{width:'50%',height:10}]}/><View style={[s.skeletonBlock,{width:'38%',height:18}]}/></View><View style={[s.skeletonBlock,{width:58,height:18}]}/></View>)}</View>;
}

function SwipeToDelete({children,onDelete}:{children:any;onDelete:()=>void}) {
  const x=useRef(new Animated.Value(0)).current;
  const isOpen=useRef(false);const startX=useRef(0);
  const settle=(open:boolean)=>{isOpen.current=open;Animated.spring(x,{toValue:open?-104:0,useNativeDriver:true,bounciness:0,speed:24}).start();};
  const responder=useRef(PanResponder.create({
    onMoveShouldSetPanResponder:(_event,gesture)=>Math.abs(gesture.dx)>5&&Math.abs(gesture.dx)>Math.abs(gesture.dy)*1.15,
    onPanResponderGrant:()=>{startX.current=isOpen.current?-104:0;},
    onPanResponderMove:(_event,gesture)=>x.setValue(Math.max(-112,Math.min(0,startX.current+gesture.dx))),
    onPanResponderRelease:(_event,gesture)=>settle(isOpen.current?!(gesture.dx>42||gesture.vx>.25):(gesture.dx<-22||gesture.vx<-.25)),
    onPanResponderTerminate:()=>settle(false),
    onPanResponderTerminationRequest:()=>false,
  })).current;
  return <View style={s.swipeWrap}><Pressable onPress={onDelete} style={s.swipeDelete}><Feather name="trash-2" size={20} color={C.white}/><Text style={s.swipeDeleteText}>Delete</Text></Pressable><Animated.View {...responder.panHandlers} style={{transform:[{translateX:x}]}}>{children}</Animated.View></View>;
}

function CollectionScreen({userId,onBack,onScan,onSelect}:{userId:string;onBack:()=>void;onScan:()=>void;onSelect:(row:ScannedCardRow)=>void}) {
  const {options:rarityOptions,isLoading:raritiesLoading}=useRarities();
  const [cards,setCards]=useState<ScannedCardRow[]>([]);
  const [loading,setLoading]=useState(true);
  const [loadingMore,setLoadingMore]=useState(false);
  const [loadError,setLoadError]=useState('');
  const [search,setSearch]=useState('');
  const [sort,setSort]=useState<CollectionSort>('newest');
  const [condition,setCondition]=useState('All');
  const [variant,setVariant]=useState('All');
  const [rarity,setRarity]=useState('All');
  const [setName,setSetName]=useState('All');
  const [availableSets,setAvailableSets]=useState<string[]>([]);
  const [rowCount,setRowCount]=useState(0);
  const [copyCount,setCopyCount]=useState(0);
  const [setCount,setSetCount]=useState(0);
  const [uniqueCount,setUniqueCount]=useState(0);
  const [gradedCount,setGradedCount]=useState(0);
  const [portfolioValue,setPortfolioValue]=useState(0);

  const load=useCallback(async(reset=true)=>{
    reset?setLoading(true):setLoadingMore(true);setLoadError('');
    const offset=reset?0:cards.length;
    let request=supabase.from('scanned_cards').select('id,card_name,set_name,set_code,set_number,rarity,image_url,price_estimate,price_change_24h,quantity,condition,variant,notes,is_graded,created_at',{count:'exact'}).eq('user_id',userId);
    const safeSearch=search.trim().replace(/[,%()]/g,' ');
    if(safeSearch)request=request.or(`card_name.ilike.%${safeSearch}%,set_name.ilike.%${safeSearch}%,set_number.ilike.%${safeSearch}%`);
    if(condition!=='All')request=request.eq('condition',condition);
    if(variant!=='All')request=request.eq('variant',variant);
    if(rarity!=='All')request=request.eq('rarity',rarity);
    if(setName!=='All')request=request.eq('set_name',setName);
    if(sort==='value_high')request=request.order('price_estimate',{ascending:false});
    else if(sort==='value_low')request=request.order('price_estimate',{ascending:true});
    else if(sort==='name')request=request.order('card_name',{ascending:true});
    else request=request.order('created_at',{ascending:false});
    const {data,error,count}=sort==='gainers'?await request:await request.range(offset,offset+COLLECTION_PAGE_SIZE-1);
    if(error)setLoadError(error.message);
    else {const matched=(data??[]) as ScannedCardRow[];if(sort==='gainers')matched.sort((a,b)=>Math.abs(cardChange(b))-Math.abs(cardChange(a)));const next=sort==='gainers'?matched.slice(offset,offset+COLLECTION_PAGE_SIZE):matched;setCards(current=>reset?next:[...current,...next]);setRowCount(count??matched.length);}
    if(reset){
      const summary=await supabase.from('scanned_cards').select('price_estimate,quantity,set_name,set_number,is_graded').eq('user_id',userId);
      if(!summary.error){const rows=(summary.data??[]) as Array<{price_estimate:number|string|null;quantity:number|null;set_name:string;set_number:string;is_graded:boolean|null}>;setCopyCount(rows.reduce((sum,row)=>sum+Math.max(1,Number(row.quantity)||1),0));setPortfolioValue(rows.reduce((sum,row)=>sum+(Number(row.price_estimate)||0)*Math.max(1,Number(row.quantity)||1),0));const sets=[...new Set(rows.map(row=>row.set_name).filter(Boolean))].sort();setAvailableSets(sets);setSetCount(sets.length);setUniqueCount(new Set(rows.map(row=>`${row.set_name}|${row.set_number}`)).size);setGradedCount(rows.reduce((sum,row)=>sum+(row.is_graded?Math.max(1,Number(row.quantity)||1):0),0));}
    }
    setLoading(false);setLoadingMore(false);
  },[cards.length,condition,rarity,search,setName,sort,userId,variant]);

  useEffect(()=>{const timer=setTimeout(()=>{void load(true);},search?300:0);return()=>clearTimeout(timer);},[condition,rarity,search,setName,sort,userId,variant]);
  const deleteFromList=(card:ScannedCardRow)=>Alert.alert('Delete saved card?',`${card.card_name} will be removed from your collection.`,[{text:'Cancel',style:'cancel'},{text:'Delete',style:'destructive',onPress:async()=>{const {error}=await supabase.from('scanned_cards').delete().eq('id',card.id).eq('user_id',userId);if(error){Alert.alert('Could not delete card',error.message);return;}await load(true);}}]);
  const hasMore=cards.length<rowCount;
  const portfolioChange=2.4;
  const portfolioChangeDollars=portfolioValue*(portfolioChange/100);
  const filtered=!!search||condition!=='All'||variant!=='All'||rarity!=='All'||setName!=='All';

  const header=<View><View style={s.portfolioHero}><View style={s.portfolioTopLine}><View><Text style={s.portfolioLabel}>TOTAL PORTFOLIO VALUE</Text><Text style={s.portfolioAmount}>{money(portfolioValue)}</Text><Text style={[s.portfolioDelta,{color:portfolioChange>=0?C.green:C.red}]}>{portfolioChange>=0?'+':''}{money(portfolioChangeDollars)} ({portfolioChange>=0?'+':''}{portfolioChange.toFixed(1)}%) today</Text></View><View style={s.dayChange}><Feather name={portfolioChange>=0?'arrow-up-right':'arrow-down-right'} size={14} color={portfolioChange>=0?C.green:C.red}/><Text style={s.dayChangePeriod}>24H</Text></View></View><Sparkline positive={portfolioChange>=0} value={portfolioValue} change={portfolioChangeDollars}/><View style={s.portfolioStats}><Text style={s.portfolioStat}><Text style={s.portfolioStatStrong}>{copyCount}</Text> cards</Text><View style={s.statDot}/><Text style={s.portfolioStat}><Text style={s.portfolioStatStrong}>{uniqueCount}</Text> unique</Text><View style={s.statDot}/><Text style={s.portfolioStat}><Text style={s.portfolioStatStrong}>{setCount}</Text> sets</Text></View></View>
    <View style={s.collectionSearch}><Feather name="search" size={18} color={C.muted}/><TextInput value={search} onChangeText={setSearch} placeholder="Search name, set, or number" placeholderTextColor="#7F91AA" selectionColor={C.cyan} style={s.collectionSearchInput} autoCorrect={false}/>{!!search&&<Pressable onPress={()=>setSearch('')} hitSlop={10}><Feather name="x-circle" size={18} color={C.muted}/></Pressable>}</View>
    <Text style={s.filterLabel}>SORT BY</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filterRow}><CollectionChip label="Newest scanned" active={sort==='newest'} onPress={()=>setSort('newest')}/><CollectionChip label="Value high → low" active={sort==='value_high'} onPress={()=>setSort('value_high')}/><CollectionChip label="Value low → high" active={sort==='value_low'} onPress={()=>setSort('value_low')}/><CollectionChip label="Alphabetical" active={sort==='name'} onPress={()=>setSort('name')}/><CollectionChip label="Biggest 24h movers" active={sort==='gainers'} onPress={()=>setSort('gainers')}/></ScrollView>
    <Text style={s.filterLabel}>RARITY</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filterRow}><CollectionChip label="All rarities" active={rarity==='All'} onPress={()=>setRarity('All')}/>{rarityOptions.map(option=><CollectionChip key={option.id} label={option.label} active={rarity===option.code} onPress={()=>setRarity(option.code)}/>)}{raritiesLoading&&<ActivityIndicator size="small" color={C.cyan}/>}</ScrollView>
    {!!availableSets.length&&<><Text style={s.filterLabel}>SET</Text><ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={s.filterRow}><CollectionChip label="All sets" active={setName==='All'} onPress={()=>setSetName('All')}/>{availableSets.map(value=><CollectionChip key={value} label={value} active={setName===value} onPress={()=>setSetName(value)}/>)}</ScrollView></>}
    <View style={s.collectionHeading}><Text style={s.dashboardSection}>YOUR CARDS</Text><Text style={s.collectionLimit}>{rowCount} entries</Text></View>{!!loadError&&<Text style={s.error}>{loadError}</Text>}</View>;

  const renderCard=({item:card}:{item:ScannedCardRow})=>{const change=cardChange(card),positive=change>=0,quantity=Math.max(1,Number(card.quantity)||1);return <SwipeToDelete onDelete={()=>deleteFromList(card)}><Pressable onPress={()=>onSelect(card)} style={({pressed})=>[s.collectionRow,pressed&&{opacity:.75}]}>{card.image_url?<Image source={{uri:card.image_url}} style={s.collectionImage} contentFit="cover" transition={150}/>:<View style={[s.collectionImage,s.recentPlaceholder]}><MaterialCommunityIcons name="cards" size={28} color={C.muted}/></View>}<View style={s.collectionCardInfo}><View style={s.collectionNameLine}><Text style={s.collectionName} numberOfLines={1}>{card.card_name}</Text></View><Text style={s.collectionNumber} numberOfLines={1}>{card.set_code?`${card.set_code} `:''}{card.set_number.replace(card.set_code||'','').trim()}</Text><RarityBadge rarity={card.rarity}/><Text style={s.collectionMeta} numberOfLines={1}>{card.condition||'—'} · Qty {quantity}</Text></View><View style={s.collectionPriceWrap}><Text style={s.collectionMarketPrice}>{money((Number(card.price_estimate)||0)*quantity)}</Text><View style={[s.rowChange,!positive&&s.rowChangeDown]}><Feather name={positive?'arrow-up-right':'arrow-down-right'} size={11} color={positive?C.green:C.red}/><Text style={[s.rowChangeText,!positive&&{color:C.red}]}>{positive?'+':''}{change.toFixed(1)}%</Text></View><View style={s.swipeHint}><Feather name="chevron-left" size={13} color={C.muted}/><Text style={s.swipeHintText}>SWIPE</Text></View></View></Pressable></SwipeToDelete>;};

  return <View style={s.page}><SafeAreaView style={s.safe}><AppHeader title="Collection" onBack={onBack}/>
    <FlatList data={cards} renderItem={renderCard} keyExtractor={card=>card.id} ListHeaderComponent={header} ListEmptyComponent={loading?<CollectionSkeleton/>:<View style={s.collectionEmpty}><View style={s.emptyOrb}><MaterialCommunityIcons name="cards-outline" size={42} color={C.cyan}/></View><Text style={s.emptyTitle}>{filtered?'No cards match':'Build your collection'}</Text><Text style={s.emptySub}>{filtered?'Try clearing your search or choosing another filter.':'Scan your first Pokémon card to track its value and market movement.'}</Text>{!filtered&&<Pressable onPress={onScan} style={s.emptyScan}><MaterialCommunityIcons name="line-scan" size={16} color={C.ink}/><Text style={s.emptyScanText}>SCAN YOUR FIRST CARD</Text></Pressable>}</View>} ListFooterComponent={loadingMore?<ActivityIndicator style={{marginVertical:20}} color={C.cyan}/>:null} contentContainerStyle={s.collectionList} showsVerticalScrollIndicator={false} automaticallyAdjustKeyboardInsets keyboardDismissMode={Platform.OS==='ios'?'interactive':'on-drag'} keyboardShouldPersistTaps="handled" refreshControl={<RefreshControl refreshing={loading&&cards.length>0} onRefresh={()=>load(true)} tintColor={C.cyan}/>} onEndReached={()=>{if(hasMore&&!loadingMore&&!loading)void load(false);}} onEndReachedThreshold={.35} initialNumToRender={8} maxToRenderPerBatch={10} windowSize={7}/>
    <BottomNav active="collection" onHome={onBack} onCollection={()=>{}} onScan={onScan}/></SafeAreaView></View>;
}

function ScannerBeam() {
  const progress = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const animation = Animated.loop(Animated.sequence([
      Animated.timing(progress, { toValue: 1, duration: 1750, useNativeDriver: true }),
      Animated.timing(progress, { toValue: 0, duration: 1750, useNativeDriver: true }),
    ]));
    animation.start(); return () => animation.stop();
  }, [progress]);
  return <Animated.View style={[s.scanLine, { transform: [{ translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [8, SCAN_WIDTH * 88 / 63 - 18] }) }] }]}><LinearGradient colors={['transparent', C.cyan, C.white, C.cyan, 'transparent']} start={{x:0,y:0}} end={{x:1,y:0}} style={StyleSheet.absoluteFill}/></Animated.View>;
}

function CameraScreen({ onClose, onPhoto, error }: any) {
  const camera = useRef<CameraRef>(null);
  const device = useCameraDevice('back', { physicalDevices: ['wide-angle'] });
  const photoOutput = usePhotoOutput({ targetResolution: { width: 4032, height: 3024 }, containerFormat: 'jpeg', qualityPrioritization: 'balanced', quality: .95 });
  const { scanText } = useTextRecognition({ language: 'latin', frameSkipThreshold: 5 });
  const [ready, setReady] = useState(false);
  const [active, setActive] = useState(true);
  const [status, setStatus] = useState('Looking for name + card number…');
  const lastSignature = useRef('');
  const stableFrames = useRef(0);
  const locked = useRef(false);

  useEffect(() => {
    if (!ready) return;
    photoOutput.prepareSettings([{ flashMode: 'off', enableShutterSound: true }]).catch(() => undefined);
  }, [photoOutput, ready]);

  const finishScan = useCallback(async (scan: ScanText) => {
    if (locked.current) return;
    locked.current = true;
    setStatus('Card detected · reading bottom details…');
    try {
      setStatus('Capturing card…');
      const {filePath}=await photoOutput.capturePhotoToFile({flashMode:'off',enableShutterSound:true},{});
      setActive(false);
      void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      await onPhoto(filePath);
    } catch (e) {
      locked.current = false;
      setActive(true);
      stableFrames.current = 0;
      setStatus(e instanceof Error ? e.message : 'Hold steady and try again');
    }
  }, [onPhoto, photoOutput]);

  const handleText = useCallback((recognizedText: string) => {
    if (locked.current) return;
    const scan = analyzeLiveText(recognizedText);
    if (!scan.cardDetected || !scan.hints.name) {
      stableFrames.current = 0;
      lastSignature.current = '';
      setStatus('Reading character name…');
      return;
    }
    const signature = scan.hints.name.toLowerCase();
    stableFrames.current = signature === lastSignature.current ? stableFrames.current + 1 : 1;
    lastSignature.current = signature;
    const requiredFrames = scan.hints.number ? 2 : 3;
    setStatus(stableFrames.current >= requiredFrames ? 'Card stable · capturing details…' : `Found ${scan.hints.name} · hold steady…`);
    if (stableFrames.current >= requiredFrames) void finishScan(scan);
  }, [finishScan]);

  const frameOutput = useFrameOutput({
    targetResolution: { width: 1920, height: 1440 },
    pixelFormat: 'rgb',
    allowDeferredStart: true,
    dropFramesWhileBusy: true,
    onFrame: (frame: any) => {
      'worklet';
      try {
        const result = scanText(frame);
        if (result.resultText) scheduleOnRN(handleText, result.resultText);
      } finally {
        frame.dispose();
      }
    },
  });

  const cameraReady = useCallback(() => {
    setReady(true);
    setStatus('Looking for name + card number…');
    requestAnimationFrame(() => {
      camera.current?.focusTo({ x: W / 2, y: Dimensions.get('window').height / 2 }, { responsiveness: 'snappy', adaptiveness: 'continuous' }).catch(() => undefined);
    });
  }, []);

  const manualCapture = async () => {
    if (locked.current || !ready) return;
    locked.current = true;
    setStatus('Capturing photo…');
    void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const { filePath } = await photoOutput.capturePhotoToFile({ flashMode: 'off', enableShutterSound: true }, {});
      setActive(false);
      await onPhoto(filePath);
    } catch (e) {
      locked.current = false;
      setActive(true);
      const message = e instanceof Error ? e.message : 'Could not capture photo';
      setStatus(message);
      Alert.alert('Could not capture card', message);
    }
  };

  if (!device) return <View style={[s.cameraPage,s.center]}><ActivityIndicator color={C.cyan}/><Text style={s.cameraHelp}>Finding back camera…</Text></View>;
  return <View style={s.cameraPage}><Camera ref={camera} style={StyleSheet.absoluteFill} device={device} isActive={active} outputs={[frameOutput, photoOutput]} zoom={device.neutralZoom} resizeMode="cover" onStarted={cameraReady} onPreviewStarted={cameraReady} onError={(cameraError: any) => { setReady(false); setStatus(cameraError.message); }} />
    <LinearGradient pointerEvents="none" colors={['rgba(3,8,16,.78)', 'transparent', 'transparent', 'rgba(3,8,16,.9)']} locations={[0,.25,.7,1]} style={StyleSheet.absoluteFill} />
    <SafeAreaView style={s.cameraSafe}><AppHeader title="Scan your card" onClose={onClose}/>
      <View style={s.frameWrap}><View style={s.frame}><Corner pos="tl" /><Corner pos="tr" /><Corner pos="bl" /><Corner pos="br" /><ScannerBeam /></View><View style={s.hold}><MaterialCommunityIcons name="cards-outline" size={18} color={C.cyan} /><Text style={s.holdText}>FIT FULL CARD · KEEP 12–18 IN AWAY</Text></View></View>
      <View><Text style={s.cameraHelp}>{error ? 'Scanner unavailable' : ready ? status : 'Starting camera…'}</Text>{!!error && <Text style={s.cameraError}>{error}</Text>}<View style={s.shutterRow}><View style={{width:48}} /><Pressable disabled={!ready || locked.current} hitSlop={14} onPress={manualCapture} style={({pressed}) => [s.shutterOuter, (!ready || locked.current) && {opacity:.45}, pressed && {transform:[{scale:.94}]}]}><View style={s.shutterInner} /></Pressable><View style={s.autoBadge}><MaterialCommunityIcons name="line-scan" size={16} color={C.cyan}/><Text style={s.autoBadgeText}>LIVE</Text></View></View></View>
    </SafeAreaView>
  </View>;
}
function Corner({ pos }: {pos:string}) { return <View style={[s.corner, pos.includes('t')?{top:-2}:{bottom:-2},pos.includes('l')?{left:-2}:{right:-2},pos==='tl'&&{borderTopWidth:4,borderLeftWidth:4},pos==='tr'&&{borderTopWidth:4,borderRightWidth:4},pos==='bl'&&{borderBottomWidth:4,borderLeftWidth:4},pos==='br'&&{borderBottomWidth:4,borderRightWidth:4}]} />; }

function Analyzing() { return <View style={s.page}><LinearGradient colors={[C.ink,'#251044','#11102D']} style={StyleSheet.absoluteFill}/><SafeAreaView style={s.safe}><AppHeader/><View style={s.centerContent}><View style={s.analyzeIcon}><MaterialCommunityIcons name="line-scan" size={56} color={C.cyan} /></View><ActivityIndicator color={C.cyan} size="large" style={{marginTop:28}}/><Text style={s.analyzeTitle}>Retrieving card details…</Text><Text style={s.analyzeSub}>Scoring its number, set, name, and printed details</Text></View></SafeAreaView></View>; }


function Matches({ query, cards, onBack, onCollection, onSelect, onSearch, onScan }: {query:string;cards:Card[];onBack:()=>void;onCollection:()=>void;onSelect:(c:Card)=>void;onSearch:(q:string)=>void;onScan:()=>void}) {
  return <View style={s.page}><SafeAreaView style={s.safe}><AppHeader title="Choose your match" onBack={onBack}/>
    <ScrollView contentContainerStyle={s.resultsScroll} showsVerticalScrollIndicator={false}><View style={s.detected}><View style={s.detectedIcon}><Feather name="check" size={18} color={C.green}/></View><View style={{flex:1}}><Text style={s.detectedLabel}>MATCHES READY</Text><Text style={s.detectedText}>Select the exact card printing</Text></View></View>
      <Text style={s.found}><Text style={{color:C.white}}>{cards.length} possible matches</Text> · Select the exact card</Text>
      {cards.map((card,i)=><Match key={card.id} card={card} best={i===0} onPress={()=>onSelect(card)}/>)}
      {!cards.length && <View style={s.empty}><MaterialCommunityIcons name="cards-outline" size={42} color={C.muted}/><Text style={s.emptyTitle}>No matches yet</Text><Text style={s.emptySub}>Try a clearer scan or search by card name.</Text></View>}
    </ScrollView><BottomNav active="other" onHome={onBack} onCollection={onCollection} onScan={onScan}/></SafeAreaView></View>;
}
function Match({card,best,onPress}:{card:Card;best:boolean;onPress:()=>void}) { const p=card.prices[0]; return <Pressable onPress={onPress} style={({pressed})=>[s.match, best&&s.bestMatch,pressed&&{opacity:.8}]}>{best&&<View style={s.bestTag}><Ionicons name="sparkles" size={12} color={C.ink}/><Text style={s.bestText}>BEST MATCH</Text></View>}<Image source={cardImageSource(card)} style={s.matchImg} contentFit="contain" transition={250}/><View style={s.matchInfo}><Text style={s.matchName} numberOfLines={1}>{card.name}</Text><Text style={s.matchSet} numberOfLines={1}>{card.setName} · {card.setCode} {card.number}</Text><View style={s.pills}><Text style={s.pill}>{card.number}</Text><Text style={s.pill}>{card.rarity}</Text></View><View style={s.matchBottom}><View><Text style={s.marketLabel}>MARKET VALUE</Text><Text style={s.matchPrice}>{money(p?.market)}</Text></View><View style={s.confidence}><Text style={s.confText}>{Math.round((card.confidence??.7)*100)}% match</Text></View></View></View><Feather name="chevron-right" size={21} color={C.muted}/></Pressable>; }

function SavedCardFields({quantity,setQuantity,condition,setCondition,variant,setVariant,notes,setNotes,message,onInputFocus}:{quantity:number;setQuantity:(value:number)=>void;condition:string;setCondition:(value:string)=>void;variant:string;setVariant:(value:string)=>void;notes:string;setNotes:(value:string)=>void;message:string;onInputFocus:(target:any)=>void}) {
  const {options:conditionOptions,isLoading:conditionsLoading}=useConditions();const {options:variantOptions,isLoading:variantsLoading}=useVariants();
  // Add, disable, or reorder variants in Supabase; the first four active rows are shown as primary options.
  const primaryVariants=variantOptions.slice(0,4),secondaryVariants=variantOptions.slice(4),selectedIsSecondary=secondaryVariants.some(option=>option.code===variant);const [showMore,setShowMore]=useState(false);useEffect(()=>{if(selectedIsSecondary)setShowMore(true);},[selectedIsSecondary]);
  useEffect(()=>{if(!condition&&conditionOptions[0])setCondition(conditionOptions[0].code);},[condition,conditionOptions,setCondition]);
  useEffect(()=>{if(!variant&&variantOptions[0])setVariant(variantOptions[0].code);},[variant,variantOptions,setVariant]);
  return <View style={s.savedControls}>
    <View style={s.savedControlsTitle}><View><Text style={s.smallHead}>IN YOUR COLLECTION</Text><Text style={s.savedHeading}>Collection details</Text></View><Feather name="check-circle" size={22} color={C.green}/></View>
    <Text style={s.compactEditLabel}>QUANTITY</Text><View style={s.quantityControl}><Pressable onPress={()=>setQuantity(Math.max(1,quantity-1))} style={s.quantityButton}><Feather name="minus" size={20} color={C.white}/></Pressable><Text style={s.quantityValue}>{quantity}</Text><Pressable onPress={()=>setQuantity(Math.min(999,quantity+1))} style={s.quantityButton}><Feather name="plus" size={20} color={C.white}/></Pressable></View>
    <Text style={s.compactEditLabel}>CONDITION</Text><View style={s.editChipWrap}>{conditionOptions.map(option=><CollectionChip key={option.id} label={option.code} active={condition===option.code} onPress={()=>setCondition(option.code)}/>)}{conditionsLoading&&<ActivityIndicator size="small" color={C.cyan}/>}</View>{!conditionsLoading&&!conditionOptions.length&&<Text style={s.optionEmpty}>Condition options unavailable offline.</Text>}
    <View style={s.variantLabelRow}><Text style={s.compactEditLabel}>VARIANT</Text>{!!secondaryVariants.length&&<Pressable onPress={()=>setShowMore(value=>!value)} hitSlop={8} style={[s.moreVariants,selectedIsSecondary&&s.moreVariantsSelected]}><Text style={s.moreVariantsText}>{showMore?'Less':selectedIsSecondary?'More · Selected':'More'}</Text><Feather name={showMore?'chevron-up':'chevron-down'} size={13} color={C.cyan}/></Pressable>}</View>
    <View style={s.editChipWrap}>{primaryVariants.map(option=><CollectionChip key={option.id} label={option.label} active={variant===option.code} onPress={()=>setVariant(option.code)}/>)}{variantsLoading&&<ActivityIndicator size="small" color={C.cyan}/>}</View>
    {showMore&&<View style={[s.editChipWrap,s.secondaryVariants]}>{secondaryVariants.map(option=><CollectionChip key={option.id} label={option.label} active={variant===option.code} onPress={()=>setVariant(option.code)}/>)}</View>}{!variantsLoading&&!variantOptions.length&&<Text style={s.optionEmpty}>Variant options unavailable offline.</Text>}
    <Text style={s.compactEditLabel}>NOTES</Text><TextInput value={notes} onChangeText={setNotes} onFocus={event=>onInputFocus(event.target)} multiline scrollEnabled maxLength={500} placeholder="Add notes, purchase info, etc." placeholderTextColor="#71839C" selectionColor={C.cyan} textAlignVertical="top" style={s.collectionNotesInput}/>{!!message&&<Text style={s.savedMessage}>{message}</Text>}
  </View>;
}

function Detail({card,savedRow,onBack,onHome,onCollection,onSave,onUpdateSaved,onDeleteSaved,onScan,initiallySaved=false}:{card:Card;savedRow:ScannedCardRow|null;onBack:()=>void;onHome:()=>void;onCollection:()=>void;onSave:(card:Card)=>Promise<ScannedCardRow>;onUpdateSaved:(updates:Pick<ScannedCardRow,'quantity'|'condition'|'variant'|'notes'>)=>Promise<void>;onDeleteSaved:()=>Promise<void>;onScan:()=>void;initiallySaved?:boolean}) { const detailScrollRef=useRef<ScrollView>(null);const p=card.prices[0]; const [saving,setSaving]=useState(false); const [saved,setSaved]=useState(initiallySaved); const [managedRow,setManagedRow]=useState(savedRow); const [saveError,setSaveError]=useState('');const [editQuantity,setEditQuantity]=useState(Math.max(1,Number(savedRow?.quantity)||1));const [editCondition,setEditCondition]=useState(savedRow?.condition||'');const [editVariant,setEditVariant]=useState(savedRow?.variant||'');const [editNotes,setEditNotes]=useState(savedRow?.notes||'');const [editMessage,setEditMessage]=useState('');const [keyboardVisible,setKeyboardVisible]=useState(false);useEffect(()=>{setManagedRow(savedRow);if(savedRow){setEditQuantity(Math.max(1,Number(savedRow.quantity)||1));setEditCondition(savedRow.condition||'');setEditVariant(savedRow.variant||'');setEditNotes(savedRow.notes||'');}},[savedRow]);useEffect(()=>{const show=Keyboard.addListener(Platform.OS==='ios'?'keyboardWillShow':'keyboardDidShow',()=>setKeyboardVisible(true));const hide=Keyboard.addListener(Platform.OS==='ios'?'keyboardWillHide':'keyboardDidHide',()=>setKeyboardVisible(false));return()=>{show.remove();hide.remove();};},[]); const save=async()=>{if(saving||saved)return;setSaving(true);setSaveError('');try{const row=await onSave(card);setManagedRow(row);setSaved(true);void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);}catch(e){setSaveError(e instanceof Error?e.message:'Could not save card.');}finally{setSaving(false);}};const saveDetails=async()=>{setSaving(true);setEditMessage('');try{const updates={quantity:editQuantity,condition:editCondition,variant:editVariant,notes:editNotes.trim()||null};await onUpdateSaved(updates);setManagedRow(current=>current?{...current,...updates}:current);setEditMessage('Collection details saved.');void Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);}catch(e){setEditMessage(e instanceof Error?e.message:'Could not update card.');}finally{setSaving(false);}};const removeSaved=()=>managedRow&&Alert.alert('Delete saved card?',`${managedRow.card_name} will be removed from your collection.`,[{text:'Cancel',style:'cancel'},{text:'Delete',style:'destructive',onPress:async()=>{setSaving(true);try{await onDeleteSaved();}catch(e){setEditMessage(e instanceof Error?e.message:'Could not delete card.');setSaving(false);}}}]); return <View style={s.page}><SafeAreaView style={s.safe}><AppHeader title="Card details" onBack={onBack}/><KeyboardAvoidingView style={s.safe} behavior={Platform.OS==='ios'?'padding':'height'} keyboardVerticalOffset={0}><KeyboardAwareScrollView ref={detailScrollRef} style={s.safe} automaticallyAdjustKeyboardInsets={false} contentInsetAdjustmentBehavior="never" showsVerticalScrollIndicator={false}><LinearGradient colors={['#4C1D95',C.ink]} style={[s.detailHero,{width:'100%',alignSelf:'stretch'}]}><View style={{width:'100%',alignSelf:'stretch'}}><View style={s.cardGlow}/><Image source={cardImageSource(card)} style={s.heroCard} contentFit="contain" transition={300}/></View></LinearGradient>
    <View style={s.detailBody}><Text style={s.matchedIdentifier}>MATCHED: {card.name} ({card.setCode} {card.number})</Text><View style={s.detailHeading}><View style={{flex:1}}><Text style={s.detailName}>{card.name}</Text><Text style={s.detailSet}>{card.setName} · {card.setCode} {card.number}</Text></View><View style={s.typeBadge}><Feather name="zap" size={14} color={C.ink}/><Text style={s.typeText}>{card.type}</Text></View></View>
      <View style={s.priceCard}><View><Text style={s.valueLabel}>CURRENT MARKET VALUE</Text><Text style={s.bigPrice}>{money(p?.market)}</Text><Text style={s.updated}>Updated from {p?.source ?? 'PokéWallet'}</Text></View><View style={s.priceActions}><View style={s.gain}><Feather name="trending-up" size={15} color={C.green}/><Text style={s.gainText}>Live</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Sell this card" style={({pressed})=>[s.sellButton,pressed&&{opacity:.75}]}><Feather name="tag" size={14} color={C.ink}/><Text style={s.sellButtonText}>Sell</Text></Pressable></View></View>
      <View style={s.range}><Range label="Low" value={money(p?.low)}/><View style={s.rangeLine}/><Range label="Market" value={money(p?.market)} active/><View style={s.rangeLine}/><Range label="High" value={money(p?.high)}/></View>
      <Text style={s.sectionTitle}>CARD INFORMATION</Text><View style={s.infoGrid}><Info label="RARITY" value={card.rarity}/><Info label="CARD NO." value={card.number}/><Info label="STAGE" value={card.stage||'—'}/><Info label="HP" value={card.hp||'—'}/>{!!card.evolvesFrom&&<Info label="EVOLVES FROM" value={card.evolvesFrom}/>}{!!card.regulationMark&&<Info label="REGULATION" value={card.regulationMark}/>}{!!card.illustrator&&<Info label="ILLUSTRATOR" value={card.illustrator}/>}{!!card.retreatCost&&<Info label="RETREAT COST" value={card.retreatCost}/>}</View>
      {(card.attacks?.length||card.abilities?.length||card.text||card.weakness||card.resistance)&&<><Text style={s.sectionTitle}>CARD DETAILS</Text><View style={s.detailsBox}>{card.abilities?.map(a=><View key={`ability-${a}`} style={s.ability}><View style={s.abilityBadge}><Text style={s.abilityBadgeText}>ABILITY</Text></View><Text style={s.abilityText}>{a}</Text></View>)}{card.attacks?.map(a=><View key={a} style={s.attack}><View style={s.energyDot}/><Text style={s.attackText}>{a}</Text></View>)}{!!card.text&&<Text style={s.cardText}>{card.text}</Text>}<View style={s.combatRow}>{!!card.weakness&&<Text style={s.weakness}>Weakness  ·  {card.weakness}</Text>}{!!card.resistance&&<Text style={s.weakness}>Resistance  ·  {card.resistance}</Text>}</View></View></>}
      {!!saveError&&<Text style={s.saveError}>{saveError}</Text>}{managedRow?<SavedCardFields quantity={editQuantity} setQuantity={setEditQuantity} condition={editCondition} setCondition={setEditCondition} variant={editVariant} setVariant={setEditVariant} notes={editNotes} setNotes={setEditNotes} message={editMessage} onInputFocus={target=>revealFocusedInput(detailScrollRef,target,104)}/>:<Pressable onPress={save} disabled={saving} style={({pressed})=>[s.collection,(pressed||saving)&&{opacity:.72}]}>{saving?<ActivityIndicator color={C.ink}/>:<><Feather name="plus" size={20} color={C.ink}/><Text style={s.collectionText}>Add to collection</Text></>}</Pressable>}<Text style={s.disclaimer}>Prices are estimates and vary by condition, language, and market.</Text>
    </View></KeyboardAwareScrollView>{managedRow&&<View style={[s.detailActionBar,!keyboardVisible&&s.detailActionBarWithNav]}><Pressable onPress={removeSaved} disabled={saving} style={s.detailDeleteAction}><Feather name="trash-2" size={18} color="#FF98A2"/><Text style={s.deleteButtonText}>Delete</Text></Pressable><Pressable onPress={saveDetails} disabled={saving} style={s.detailSaveAction}>{saving?<ActivityIndicator color={C.ink}/>:<Text style={s.saveEditText}>SAVE DETAILS</Text>}</Pressable></View>}</KeyboardAvoidingView><BottomNav active="other" onHome={onHome} onCollection={onCollection} onScan={onScan}/></SafeAreaView></View>; }
function Range({label,value,active}:{label:string;value:string;active?:boolean}) { return <View style={s.rangeItem}><Text style={s.rangeLabel}>{label}</Text><Text style={[s.rangeValue,active&&{color:C.yellow}]}>{value}</Text></View>; }
function Info({label,value}:{label:string;value:string}) { return <View style={s.info}><Text style={s.infoLabel}>{label}</Text><Text style={s.infoValue} numberOfLines={1}>{value}</Text></View>; }

const W=Dimensions.get('window').width;
const DETAIL_CARD_WIDTH=Math.min(W-48,330);
const DETAIL_CARD_HEIGHT=DETAIL_CARD_WIDTH*1.4;
const SCAN_WIDTH=Math.min(W-152,286);
const s=StyleSheet.create({
  page:{flex:1,backgroundColor:C.ink},safe:{flex:1},center:{alignItems:'center',justifyContent:'center',padding:32},centerContent:{flex:1,alignItems:'center',justifyContent:'center',padding:32},standaloneHeader:{height:64,paddingHorizontal:22,justifyContent:'center',borderBottomWidth:1,borderColor:C.line},headerIdentity:{flex:1,alignItems:'center',justifyContent:'center'},headerPageTitle:{fontFamily:'Inter_600SemiBold',fontSize:10,color:C.muted,marginTop:1},top:{height:70,paddingHorizontal:22,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},brand:{flexDirection:'row',alignItems:'center',gap:9},brandLogo:{width:32,height:32,borderRadius:9},brandMark:{width:28,height:28,borderRadius:14,backgroundColor:C.red,borderWidth:3,borderColor:C.white,alignItems:'center',justifyContent:'center',overflow:'hidden'},brandDot:{width:8,height:8,borderRadius:4,backgroundColor:C.white,borderWidth:2,borderColor:C.ink},brandText:{fontFamily:'Inter_800ExtraBold',fontSize:21,color:C.white,letterSpacing:-.8},avatar:{width:38,height:38,borderRadius:19,backgroundColor:C.panel2,alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:C.line},
  homeScroll:{padding:22,paddingBottom:40},heroCopy:{marginTop:22,marginBottom:30},eyebrow:{flexDirection:'row',alignItems:'center',gap:8,marginBottom:15},liveDot:{width:7,height:7,borderRadius:4,backgroundColor:C.green},eyebrowText:{fontFamily:'Inter_700Bold',fontSize:10,color:C.green,letterSpacing:1.5},heroTitle:{fontFamily:'Inter_800ExtraBold',fontSize:42,lineHeight:47,color:C.white,letterSpacing:-1.8},heroAccent:{color:C.yellow},heroSub:{fontFamily:'Inter_400Regular',fontSize:16,lineHeight:24,color:C.muted,marginTop:15,maxWidth:340},scanCard:{borderRadius:24,overflow:'hidden',...shadow},scanGradient:{minHeight:154,padding:22,flexDirection:'row',alignItems:'center',gap:16,overflow:'hidden'},orbOne:{position:'absolute',width:170,height:170,borderRadius:85,backgroundColor:'rgba(68,215,255,.12)',right:-35,top:-85},orbTwo:{position:'absolute',width:90,height:90,borderRadius:45,borderWidth:18,borderColor:'rgba(255,255,255,.06)',left:140,bottom:-55},scanIcon:{width:66,height:66,borderRadius:22,backgroundColor:C.yellow,alignItems:'center',justifyContent:'center'},scanTitle:{fontFamily:'Inter_700Bold',fontSize:22,color:C.white},scanSub:{fontFamily:'Inter_400Regular',fontSize:12,color:'#BBD3FF',marginTop:5},circleArrow:{width:42,height:42,borderRadius:21,borderWidth:1,borderColor:'rgba(255,255,255,.25)',alignItems:'center',justifyContent:'center'},divider:{flexDirection:'row',alignItems:'center',gap:12,marginVertical:24},divLine:{height:1,backgroundColor:C.line,flex:1},or:{fontFamily:'Inter_600SemiBold',fontSize:9,color:C.muted,letterSpacing:1.1},searchBox:{height:58,borderRadius:17,borderWidth:1,borderColor:C.line,backgroundColor:C.panel,flexDirection:'row',alignItems:'center',paddingLeft:17},input:{flex:1,height:'100%',color:'#F8FAFC',backgroundColor:'transparent',fontFamily:'Inter_600SemiBold',fontSize:15,lineHeight:20,paddingHorizontal:12,paddingVertical:0,opacity:1},searchGo:{width:40,height:40,borderRadius:12,backgroundColor:C.yellow,alignItems:'center',justifyContent:'center',marginRight:8},error:{color:C.red,fontFamily:'Inter_500Medium',fontSize:12,marginTop:10},stats:{flexDirection:'row',alignItems:'center',justifyContent:'space-around',marginTop:30},stat:{alignItems:'center',gap:4,flex:1},statValue:{fontFamily:'Inter_700Bold',fontSize:15,color:C.white},statLabel:{fontFamily:'Inter_400Regular',fontSize:9,color:C.muted},statLine:{width:1,height:38,backgroundColor:C.line},tip:{marginTop:28,padding:15,backgroundColor:'#111F31',borderRadius:16,flexDirection:'row',alignItems:'center',gap:12,borderWidth:1,borderColor:C.line},bulb:{width:34,height:34,borderRadius:11,backgroundColor:'rgba(255,213,61,.1)',alignItems:'center',justifyContent:'center'},tipText:{flex:1,fontFamily:'Inter_400Regular',fontSize:11.5,lineHeight:18,color:C.muted},
  authScroll:{flexGrow:1,padding:24,paddingBottom:48},authMark:{width:82,height:82,borderRadius:28,backgroundColor:C.panel,borderWidth:1,borderColor:C.line,alignItems:'center',justifyContent:'center',alignSelf:'center',marginTop:42},authTitle:{fontFamily:'Inter_800ExtraBold',fontSize:27,color:C.white,marginTop:22,textAlign:'center'},authCopy:{fontFamily:'Inter_400Regular',fontSize:13,color:C.muted,lineHeight:20,textAlign:'center',marginTop:10,maxWidth:330,alignSelf:'center'},authForm:{marginTop:30},authLabel:{fontFamily:'Inter_700Bold',fontSize:9,color:C.muted,letterSpacing:1.2,marginBottom:8,marginTop:14},authInputWrap:{height:58,borderRadius:16,borderWidth:1,borderColor:C.line,backgroundColor:C.panel,flexDirection:'row',alignItems:'center',gap:11,paddingHorizontal:15},authInput:{flex:1,height:'100%',fontFamily:'Inter_600SemiBold',fontSize:14,color:C.white,paddingVertical:0},forgot:{alignSelf:'flex-end',paddingVertical:12},forgotText:{fontFamily:'Inter_600SemiBold',fontSize:11,color:C.cyan},authNoticeError:{flexDirection:'row',alignItems:'flex-start',gap:8,backgroundColor:'rgba(244,63,80,.1)',borderWidth:1,borderColor:'rgba(244,63,80,.25)',padding:11,borderRadius:12,marginTop:10},authErrorText:{flex:1,fontFamily:'Inter_500Medium',fontSize:11,color:'#FFB0B8',lineHeight:16},authNoticeSuccess:{flexDirection:'row',alignItems:'flex-start',gap:8,backgroundColor:'rgba(69,212,131,.1)',borderWidth:1,borderColor:'rgba(69,212,131,.25)',padding:11,borderRadius:12,marginTop:10},authSuccessText:{flex:1,fontFamily:'Inter_500Medium',fontSize:11,color:C.green,lineHeight:16},authSubmit:{height:58,borderRadius:16,backgroundColor:C.yellow,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:9,marginTop:18},authSubmitText:{fontFamily:'Inter_800ExtraBold',fontSize:12,color:C.ink,letterSpacing:.8},authSwitch:{flexDirection:'row',alignItems:'center',justifyContent:'center',gap:6,marginTop:22},authSwitchCopy:{fontFamily:'Inter_400Regular',fontSize:12,color:C.muted},authSwitchAction:{fontFamily:'Inter_700Bold',fontSize:12,color:C.cyan},topActions:{flexDirection:'row',alignItems:'center',gap:8},headerAction:{width:38,height:38,borderRadius:12,backgroundColor:C.panel2,borderWidth:1,borderColor:C.line,alignItems:'center',justifyContent:'center'},topScan:{width:40,height:40,borderRadius:13,backgroundColor:C.yellow,alignItems:'center',justifyContent:'center'},logout:{flexDirection:'row',alignItems:'center',gap:7,backgroundColor:C.panel2,borderWidth:1,borderColor:C.line,borderRadius:12,paddingHorizontal:10,paddingVertical:9},logoutText:{fontFamily:'Inter_600SemiBold',fontSize:11,color:C.white},dashboardScroll:{padding:20,paddingBottom:190},dashboardHello:{marginTop:10,marginBottom:20},dashboardEyebrow:{fontFamily:'Inter_700Bold',fontSize:9,color:C.green,letterSpacing:1.5},dashboardTitle:{fontFamily:'Inter_800ExtraBold',fontSize:32,color:C.white,letterSpacing:-1,marginTop:5},dashboardEmail:{fontFamily:'Inter_400Regular',fontSize:12,color:C.muted,marginTop:3},premiumCard:{marginBottom:14,borderRadius:18,borderWidth:1,borderColor:'rgba(255,213,61,.25)',backgroundColor:'#151B2B',padding:14},premiumCardActive:{borderColor:'rgba(69,212,131,.35)'},premiumCardTop:{flexDirection:'row',alignItems:'center',gap:10},premiumIcon:{width:38,height:38,borderRadius:12,backgroundColor:'rgba(255,213,61,.1)',alignItems:'center',justifyContent:'center'},premiumTitle:{fontFamily:'Inter_700Bold',fontSize:13,color:C.white},premiumCopy:{fontFamily:'Inter_400Regular',fontSize:9,color:C.muted,lineHeight:14,marginTop:3},premiumPrice:{fontFamily:'Inter_800ExtraBold',fontSize:12,color:C.yellow},premiumBuy:{height:46,borderRadius:13,backgroundColor:C.yellow,alignItems:'center',justifyContent:'center',marginTop:12},premiumBuyText:{fontFamily:'Inter_800ExtraBold',fontSize:10,color:C.ink,letterSpacing:.7},restoreButton:{minHeight:38,alignItems:'center',justifyContent:'center',marginTop:4},restoreText:{fontFamily:'Inter_600SemiBold',fontSize:10,color:C.cyan},premiumError:{fontFamily:'Inter_500Medium',fontSize:9,color:'#FF9EA8',textAlign:'center',lineHeight:14},premiumMessage:{fontFamily:'Inter_500Medium',fontSize:9,color:C.green,textAlign:'center',lineHeight:14},metricRow:{flexDirection:'row',gap:10},metricCard:{flex:1,minHeight:126,backgroundColor:C.panel,borderWidth:1,borderColor:C.line,borderRadius:18,padding:15},metricLabel:{fontFamily:'Inter_700Bold',fontSize:8,color:C.muted,letterSpacing:1},metricValue:{fontFamily:'Inter_800ExtraBold',fontSize:27,color:C.white,letterSpacing:-.7,marginTop:8},metricTrend:{flexDirection:'row',alignItems:'center',gap:5,marginTop:9},metricTrendText:{fontFamily:'Inter_500Medium',fontSize:9,color:C.green},metricHint:{fontFamily:'Inter_400Regular',fontSize:9,color:C.muted,marginTop:10},heroScan:{borderRadius:20,overflow:'hidden',marginTop:14,...shadow},heroScanGradient:{minHeight:104,padding:17,flexDirection:'row',alignItems:'center',gap:13},heroScanIcon:{width:54,height:54,borderRadius:17,backgroundColor:C.yellow,alignItems:'center',justifyContent:'center'},heroScanTitle:{fontFamily:'Inter_800ExtraBold',fontSize:17,color:C.white,letterSpacing:.5},heroScanSub:{fontFamily:'Inter_400Regular',fontSize:10,color:'#C7D6F3',marginTop:4},sectionRow:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',marginTop:28,marginBottom:12},dashboardSection:{fontFamily:'Inter_700Bold',fontSize:10,color:C.white,letterSpacing:1.2},seeAll:{fontFamily:'Inter_600SemiBold',fontSize:10,color:C.cyan},recentCard:{height:82,backgroundColor:C.panel,borderWidth:1,borderColor:C.line,borderRadius:16,padding:9,marginBottom:9,flexDirection:'row',alignItems:'center',gap:11},recentImage:{width:44,height:62,borderRadius:6,backgroundColor:C.panel2},recentPlaceholder:{alignItems:'center',justifyContent:'center'},recentInfo:{flex:1},recentName:{fontFamily:'Inter_700Bold',fontSize:14,color:C.white},recentSet:{fontFamily:'Inter_400Regular',fontSize:9.5,color:C.muted,marginTop:4},recentPrice:{fontFamily:'Inter_700Bold',fontSize:15,color:C.yellow},recentEmpty:{backgroundColor:C.panel,borderWidth:1,borderColor:C.line,borderRadius:17,alignItems:'center',padding:25},bottomNav:{position:'absolute',left:14,right:14,bottom:8,height:68,backgroundColor:'#0C1727',borderWidth:1,borderColor:C.line,borderRadius:22,flexDirection:'row',alignItems:'center',justifyContent:'space-around',paddingHorizontal:22,...shadow},navItem:{alignItems:'center',gap:4,width:72},navText:{fontFamily:'Inter_600SemiBold',fontSize:8,color:C.muted},navScan:{width:54,height:54,borderRadius:18,backgroundColor:C.yellow,alignItems:'center',justifyContent:'center',marginTop:-25,borderWidth:4,borderColor:C.ink},
  collectionTop:{paddingHorizontal:18,paddingVertical:12,flexDirection:'row',alignItems:'center',gap:14,borderBottomWidth:1,borderColor:C.line},collectionList:{paddingHorizontal:16,paddingBottom:120},collectionScroll:{padding:20,paddingBottom:120},collectionSummary:{backgroundColor:C.panel,borderWidth:1,borderColor:C.line,borderRadius:20,padding:18,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},collectionTotal:{fontFamily:'Inter_800ExtraBold',fontSize:31,color:C.white,marginTop:5},collectionCount:{alignItems:'center',backgroundColor:C.panel2,borderRadius:14,paddingHorizontal:17,paddingVertical:11},collectionCountValue:{fontFamily:'Inter_800ExtraBold',fontSize:22,color:C.yellow},collectionHeading:{flexDirection:'row',justifyContent:'space-between',alignItems:'center',marginTop:25,marginBottom:12},collectionLimit:{fontFamily:'Inter_500Medium',fontSize:10,color:C.muted},collectionRow:{minHeight:126,backgroundColor:C.panel,borderWidth:1,borderColor:C.line,borderRadius:18,padding:11,flexDirection:'row',alignItems:'center',gap:12},collectionImage:{width:72,height:101,borderRadius:8,backgroundColor:C.panel2},collectionCardInfo:{flex:1,minWidth:0},collectionName:{flexShrink:1,fontFamily:'Inter_700Bold',fontSize:15,color:C.white},collectionNumber:{fontFamily:'Inter_600SemiBold',fontSize:10.5,color:C.cyan,marginTop:5},collectionPriceWrap:{alignItems:'flex-end',gap:7,minWidth:65},collectionMarketPrice:{fontFamily:'Inter_800ExtraBold',fontSize:16,color:C.white},emptyScan:{backgroundColor:C.yellow,borderRadius:13,paddingHorizontal:20,paddingVertical:13,marginTop:18,flexDirection:'row',alignItems:'center',gap:8},emptyScanText:{fontFamily:'Inter_800ExtraBold',fontSize:10,color:C.ink,letterSpacing:.7},
  collectionSearch:{height:54,borderRadius:16,borderWidth:1,borderColor:C.line,backgroundColor:C.panel,flexDirection:'row',alignItems:'center',gap:10,paddingHorizontal:14,marginTop:16},collectionSearchInput:{flex:1,height:'100%',fontFamily:'Inter_600SemiBold',fontSize:13,color:C.white,paddingVertical:0},filterLabel:{fontFamily:'Inter_700Bold',fontSize:8,color:C.muted,letterSpacing:1.1,marginTop:17,marginBottom:8},filterRow:{gap:7,paddingRight:18},filterChip:{borderRadius:11,borderWidth:1,borderColor:C.line,backgroundColor:C.panel,paddingHorizontal:12,paddingVertical:9},filterChipActive:{borderColor:C.cyan,backgroundColor:'rgba(68,215,255,.12)'},filterChipText:{fontFamily:'Inter_600SemiBold',fontSize:9,color:C.muted},filterChipTextActive:{color:C.cyan},collectionNameLine:{flexDirection:'row',alignItems:'center',gap:6},quantityBadge:{fontFamily:'Inter_700Bold',fontSize:9,color:C.yellow,backgroundColor:'rgba(255,213,61,.1)',paddingHorizontal:6,paddingVertical:3,borderRadius:6,overflow:'hidden'},collectionMeta:{fontFamily:'Inter_500Medium',fontSize:8.5,color:'#A9B8CD',marginTop:5},editCard:{width:30,height:28,borderRadius:9,backgroundColor:C.panel2,alignItems:'center',justifyContent:'center'},loadMore:{height:48,borderRadius:14,backgroundColor:C.yellow,alignItems:'center',justifyContent:'center',marginTop:8,marginBottom:90},loadMoreText:{fontFamily:'Inter_800ExtraBold',fontSize:10,color:C.ink,letterSpacing:.8},modalShade:{flex:1,backgroundColor:'rgba(0,0,0,.7)',justifyContent:'flex-end'},editSheet:{backgroundColor:'#101C2D',borderTopLeftRadius:28,borderTopRightRadius:28,borderWidth:1,borderColor:C.line,padding:22,paddingBottom:30,maxHeight:'94%'},sheetHandle:{width:42,height:4,borderRadius:2,backgroundColor:'#52647C',alignSelf:'center',marginBottom:18},editHeader:{flexDirection:'row',alignItems:'center',gap:12},editTitle:{fontFamily:'Inter_800ExtraBold',fontSize:22,color:C.white,marginTop:4},modalClose:{width:40,height:40,borderRadius:13,backgroundColor:C.panel2,alignItems:'center',justifyContent:'center'},editLabel:{fontFamily:'Inter_700Bold',fontSize:8,color:C.muted,letterSpacing:1.1,marginTop:18,marginBottom:9},quantityControl:{height:48,flexDirection:'row',alignItems:'center',alignSelf:'flex-start',backgroundColor:C.panel,borderRadius:13,borderWidth:1,borderColor:C.line,overflow:'hidden'},quantityButton:{width:48,height:48,alignItems:'center',justifyContent:'center'},quantityValue:{width:58,textAlign:'center',fontFamily:'Inter_800ExtraBold',fontSize:19,color:C.yellow},editChipWrap:{flexDirection:'row',flexWrap:'wrap',gap:7},notesInput:{minHeight:70,maxHeight:105,borderRadius:13,borderWidth:1,borderColor:C.line,backgroundColor:C.panel,color:C.white,fontFamily:'Inter_500Medium',fontSize:12,lineHeight:18,padding:12,textAlignVertical:'top'},editActions:{flexDirection:'row',gap:10,marginTop:20},deleteButton:{height:52,borderRadius:14,borderWidth:1,borderColor:'rgba(244,63,80,.35)',backgroundColor:'rgba(244,63,80,.08)',paddingHorizontal:17,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:7},deleteButtonText:{fontFamily:'Inter_700Bold',fontSize:11,color:'#FF98A2'},saveEditButton:{height:52,borderRadius:14,backgroundColor:C.yellow,flex:1,alignItems:'center',justifyContent:'center'},saveEditText:{fontFamily:'Inter_800ExtraBold',fontSize:10,color:C.ink,letterSpacing:.8},
  portfolioHero:{marginTop:16,borderRadius:22,borderWidth:1,borderColor:'rgba(68,215,255,.2)',backgroundColor:'#101D30',padding:18,overflow:'hidden'},portfolioTopLine:{flexDirection:'row',alignItems:'flex-start',justifyContent:'space-between'},portfolioLabel:{fontFamily:'Inter_700Bold',fontSize:8,color:C.muted,letterSpacing:1.2},portfolioAmount:{fontFamily:'Inter_800ExtraBold',fontSize:37,color:C.white,letterSpacing:-1.2,marginTop:4},portfolioDelta:{fontFamily:'Inter_600SemiBold',fontSize:10,marginTop:4},dayChange:{flexDirection:'row',alignItems:'center',gap:3,backgroundColor:'rgba(69,212,131,.1)',borderRadius:10,paddingHorizontal:8,paddingVertical:6},dayChangeText:{fontFamily:'Inter_700Bold',fontSize:10,color:C.green},dayChangePeriod:{fontFamily:'Inter_700Bold',fontSize:7,color:C.muted,marginLeft:2},sparkline:{position:'relative',marginTop:14,overflow:'hidden',borderRadius:10,backgroundColor:'rgba(4,11,21,.24)'},sparkSegment:{position:'absolute',height:2.5,borderRadius:2},chartGrid:{position:'absolute',left:0,right:0,height:1,backgroundColor:'rgba(148,163,184,.1)'},chartDot:{position:'absolute',width:6,height:6,borderRadius:3,backgroundColor:C.panel,borderWidth:2},chartCurrentHalo:{position:'absolute',width:14,height:14,borderRadius:7,borderWidth:2,opacity:.28},chartCurrentDot:{position:'absolute',width:7,height:7,borderRadius:4},chartLabels:{flexDirection:'row',justifyContent:'space-between',marginTop:6},chartTime:{fontFamily:'Inter_700Bold',fontSize:6.5,color:'#6F829B',letterSpacing:.8},chartValue:{fontFamily:'Inter_700Bold',fontSize:9,color:'#B9C7D9',marginTop:2},portfolioStats:{flexDirection:'row',alignItems:'center',marginTop:11,paddingTop:13,borderTopWidth:1,borderColor:C.line,gap:11},portfolioStat:{fontFamily:'Inter_500Medium',fontSize:10,color:C.muted},portfolioStatStrong:{fontFamily:'Inter_700Bold',color:C.white},statDot:{width:3,height:3,borderRadius:2,backgroundColor:'#506176'},rarityBadge:{alignSelf:'flex-start',backgroundColor:'#243247',borderRadius:7,paddingHorizontal:7,paddingVertical:4,marginTop:7,maxWidth:'100%'},rarityBadgeSpecial:{backgroundColor:'rgba(167,89,255,.16)',borderWidth:1,borderColor:'rgba(167,89,255,.3)'},rarityText:{fontFamily:'Inter_700Bold',fontSize:7.5,color:'#B9C7D9'},rarityTextSpecial:{color:'#C79BFF'},rowChange:{flexDirection:'row',alignItems:'center',backgroundColor:'rgba(69,212,131,.1)',borderRadius:7,paddingHorizontal:5,paddingVertical:3},rowChangeDown:{backgroundColor:'rgba(244,63,80,.1)'},rowChangeText:{fontFamily:'Inter_700Bold',fontSize:8,color:C.green},proPreview:{marginTop:18,borderRadius:15,borderWidth:1,borderColor:C.line,backgroundColor:'rgba(255,255,255,.025)',padding:12,flexDirection:'row',alignItems:'center',gap:10},proLock:{width:32,height:32,borderRadius:10,backgroundColor:'rgba(255,213,61,.1)',alignItems:'center',justifyContent:'center'},proPreviewTitle:{fontFamily:'Inter_700Bold',fontSize:11,color:C.white},proPreviewCopy:{fontFamily:'Inter_400Regular',fontSize:8.5,color:C.muted,marginTop:3},proPill:{fontFamily:'Inter_800ExtraBold',fontSize:7,color:C.yellow,letterSpacing:.8},collectionEmpty:{alignItems:'center',paddingHorizontal:28,paddingVertical:36},emptyOrb:{width:82,height:82,borderRadius:27,backgroundColor:'rgba(68,215,255,.08)',borderWidth:1,borderColor:'rgba(68,215,255,.18)',alignItems:'center',justifyContent:'center'},skeletonRow:{height:126,backgroundColor:C.panel,borderRadius:18,borderWidth:1,borderColor:C.line,padding:11,marginBottom:10,flexDirection:'row',alignItems:'center',gap:12},skeletonBlock:{backgroundColor:'#26354A',borderRadius:6,opacity:.65},skeletonImage:{width:72,height:101,borderRadius:8},
  tierBadge:{height:28,borderRadius:9,borderWidth:1,borderColor:'rgba(255,213,61,.3)',backgroundColor:'rgba(255,213,61,.1)',paddingHorizontal:9,flexDirection:'row',alignItems:'center',gap:5},tierBadgeText:{fontFamily:'Inter_800ExtraBold',fontSize:8,color:C.yellow,letterSpacing:1},swipeWrap:{position:'relative',overflow:'hidden',borderRadius:18,marginBottom:10},swipeDelete:{position:'absolute',top:0,right:0,bottom:0,width:104,backgroundColor:'#D93448',alignItems:'center',justifyContent:'center',gap:5},swipeDeleteText:{fontFamily:'Inter_700Bold',fontSize:10,color:C.white},swipeHint:{flexDirection:'row',alignItems:'center',gap:1,marginTop:1},swipeHintText:{fontFamily:'Inter_700Bold',fontSize:6.5,color:C.muted,letterSpacing:.5},savedControls:{marginTop:25,borderRadius:20,borderWidth:1,borderColor:'rgba(69,212,131,.25)',backgroundColor:C.panel,padding:17},savedControlsTitle:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},savedHeading:{fontFamily:'Inter_800ExtraBold',fontSize:20,color:C.white,marginTop:3},savedMessage:{fontFamily:'Inter_600SemiBold',fontSize:10,color:C.green,marginTop:12},
  compactEditLabel:{fontFamily:'Inter_700Bold',fontSize:8,color:C.muted,letterSpacing:1.1,marginTop:14,marginBottom:7},variantLabelRow:{flexDirection:'row',alignItems:'flex-end',justifyContent:'space-between'},moreVariants:{minHeight:32,flexDirection:'row',alignItems:'center',gap:3,paddingHorizontal:7,marginBottom:1,borderRadius:9},moreVariantsSelected:{backgroundColor:'rgba(68,215,255,.1)',borderWidth:1,borderColor:'rgba(68,215,255,.25)'},moreVariantsText:{fontFamily:'Inter_700Bold',fontSize:9,color:C.cyan},secondaryVariants:{marginTop:7},optionEmpty:{fontFamily:'Inter_500Medium',fontSize:9,color:C.muted,marginTop:6},collectionNotesInput:{height:112,borderRadius:13,borderWidth:1,borderColor:C.line,backgroundColor:C.panel,color:C.white,fontFamily:'Inter_500Medium',fontSize:12,lineHeight:18,paddingHorizontal:12,paddingTop:11,paddingBottom:11},
  detailActionBar:{flexDirection:'row',gap:10,backgroundColor:'#0B1321',borderTopWidth:1,borderColor:C.line,paddingHorizontal:16,paddingTop:10,paddingBottom:10},detailActionBarWithNav:{marginBottom:76},detailDeleteAction:{height:54,minWidth:104,borderRadius:15,borderWidth:1,borderColor:'rgba(244,63,80,.35)',backgroundColor:'rgba(244,63,80,.1)',flexDirection:'row',alignItems:'center',justifyContent:'center',gap:7},detailSaveAction:{height:54,flex:1,borderRadius:15,backgroundColor:'#A855F7',alignItems:'center',justifyContent:'center'},
  cameraPage:{flex:1,backgroundColor:'#000'},cameraSafe:{flex:1,justifyContent:'space-between',padding:18},cameraTop:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},glassButton:{width:44,height:44,borderRadius:22,backgroundColor:'rgba(8,17,31,.55)',borderWidth:1,borderColor:'rgba(255,255,255,.18)',alignItems:'center',justifyContent:'center'},cameraTitle:{fontFamily:'Inter_700Bold',fontSize:17,color:C.white},frameWrap:{alignItems:'center'},frame:{width:SCAN_WIDTH,aspectRatio:63/88,position:'relative',overflow:'hidden'},corner:{position:'absolute',width:42,height:42,borderColor:C.yellow,borderRadius:10,zIndex:2},scanLine:{position:'absolute',left:12,right:12,top:0,height:3,backgroundColor:C.cyan,shadowColor:C.cyan,shadowOpacity:1,shadowRadius:12,elevation:5},hold:{flexDirection:'row',gap:8,alignItems:'center',backgroundColor:'rgba(8,17,31,.7)',paddingVertical:9,paddingHorizontal:14,borderRadius:20,marginTop:18},holdText:{fontFamily:'Inter_700Bold',fontSize:9,color:C.white,letterSpacing:1.1},cameraHelp:{fontFamily:'Inter_500Medium',fontSize:13,color:C.white,textAlign:'center',marginBottom:12},cameraError:{color:'#FFD1D5',textAlign:'center',fontFamily:'Inter_500Medium',fontSize:11,marginBottom:8},shutterRow:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:28,paddingBottom:12},shutterOuter:{width:78,height:78,borderRadius:39,borderWidth:4,borderColor:C.white,alignItems:'center',justifyContent:'center'},shutterInner:{width:62,height:62,borderRadius:31,backgroundColor:C.yellow},autoBadge:{width:48,height:48,borderRadius:24,backgroundColor:'rgba(8,17,31,.72)',borderWidth:1,borderColor:'rgba(34,211,238,.35)',alignItems:'center',justifyContent:'center'},autoBadgeText:{fontFamily:'Inter_700Bold',fontSize:7,color:C.cyan,letterSpacing:.8,marginTop:1},analyzeIcon:{width:116,height:116,borderRadius:38,backgroundColor:C.panel,borderWidth:1,borderColor:C.line,alignItems:'center',justifyContent:'center'},analyzeTitle:{fontFamily:'Inter_700Bold',fontSize:23,color:C.white,marginTop:20},analyzeSub:{fontFamily:'Inter_400Regular',fontSize:13,color:C.muted,textAlign:'center',marginTop:8},
  resultTop:{paddingHorizontal:20,paddingVertical:16,flexDirection:'row',alignItems:'center',gap:16,borderBottomWidth:1,borderColor:C.line},back:{width:42,height:42,borderRadius:15,backgroundColor:C.panel2,alignItems:'center',justifyContent:'center'},smallHead:{fontFamily:'Inter_700Bold',fontSize:8,color:C.green,letterSpacing:1.3},resultTitle:{fontFamily:'Inter_700Bold',fontSize:20,color:C.white,marginTop:2},resultsScroll:{padding:20,paddingBottom:50},detected:{backgroundColor:C.panel,padding:15,borderRadius:17,borderWidth:1,borderColor:C.line,flexDirection:'row',alignItems:'center',gap:12},detectedIcon:{width:34,height:34,borderRadius:12,backgroundColor:'rgba(69,212,131,.1)',alignItems:'center',justifyContent:'center'},detectedLabel:{fontFamily:'Inter_700Bold',fontSize:8,color:C.muted,letterSpacing:1.2},detectedText:{fontFamily:'Inter_600SemiBold',fontSize:14,color:C.white,marginTop:3},found:{fontFamily:'Inter_400Regular',fontSize:11,color:C.muted,marginVertical:18},match:{minHeight:174,borderRadius:20,backgroundColor:C.panel,marginBottom:14,padding:13,flexDirection:'row',alignItems:'center',gap:13,borderWidth:1,borderColor:C.line,overflow:'hidden'},bestMatch:{borderColor:'#416DB4',backgroundColor:'#12233A'},bestTag:{position:'absolute',top:0,right:0,backgroundColor:C.yellow,paddingVertical:5,paddingHorizontal:9,borderBottomLeftRadius:10,flexDirection:'row',gap:4,alignItems:'center'},bestText:{fontFamily:'Inter_800ExtraBold',fontSize:7,color:C.ink,letterSpacing:.7},matchImg:{width:93,height:130,borderRadius:7,backgroundColor:C.panel2},matchInfo:{flex:1},matchName:{fontFamily:'Inter_700Bold',fontSize:17,color:C.white},matchSet:{fontFamily:'Inter_400Regular',fontSize:10.5,color:C.muted,marginTop:4},pills:{flexDirection:'row',gap:5,marginTop:10},pill:{fontFamily:'Inter_600SemiBold',fontSize:8,color:'#AFC0D7',paddingVertical:4,paddingHorizontal:7,backgroundColor:C.panel2,borderRadius:6,overflow:'hidden'},matchBottom:{flexDirection:'row',alignItems:'flex-end',justifyContent:'space-between',marginTop:12},marketLabel:{fontFamily:'Inter_700Bold',fontSize:7,color:C.muted,letterSpacing:.8},matchPrice:{fontFamily:'Inter_700Bold',fontSize:20,color:C.yellow,marginTop:1},confidence:{backgroundColor:'rgba(69,212,131,.1)',borderRadius:8,padding:5},confText:{fontFamily:'Inter_600SemiBold',fontSize:8,color:C.green},empty:{alignItems:'center',padding:50},emptyTitle:{fontFamily:'Inter_700Bold',fontSize:18,color:C.white,marginTop:12},emptySub:{fontFamily:'Inter_400Regular',fontSize:12,color:C.muted,marginTop:5},
  authNameRow:{flexDirection:'row',gap:10},authNameField:{flex:1},optional:{color:C.cyan},saveError:{fontFamily:'Inter_500Medium',fontSize:11,color:'#FF9EA8',textAlign:'center',marginTop:20},collectionSaved:{backgroundColor:C.green},
  detailHero:{paddingHorizontal:18,paddingBottom:26},detailTop:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingTop:8},detailNav:{fontFamily:'Inter_700Bold',fontSize:16,color:C.white},cardGlow:{position:'absolute',width:DETAIL_CARD_WIDTH,height:DETAIL_CARD_WIDTH,borderRadius:DETAIL_CARD_WIDTH/2,backgroundColor:'rgba(68,215,255,.14)',alignSelf:'center',top:125},heroCard:{width:DETAIL_CARD_WIDTH,height:DETAIL_CARD_HEIGHT,alignSelf:'center',marginTop:18,marginBottom:8},detailBody:{padding:22,paddingBottom:110,backgroundColor:C.ink,borderTopLeftRadius:28,borderTopRightRadius:28},matchedIdentifier:{fontFamily:'Inter_700Bold',fontSize:9,color:C.green,letterSpacing:1,marginBottom:10},detailHeading:{flexDirection:'row',alignItems:'center'},detailName:{fontFamily:'Inter_800ExtraBold',fontSize:29,color:C.white,letterSpacing:-.8},detailSet:{fontFamily:'Inter_400Regular',fontSize:12,color:C.muted,marginTop:6},typeBadge:{flexDirection:'row',alignItems:'center',gap:5,backgroundColor:C.yellow,paddingVertical:8,paddingHorizontal:11,borderRadius:12},typeText:{fontFamily:'Inter_700Bold',fontSize:9,color:C.ink},priceCard:{marginTop:24,borderRadius:20,backgroundColor:C.panel,padding:19,borderWidth:1,borderColor:C.line,flexDirection:'row',justifyContent:'space-between',alignItems:'flex-start'},valueLabel:{fontFamily:'Inter_700Bold',fontSize:8,color:C.muted,letterSpacing:1.1},bigPrice:{fontFamily:'Inter_800ExtraBold',fontSize:36,color:C.white,letterSpacing:-1,marginTop:3},updated:{fontFamily:'Inter_400Regular',fontSize:9,color:C.muted,marginTop:3},priceActions:{alignItems:'flex-end',gap:10},gain:{flexDirection:'row',gap:5,alignItems:'center',backgroundColor:'rgba(69,212,131,.1)',paddingVertical:6,paddingHorizontal:9,borderRadius:10},gainText:{fontFamily:'Inter_700Bold',fontSize:10,color:C.green},sellButton:{flexDirection:'row',alignItems:'center',gap:6,backgroundColor:C.green,paddingVertical:9,paddingHorizontal:15,borderRadius:11},sellButtonText:{fontFamily:'Inter_700Bold',fontSize:11,color:C.ink},range:{flexDirection:'row',backgroundColor:'#0C1727',borderRadius:15,marginTop:10,paddingVertical:13,alignItems:'center'},rangeItem:{flex:1,alignItems:'center'},rangeLabel:{fontFamily:'Inter_500Medium',fontSize:9,color:C.muted},rangeValue:{fontFamily:'Inter_700Bold',fontSize:14,color:C.white,marginTop:3},rangeLine:{width:1,height:28,backgroundColor:C.line},sectionTitle:{fontFamily:'Inter_700Bold',fontSize:9,color:C.muted,letterSpacing:1.3,marginTop:27,marginBottom:11},infoGrid:{flexDirection:'row',flexWrap:'wrap',gap:9},info:{width:'48.5%',backgroundColor:C.panel,padding:14,borderRadius:14,borderWidth:1,borderColor:C.line},infoLabel:{fontFamily:'Inter_700Bold',fontSize:8,color:C.muted,letterSpacing:.8},infoValue:{fontFamily:'Inter_600SemiBold',fontSize:13,color:C.white,marginTop:5},detailsBox:{backgroundColor:C.panel,borderRadius:16,borderWidth:1,borderColor:C.line,padding:15},ability:{marginBottom:14,paddingBottom:13,borderBottomWidth:1,borderColor:C.line},abilityBadge:{alignSelf:'flex-start',backgroundColor:'rgba(244,63,140,.15)',paddingVertical:4,paddingHorizontal:7,borderRadius:6,marginBottom:7},abilityBadgeText:{fontFamily:'Inter_800ExtraBold',fontSize:7,color:C.red,letterSpacing:.8},abilityText:{fontFamily:'Inter_600SemiBold',fontSize:11,color:C.white,lineHeight:17},attack:{flexDirection:'row',alignItems:'center',gap:9,marginBottom:10},energyDot:{width:18,height:18,borderRadius:9,backgroundColor:C.yellow,borderWidth:4,borderColor:'#7C6515'},attackText:{fontFamily:'Inter_600SemiBold',fontSize:12,color:C.white},cardText:{fontFamily:'Inter_400Regular',fontSize:11,color:C.muted,lineHeight:17,marginTop:4},combatRow:{marginTop:12,paddingTop:12,borderTopWidth:1,borderColor:C.line},weakness:{fontFamily:'Inter_500Medium',fontSize:10,color:'#C9D5E4',marginBottom:6},collection:{height:56,borderRadius:16,backgroundColor:C.yellow,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:9,marginTop:26},collectionText:{fontFamily:'Inter_700Bold',fontSize:14,color:C.ink},disclaimer:{fontFamily:'Inter_400Regular',fontSize:9,color:C.muted,textAlign:'center',lineHeight:14,marginTop:14}
});
