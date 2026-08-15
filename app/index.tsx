import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, Animated, Dimensions, ImageBackground, KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
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
import { cardImageSource, getCard, rankCards, searchCards } from '@/services/pokewallet';

type Screen = 'home' | 'camera' | 'analyzing' | 'matches' | 'detail';
const money = (n: number | null) => n == null ? '—' : `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

export default function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const { hasPermission, requestPermission } = useCameraPermission();
  const [query, setQuery] = useState('');
  const [matches, setMatches] = useState<Card[]>([]);
  const [selected, setSelected] = useState<Card | null>(null);
  const [error, setError] = useState('');

  const searchWithScan = async (actual: string, scan?: ScanText) => {
    setError(''); setScreen('analyzing'); setQuery(actual);
    let cards: Card[] = [];
    const candidates = (scan?.queries ?? [actual]).slice(0, 4);
    for (const candidate of candidates) {
      const found = await searchCards(candidate);
      cards = [...cards, ...found.filter(item => !cards.some(existing => existing.id === item.id))];
      const wantedNumber = scan?.hints.number?.split('/')[0].replace(/^0+/, '');
      const hasExactNumber = wantedNumber && cards.some(card => card.number.split('/')[0].replace(/^0+/, '') === wantedNumber);
      if (!scan || hasExactNumber || (cards.length > 0 && !wantedNumber)) break;
    }
    setMatches(scan ? rankCards(cards, scan.hints) : cards); setScreen('matches');
  };

  const lookup = async (q: string, uri?: string) => {
    try {
      setError('');
      if (uri) setScreen('analyzing');
      const scan = uri ? await recognizeCard(uri) : undefined;
      const actual = scan?.query ?? q.trim();
      await searchWithScan(actual, scan);
    } catch (e) { setError(e instanceof Error ? e.message : 'Something went wrong.'); setScreen(uri ? 'camera' : 'home'); }
  };
  const openCamera = async () => {
    if (!hasPermission) { const granted = await requestPermission(); if (!granted) return; }
    setError(''); setScreen('camera');
  };
  const choose = async (card: Card) => {
    await Haptics.selectionAsync(); setSelected(card); setScreen('detail');
    try { setSelected(await getCard(card.id)); } catch { /* search data is still useful */ }
  };

  if (screen === 'camera') return <CameraScreen onClose={() => setScreen('home')} onPhoto={(path: string) => lookup('', `file://${path}`)} error={error} />;
  if (screen === 'analyzing') return <Analyzing />;
  if (screen === 'matches') return <Matches query={query} cards={matches} onBack={() => setScreen('home')} onSelect={choose} onSearch={lookup} />;
  if (screen === 'detail' && selected) return <Detail card={selected} onBack={() => setScreen('matches')} />;
  return <Home onScan={openCamera} onSearch={lookup} error={error} />;
}

function Brand({ dark = false }: { dark?: boolean }) {
  return <View style={s.brand}><View style={s.brandMark}><View style={s.brandDot} /></View><Text style={[s.brandText, dark && { color: C.ink }]}>poke<Text style={{ color: C.cyan }}>Scan</Text></Text></View>;
}

function Home({ onScan, onSearch, error }: { onScan: () => void; onSearch: (q: string) => void; error: string }) {
  const [text, setText] = useState('');
  return <View style={s.page}>
    <LinearGradient colors={['#160D2B', C.ink, '#07050C']} style={StyleSheet.absoluteFill} />
    <KeyboardAvoidingView style={s.safe} behavior={Platform.OS === 'ios' ? 'padding' : 'height'}>
    <SafeAreaView style={s.safe}>
      <View style={s.top}><Brand /><Pressable style={s.avatar}><Ionicons name="person" size={18} color={C.white} /></Pressable></View>
      <ScrollView contentContainerStyle={s.homeScroll} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled" keyboardDismissMode="interactive">
        <View style={s.heroCopy}><View style={s.eyebrow}><View style={s.liveDot} /><Text style={s.eyebrowText}>POWERED BY POKÉWALLET</Text></View>
          <Text style={s.heroTitle}>Know what your{`\n`}card is <Text style={s.heroAccent}>worth.</Text></Text>
          <Text style={s.heroSub}>Scan any Pokémon card. Get an instant match and live market value.</Text>
        </View>
        <Pressable onPress={onScan} style={({ pressed }) => [s.scanCard, pressed && { transform: [{ scale: .985 }] }]}>
          <LinearGradient colors={['#9333EA', '#6D28D9', '#4C1D95']} start={{x:0,y:0}} end={{x:1,y:1}} style={s.scanGradient}>
            <View style={s.orbOne} /><View style={s.orbTwo} />
            <View style={s.scanIcon}><MaterialCommunityIcons name="line-scan" size={36} color={C.ink} /></View>
            <View style={{ flex: 1 }}><Text style={s.scanTitle}>Scan a card</Text><Text style={s.scanSub}>Use your camera to identify it</Text></View>
            <View style={s.circleArrow}><Feather name="arrow-up-right" size={22} color={C.white} /></View>
          </LinearGradient>
        </Pressable>
        <View style={s.divider}><View style={s.divLine} /><Text style={s.or}>OR SEARCH MANUALLY</Text><View style={s.divLine} /></View>
        <View style={s.searchBox}><Feather name="search" size={20} color={C.muted} /><TextInput value={text} onChangeText={setText} onSubmitEditing={() => text.trim() && onSearch(text.trim())} placeholder="Card name or number" placeholderTextColor="#7F91AA" selectionColor={C.cyan} cursorColor={C.cyan} style={s.input} returnKeyType="search" autoCorrect={false} autoCapitalize="words" /><Pressable onPress={() => text.trim() && onSearch(text.trim())} style={s.searchGo}><Feather name="arrow-right" size={18} color={C.ink} /></Pressable></View>
        {!!error && <Text style={s.error}>{error}</Text>}
        <View style={s.stats}><Stat icon="layers" value="50K+" label="Cards indexed" /><View style={s.statLine} /><Stat icon="zap" value="Live" label="Market pricing" /><View style={s.statLine} /><Stat icon="shield" value="Fast" label="Private scanning" /></View>
        <View style={s.tip}><View style={s.bulb}><Ionicons name="bulb" size={18} color={C.yellow} /></View><Text style={s.tipText}><Text style={{ color: C.white, fontFamily: 'Inter_600SemiBold' }}>Scanner tip  </Text>Place the card on a dark surface and avoid glare for the best match.</Text></View>
      </ScrollView>
    </SafeAreaView>
    </KeyboardAvoidingView>
  </View>;
}
function Stat({ icon, value, label }: { icon: any; value: string; label: string }) { return <View style={s.stat}><Feather name={icon} size={17} color={C.cyan} /><Text style={s.statValue}>{value}</Text><Text style={s.statLabel}>{label}</Text></View>; }

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
      const { filePath } = await photoOutput.capturePhotoToFile({ flashMode: 'off', enableShutterSound: true }, {});
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
    <SafeAreaView style={s.cameraSafe}><View style={s.cameraTop}><Pressable onPress={onClose} style={s.glassButton}><Feather name="x" size={23} color={C.white} /></Pressable><Text style={s.cameraTitle}>Scan your card</Text><View style={s.glassButton}><Feather name="zap" size={20} color={C.white} /></View></View>
      <View style={s.frameWrap}><View style={s.frame}><Corner pos="tl" /><Corner pos="tr" /><Corner pos="bl" /><Corner pos="br" /><ScannerBeam /></View><View style={s.hold}><MaterialCommunityIcons name="cards-outline" size={18} color={C.cyan} /><Text style={s.holdText}>FIT FULL CARD · KEEP 12–18 IN AWAY</Text></View></View>
      <View><Text style={s.cameraHelp}>{error ? 'Scanner unavailable' : ready ? status : 'Starting camera…'}</Text>{!!error && <Text style={s.cameraError}>{error}</Text>}<View style={s.shutterRow}><View style={{width:48}} /><Pressable disabled={!ready || locked.current} hitSlop={14} onPress={manualCapture} style={({pressed}) => [s.shutterOuter, (!ready || locked.current) && {opacity:.45}, pressed && {transform:[{scale:.94}]}]}><View style={s.shutterInner} /></Pressable><View style={s.autoBadge}><MaterialCommunityIcons name="line-scan" size={16} color={C.cyan}/><Text style={s.autoBadgeText}>LIVE</Text></View></View></View>
    </SafeAreaView>
  </View>;
}
function Corner({ pos }: {pos:string}) { return <View style={[s.corner, pos.includes('t')?{top:-2}:{bottom:-2},pos.includes('l')?{left:-2}:{right:-2},pos==='tl'&&{borderTopWidth:4,borderLeftWidth:4},pos==='tr'&&{borderTopWidth:4,borderRightWidth:4},pos==='bl'&&{borderBottomWidth:4,borderLeftWidth:4},pos==='br'&&{borderBottomWidth:4,borderRightWidth:4}]} />; }

function Analyzing() { return <View style={[s.page, s.center]}><LinearGradient colors={[C.ink,'#251044','#11102D']} style={StyleSheet.absoluteFill}/><View style={s.analyzeIcon}><MaterialCommunityIcons name="line-scan" size={56} color={C.cyan} /></View><ActivityIndicator color={C.cyan} size="large" style={{marginTop:28}}/><Text style={s.analyzeTitle}>Reading your card…</Text><Text style={s.analyzeSub}>Finding its name, set, and collector number</Text></View>; }

function Matches({ query, cards, onBack, onSelect, onSearch }: {query:string;cards:Card[];onBack:()=>void;onSelect:(c:Card)=>void;onSearch:(q:string)=>void}) {
  return <View style={s.page}><SafeAreaView style={s.safe}><View style={s.resultTop}><Pressable onPress={onBack} style={s.back}><Feather name="arrow-left" size={22} color={C.white}/></Pressable><View><Text style={s.smallHead}>SCAN COMPLETE</Text><Text style={s.resultTitle}>Choose your match</Text></View></View>
    <ScrollView contentContainerStyle={s.resultsScroll} showsVerticalScrollIndicator={false}><View style={s.detected}><View style={s.detectedIcon}><Feather name="check" size={18} color={C.green}/></View><View style={{flex:1}}><Text style={s.detectedLabel}>TEXT DETECTED</Text><Text style={s.detectedText}>{query || 'Pokémon card'}</Text></View><Pressable onPress={()=>onSearch(query)}><Feather name="refresh-cw" size={18} color={C.muted}/></Pressable></View>
      <Text style={s.found}><Text style={{color:C.white}}>{cards.length} possible matches</Text> · Select the exact card</Text>
      {cards.map((card,i)=><Match key={card.id} card={card} best={i===0} onPress={()=>onSelect(card)}/>)}
      {!cards.length && <View style={s.empty}><MaterialCommunityIcons name="cards-outline" size={42} color={C.muted}/><Text style={s.emptyTitle}>No matches yet</Text><Text style={s.emptySub}>Try a clearer scan or search by card name.</Text></View>}
    </ScrollView></SafeAreaView></View>;
}
function Match({card,best,onPress}:{card:Card;best:boolean;onPress:()=>void}) { const p=card.prices[0]; return <Pressable onPress={onPress} style={({pressed})=>[s.match, best&&s.bestMatch,pressed&&{opacity:.8}]}>{best&&<View style={s.bestTag}><Ionicons name="sparkles" size={12} color={C.ink}/><Text style={s.bestText}>BEST MATCH</Text></View>}<Image source={cardImageSource(card)} style={s.matchImg} contentFit="cover" transition={250}/><View style={s.matchInfo}><Text style={s.matchName} numberOfLines={1}>{card.name}</Text><Text style={s.matchSet} numberOfLines={1}>{card.setName} · {card.setCode} {card.number}</Text><View style={s.pills}><Text style={s.pill}>{card.number}</Text><Text style={s.pill}>{card.rarity}</Text></View><View style={s.matchBottom}><View><Text style={s.marketLabel}>MARKET VALUE</Text><Text style={s.matchPrice}>{money(p?.market)}</Text></View><View style={s.confidence}><Text style={s.confText}>{Math.round((card.confidence??.7)*100)}% match</Text></View></View></View><Feather name="chevron-right" size={21} color={C.muted}/></Pressable>; }

function Detail({card,onBack}:{card:Card;onBack:()=>void}) { const p=card.prices[0]; return <View style={s.page}><ScrollView showsVerticalScrollIndicator={false}><LinearGradient colors={['#4C1D95',C.ink]} style={s.detailHero}><SafeAreaView><View style={s.detailTop}><Pressable onPress={onBack} style={s.glassButton}><Feather name="arrow-left" size={22} color={C.white}/></Pressable><Text style={s.detailNav}>Card details</Text><Pressable style={s.glassButton}><Feather name="share-2" size={20} color={C.white}/></Pressable></View><View style={s.cardGlow}/><Image source={cardImageSource(card)} style={s.heroCard} contentFit="contain" transition={300}/></SafeAreaView></LinearGradient>
    <View style={s.detailBody}><Text style={s.matchedIdentifier}>MATCHED: {card.name} ({card.setCode} {card.number})</Text><View style={s.detailHeading}><View style={{flex:1}}><Text style={s.detailName}>{card.name}</Text><Text style={s.detailSet}>{card.setName} · {card.setCode} {card.number}</Text></View><View style={s.typeBadge}><Feather name="zap" size={14} color={C.ink}/><Text style={s.typeText}>{card.type}</Text></View></View>
      <View style={s.priceCard}><View><Text style={s.valueLabel}>CURRENT MARKET VALUE</Text><Text style={s.bigPrice}>{money(p?.market)}</Text><Text style={s.updated}>Updated from {p?.source ?? 'PokéWallet'}</Text></View><View style={s.priceActions}><View style={s.gain}><Feather name="trending-up" size={15} color={C.green}/><Text style={s.gainText}>Live</Text></View><Pressable accessibilityRole="button" accessibilityLabel="Sell this card" style={({pressed})=>[s.sellButton,pressed&&{opacity:.75}]}><Feather name="tag" size={14} color={C.ink}/><Text style={s.sellButtonText}>Sell</Text></Pressable></View></View>
      <View style={s.range}><Range label="Low" value={money(p?.low)}/><View style={s.rangeLine}/><Range label="Market" value={money(p?.market)} active/><View style={s.rangeLine}/><Range label="High" value={money(p?.high)}/></View>
      <Text style={s.sectionTitle}>CARD INFORMATION</Text><View style={s.infoGrid}><Info label="RARITY" value={card.rarity}/><Info label="CARD NO." value={card.number}/><Info label="STAGE" value={card.stage||'—'}/><Info label="HP" value={card.hp||'—'}/>{!!card.evolvesFrom&&<Info label="EVOLVES FROM" value={card.evolvesFrom}/>}{!!card.regulationMark&&<Info label="REGULATION" value={card.regulationMark}/>}{!!card.illustrator&&<Info label="ILLUSTRATOR" value={card.illustrator}/>}{!!card.retreatCost&&<Info label="RETREAT COST" value={card.retreatCost}/>}</View>
      {(card.attacks?.length||card.abilities?.length||card.text||card.weakness||card.resistance)&&<><Text style={s.sectionTitle}>CARD DETAILS</Text><View style={s.detailsBox}>{card.abilities?.map(a=><View key={`ability-${a}`} style={s.ability}><View style={s.abilityBadge}><Text style={s.abilityBadgeText}>ABILITY</Text></View><Text style={s.abilityText}>{a}</Text></View>)}{card.attacks?.map(a=><View key={a} style={s.attack}><View style={s.energyDot}/><Text style={s.attackText}>{a}</Text></View>)}{!!card.text&&<Text style={s.cardText}>{card.text}</Text>}<View style={s.combatRow}>{!!card.weakness&&<Text style={s.weakness}>Weakness  ·  {card.weakness}</Text>}{!!card.resistance&&<Text style={s.weakness}>Resistance  ·  {card.resistance}</Text>}</View></View></>}
      <Pressable style={s.collection}><Feather name="plus" size={20} color={C.ink}/><Text style={s.collectionText}>Add to collection</Text></Pressable><Text style={s.disclaimer}>Prices are estimates and vary by condition, language, and market.</Text>
    </View></ScrollView></View>; }
function Range({label,value,active}:{label:string;value:string;active?:boolean}) { return <View style={s.rangeItem}><Text style={s.rangeLabel}>{label}</Text><Text style={[s.rangeValue,active&&{color:C.yellow}]}>{value}</Text></View>; }
function Info({label,value}:{label:string;value:string}) { return <View style={s.info}><Text style={s.infoLabel}>{label}</Text><Text style={s.infoValue} numberOfLines={1}>{value}</Text></View>; }

const W=Dimensions.get('window').width;
const SCAN_WIDTH=Math.min(W-112,330);
const s=StyleSheet.create({
  page:{flex:1,backgroundColor:C.ink},safe:{flex:1},center:{alignItems:'center',justifyContent:'center',padding:32},top:{height:70,paddingHorizontal:22,flexDirection:'row',alignItems:'center',justifyContent:'space-between'},brand:{flexDirection:'row',alignItems:'center',gap:9},brandMark:{width:28,height:28,borderRadius:14,backgroundColor:C.red,borderWidth:3,borderColor:C.white,alignItems:'center',justifyContent:'center',overflow:'hidden'},brandDot:{width:8,height:8,borderRadius:4,backgroundColor:C.white,borderWidth:2,borderColor:C.ink},brandText:{fontFamily:'Inter_800ExtraBold',fontSize:21,color:C.white,letterSpacing:-.8},avatar:{width:38,height:38,borderRadius:19,backgroundColor:C.panel2,alignItems:'center',justifyContent:'center',borderWidth:1,borderColor:C.line},
  homeScroll:{padding:22,paddingBottom:40},heroCopy:{marginTop:22,marginBottom:30},eyebrow:{flexDirection:'row',alignItems:'center',gap:8,marginBottom:15},liveDot:{width:7,height:7,borderRadius:4,backgroundColor:C.green},eyebrowText:{fontFamily:'Inter_700Bold',fontSize:10,color:C.green,letterSpacing:1.5},heroTitle:{fontFamily:'Inter_800ExtraBold',fontSize:42,lineHeight:47,color:C.white,letterSpacing:-1.8},heroAccent:{color:C.yellow},heroSub:{fontFamily:'Inter_400Regular',fontSize:16,lineHeight:24,color:C.muted,marginTop:15,maxWidth:340},scanCard:{borderRadius:24,overflow:'hidden',...shadow},scanGradient:{minHeight:154,padding:22,flexDirection:'row',alignItems:'center',gap:16,overflow:'hidden'},orbOne:{position:'absolute',width:170,height:170,borderRadius:85,backgroundColor:'rgba(68,215,255,.12)',right:-35,top:-85},orbTwo:{position:'absolute',width:90,height:90,borderRadius:45,borderWidth:18,borderColor:'rgba(255,255,255,.06)',left:140,bottom:-55},scanIcon:{width:66,height:66,borderRadius:22,backgroundColor:C.yellow,alignItems:'center',justifyContent:'center'},scanTitle:{fontFamily:'Inter_700Bold',fontSize:22,color:C.white},scanSub:{fontFamily:'Inter_400Regular',fontSize:12,color:'#BBD3FF',marginTop:5},circleArrow:{width:42,height:42,borderRadius:21,borderWidth:1,borderColor:'rgba(255,255,255,.25)',alignItems:'center',justifyContent:'center'},divider:{flexDirection:'row',alignItems:'center',gap:12,marginVertical:24},divLine:{height:1,backgroundColor:C.line,flex:1},or:{fontFamily:'Inter_600SemiBold',fontSize:9,color:C.muted,letterSpacing:1.1},searchBox:{height:58,borderRadius:17,borderWidth:1,borderColor:C.line,backgroundColor:C.panel,flexDirection:'row',alignItems:'center',paddingLeft:17},input:{flex:1,height:'100%',color:'#F8FAFC',backgroundColor:'transparent',fontFamily:'Inter_600SemiBold',fontSize:15,lineHeight:20,paddingHorizontal:12,paddingVertical:0,opacity:1},searchGo:{width:40,height:40,borderRadius:12,backgroundColor:C.yellow,alignItems:'center',justifyContent:'center',marginRight:8},error:{color:C.red,fontFamily:'Inter_500Medium',fontSize:12,marginTop:10},stats:{flexDirection:'row',alignItems:'center',justifyContent:'space-around',marginTop:30},stat:{alignItems:'center',gap:4,flex:1},statValue:{fontFamily:'Inter_700Bold',fontSize:15,color:C.white},statLabel:{fontFamily:'Inter_400Regular',fontSize:9,color:C.muted},statLine:{width:1,height:38,backgroundColor:C.line},tip:{marginTop:28,padding:15,backgroundColor:'#111F31',borderRadius:16,flexDirection:'row',alignItems:'center',gap:12,borderWidth:1,borderColor:C.line},bulb:{width:34,height:34,borderRadius:11,backgroundColor:'rgba(255,213,61,.1)',alignItems:'center',justifyContent:'center'},tipText:{flex:1,fontFamily:'Inter_400Regular',fontSize:11.5,lineHeight:18,color:C.muted},
  cameraPage:{flex:1,backgroundColor:'#000'},cameraSafe:{flex:1,justifyContent:'space-between',padding:18},cameraTop:{flexDirection:'row',alignItems:'center',justifyContent:'space-between'},glassButton:{width:44,height:44,borderRadius:22,backgroundColor:'rgba(8,17,31,.55)',borderWidth:1,borderColor:'rgba(255,255,255,.18)',alignItems:'center',justifyContent:'center'},cameraTitle:{fontFamily:'Inter_700Bold',fontSize:17,color:C.white},frameWrap:{alignItems:'center'},frame:{width:SCAN_WIDTH,aspectRatio:63/88,position:'relative',overflow:'hidden'},corner:{position:'absolute',width:42,height:42,borderColor:C.yellow,borderRadius:10,zIndex:2},scanLine:{position:'absolute',left:12,right:12,top:0,height:3,backgroundColor:C.cyan,shadowColor:C.cyan,shadowOpacity:1,shadowRadius:12,elevation:5},hold:{flexDirection:'row',gap:8,alignItems:'center',backgroundColor:'rgba(8,17,31,.7)',paddingVertical:9,paddingHorizontal:14,borderRadius:20,marginTop:18},holdText:{fontFamily:'Inter_700Bold',fontSize:9,color:C.white,letterSpacing:1.1},cameraHelp:{fontFamily:'Inter_500Medium',fontSize:13,color:C.white,textAlign:'center',marginBottom:12},cameraError:{color:'#FFD1D5',textAlign:'center',fontFamily:'Inter_500Medium',fontSize:11,marginBottom:8},shutterRow:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingHorizontal:28,paddingBottom:12},shutterOuter:{width:78,height:78,borderRadius:39,borderWidth:4,borderColor:C.white,alignItems:'center',justifyContent:'center'},shutterInner:{width:62,height:62,borderRadius:31,backgroundColor:C.yellow},autoBadge:{width:48,height:48,borderRadius:24,backgroundColor:'rgba(8,17,31,.72)',borderWidth:1,borderColor:'rgba(34,211,238,.35)',alignItems:'center',justifyContent:'center'},autoBadgeText:{fontFamily:'Inter_700Bold',fontSize:7,color:C.cyan,letterSpacing:.8,marginTop:1},analyzeIcon:{width:116,height:116,borderRadius:38,backgroundColor:C.panel,borderWidth:1,borderColor:C.line,alignItems:'center',justifyContent:'center'},analyzeTitle:{fontFamily:'Inter_700Bold',fontSize:23,color:C.white,marginTop:20},analyzeSub:{fontFamily:'Inter_400Regular',fontSize:13,color:C.muted,textAlign:'center',marginTop:8},
  resultTop:{paddingHorizontal:20,paddingVertical:16,flexDirection:'row',alignItems:'center',gap:16,borderBottomWidth:1,borderColor:C.line},back:{width:42,height:42,borderRadius:15,backgroundColor:C.panel2,alignItems:'center',justifyContent:'center'},smallHead:{fontFamily:'Inter_700Bold',fontSize:8,color:C.green,letterSpacing:1.3},resultTitle:{fontFamily:'Inter_700Bold',fontSize:20,color:C.white,marginTop:2},resultsScroll:{padding:20,paddingBottom:50},detected:{backgroundColor:C.panel,padding:15,borderRadius:17,borderWidth:1,borderColor:C.line,flexDirection:'row',alignItems:'center',gap:12},detectedIcon:{width:34,height:34,borderRadius:12,backgroundColor:'rgba(69,212,131,.1)',alignItems:'center',justifyContent:'center'},detectedLabel:{fontFamily:'Inter_700Bold',fontSize:8,color:C.muted,letterSpacing:1.2},detectedText:{fontFamily:'Inter_600SemiBold',fontSize:14,color:C.white,marginTop:3},found:{fontFamily:'Inter_400Regular',fontSize:11,color:C.muted,marginVertical:18},match:{minHeight:174,borderRadius:20,backgroundColor:C.panel,marginBottom:14,padding:13,flexDirection:'row',alignItems:'center',gap:13,borderWidth:1,borderColor:C.line,overflow:'hidden'},bestMatch:{borderColor:'#416DB4',backgroundColor:'#12233A'},bestTag:{position:'absolute',top:0,right:0,backgroundColor:C.yellow,paddingVertical:5,paddingHorizontal:9,borderBottomLeftRadius:10,flexDirection:'row',gap:4,alignItems:'center'},bestText:{fontFamily:'Inter_800ExtraBold',fontSize:7,color:C.ink,letterSpacing:.7},matchImg:{width:93,height:130,borderRadius:7,backgroundColor:C.panel2},matchInfo:{flex:1},matchName:{fontFamily:'Inter_700Bold',fontSize:17,color:C.white},matchSet:{fontFamily:'Inter_400Regular',fontSize:10.5,color:C.muted,marginTop:4},pills:{flexDirection:'row',gap:5,marginTop:10},pill:{fontFamily:'Inter_600SemiBold',fontSize:8,color:'#AFC0D7',paddingVertical:4,paddingHorizontal:7,backgroundColor:C.panel2,borderRadius:6,overflow:'hidden'},matchBottom:{flexDirection:'row',alignItems:'flex-end',justifyContent:'space-between',marginTop:12},marketLabel:{fontFamily:'Inter_700Bold',fontSize:7,color:C.muted,letterSpacing:.8},matchPrice:{fontFamily:'Inter_700Bold',fontSize:20,color:C.yellow,marginTop:1},confidence:{backgroundColor:'rgba(69,212,131,.1)',borderRadius:8,padding:5},confText:{fontFamily:'Inter_600SemiBold',fontSize:8,color:C.green},empty:{alignItems:'center',padding:50},emptyTitle:{fontFamily:'Inter_700Bold',fontSize:18,color:C.white,marginTop:12},emptySub:{fontFamily:'Inter_400Regular',fontSize:12,color:C.muted,marginTop:5},
  detailHero:{height:500,paddingHorizontal:18},detailTop:{flexDirection:'row',alignItems:'center',justifyContent:'space-between',paddingTop:8},detailNav:{fontFamily:'Inter_700Bold',fontSize:16,color:C.white},cardGlow:{position:'absolute',width:280,height:280,borderRadius:140,backgroundColor:'rgba(68,215,255,.14)',alignSelf:'center',top:115},heroCard:{width:270,height:378,alignSelf:'center',marginTop:25},detailBody:{padding:22,paddingBottom:45,marginTop:-4,backgroundColor:C.ink,borderTopLeftRadius:28,borderTopRightRadius:28},matchedIdentifier:{fontFamily:'Inter_700Bold',fontSize:9,color:C.green,letterSpacing:1,marginBottom:10},detailHeading:{flexDirection:'row',alignItems:'center'},detailName:{fontFamily:'Inter_800ExtraBold',fontSize:29,color:C.white,letterSpacing:-.8},detailSet:{fontFamily:'Inter_400Regular',fontSize:12,color:C.muted,marginTop:6},typeBadge:{flexDirection:'row',alignItems:'center',gap:5,backgroundColor:C.yellow,paddingVertical:8,paddingHorizontal:11,borderRadius:12},typeText:{fontFamily:'Inter_700Bold',fontSize:9,color:C.ink},priceCard:{marginTop:24,borderRadius:20,backgroundColor:C.panel,padding:19,borderWidth:1,borderColor:C.line,flexDirection:'row',justifyContent:'space-between',alignItems:'flex-start'},valueLabel:{fontFamily:'Inter_700Bold',fontSize:8,color:C.muted,letterSpacing:1.1},bigPrice:{fontFamily:'Inter_800ExtraBold',fontSize:36,color:C.white,letterSpacing:-1,marginTop:3},updated:{fontFamily:'Inter_400Regular',fontSize:9,color:C.muted,marginTop:3},priceActions:{alignItems:'flex-end',gap:10},gain:{flexDirection:'row',gap:5,alignItems:'center',backgroundColor:'rgba(69,212,131,.1)',paddingVertical:6,paddingHorizontal:9,borderRadius:10},gainText:{fontFamily:'Inter_700Bold',fontSize:10,color:C.green},sellButton:{flexDirection:'row',alignItems:'center',gap:6,backgroundColor:C.green,paddingVertical:9,paddingHorizontal:15,borderRadius:11},sellButtonText:{fontFamily:'Inter_700Bold',fontSize:11,color:C.ink},range:{flexDirection:'row',backgroundColor:'#0C1727',borderRadius:15,marginTop:10,paddingVertical:13,alignItems:'center'},rangeItem:{flex:1,alignItems:'center'},rangeLabel:{fontFamily:'Inter_500Medium',fontSize:9,color:C.muted},rangeValue:{fontFamily:'Inter_700Bold',fontSize:14,color:C.white,marginTop:3},rangeLine:{width:1,height:28,backgroundColor:C.line},sectionTitle:{fontFamily:'Inter_700Bold',fontSize:9,color:C.muted,letterSpacing:1.3,marginTop:27,marginBottom:11},infoGrid:{flexDirection:'row',flexWrap:'wrap',gap:9},info:{width:'48.5%',backgroundColor:C.panel,padding:14,borderRadius:14,borderWidth:1,borderColor:C.line},infoLabel:{fontFamily:'Inter_700Bold',fontSize:8,color:C.muted,letterSpacing:.8},infoValue:{fontFamily:'Inter_600SemiBold',fontSize:13,color:C.white,marginTop:5},detailsBox:{backgroundColor:C.panel,borderRadius:16,borderWidth:1,borderColor:C.line,padding:15},ability:{marginBottom:14,paddingBottom:13,borderBottomWidth:1,borderColor:C.line},abilityBadge:{alignSelf:'flex-start',backgroundColor:'rgba(244,63,140,.15)',paddingVertical:4,paddingHorizontal:7,borderRadius:6,marginBottom:7},abilityBadgeText:{fontFamily:'Inter_800ExtraBold',fontSize:7,color:C.red,letterSpacing:.8},abilityText:{fontFamily:'Inter_600SemiBold',fontSize:11,color:C.white,lineHeight:17},attack:{flexDirection:'row',alignItems:'center',gap:9,marginBottom:10},energyDot:{width:18,height:18,borderRadius:9,backgroundColor:C.yellow,borderWidth:4,borderColor:'#7C6515'},attackText:{fontFamily:'Inter_600SemiBold',fontSize:12,color:C.white},cardText:{fontFamily:'Inter_400Regular',fontSize:11,color:C.muted,lineHeight:17,marginTop:4},combatRow:{marginTop:12,paddingTop:12,borderTopWidth:1,borderColor:C.line},weakness:{fontFamily:'Inter_500Medium',fontSize:10,color:'#C9D5E4',marginBottom:6},collection:{height:56,borderRadius:16,backgroundColor:C.yellow,flexDirection:'row',alignItems:'center',justifyContent:'center',gap:9,marginTop:26},collectionText:{fontFamily:'Inter_700Bold',fontSize:14,color:C.ink},disclaimer:{fontFamily:'Inter_400Regular',fontSize:9,color:C.muted,textAlign:'center',lineHeight:14,marginTop:14}
});
