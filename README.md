# pokeScan

A React Native Pokémon card scanner that uses VisionCamera, Nitro Modules, on-device live OCR, and PokéWallet for card matching, images, details, and pricing.

## Environment setup

Install dependencies and create your local environment file:

```bash
npm install
cp .env.example .env
```

The Expo Router runtime also requires the SDK-matched `expo-linking` and `expo-constants` packages. They are included in `package.json`; if an existing checkout reports either package missing, run:

```bash
npx expo install expo-linking expo-constants
```

`react-dom` is explicitly pinned to `19.1.0` to match Expo 54's React version. This prevents npm from auto-selecting an incompatible newer optional peer through Expo Router.

For local testing, add your PokéWallet development key to `.env`:

```env
EXPO_PUBLIC_POKEWALLET_API_KEY=pk_test_replace_with_your_key
```

For an App Store build, use a server-side proxy so the API key is not embedded in the application:

```env
EXPO_PUBLIC_POKEWALLET_PROXY_URL=https://api.yourdomain.com/pokewallet
EXPO_PUBLIC_POKEWALLET_API_KEY=
```

Restart Expo with `--clear` after changing `.env`.

## Enable real camera scanning

pokeScan does not return mock OCR, cards, or prices. Live frames run through VisionCamera v5 and its Nitro-powered on-device OCR pipeline. The app waits for the same character name and collector number across two processed frames, captures a full-resolution still through Nitro Image, and only then sends the extracted identifiers to PokéWallet.

Install the native camera, Nitro, and worklet dependencies:

```bash
npm install react-native-vision-camera react-native-nitro-modules react-native-nitro-image react-native-vision-camera-ocr-plus react-native-vision-camera-worklets react-native-worklets
```

The versions are pinned in `package.json` for Expo 54 / React Native 0.81 compatibility. Avoid upgrading one Nitro or VisionCamera package independently; their generated native bindings must remain aligned.

Expo SDK 54 configures the Worklets Babel transform through its preset. Do not add `react-native-worklets/plugin` manually to this Expo project. Verify the scanner packages before building with:

```bash
npm run check:scanner
```

First, create `.env` and add a real PokéWallet key:

```bash
cp .env.example .env
```

```env
EXPO_PUBLIC_POKEWALLET_PROXY_URL=
EXPO_PUBLIC_POKEWALLET_API_KEY=pk_test_your_real_key
```

Then create and install an iOS development build on a Mac:

```bash
npm install
npx expo prebuild --platform ios
npx expo run:ios --device
```

After the development build is installed on the iPhone, start Metro with:

```bash
npx expo start --dev-client --clear
```

Open the installed **pokeScan development build**, not Expo Go. Point the camera at a card and align it within the frame. A moving cyan beam shows that live OCR is active. OCR is restricted to the visible guide region and runs every sixth camera frame. pokeScan proceeds only after two frames agree on both the character name and bottom collector number. No shutter press is required, and weak or unstable frames never trigger PokéWallet requests. The shutter remains available as a manual fallback. pokeScan will:

1. Capture the real camera image.
2. Extract text locally with the Nitro-powered live OCR processor.
3. Build a search query from the card name and collector number.
4. Request live matches from PokéWallet.
5. Display the returned images, details, and prices.

The OCR layer includes targeted correction for Pokémon TCG suffixes such as `ex`, `GX`, `VMAX`, and `VSTAR`, plus collector-number character corrections. Live OCR is cropped to the physical guide frame, and two consecutive frames must agree before capture. Collector numbers remain mandatory for automatic capture. If the title or bottom number is unreadable, auto-scan keeps gathering frames instead of sending a weak query. Results are reranked using the detected number, name, set, HP, rarity, attacks, evolution, and matching description words. For best results, fill most of the guide frame with the card, keep both the top name and bottom collector number sharp, and tilt the card slightly if a foil surface creates glare.

If `.env` is missing, the API key is rejected, OCR cannot read the card, or PokéWallet returns an error, pokeScan displays the real error instead of fallback data.

### Build real scanning from Linux or Windows

iOS cannot be compiled locally outside macOS. Create an EAS development build instead:

```bash
npm install
npx eas-cli@latest login
npx eas-cli@latest build:configure
npx eas-cli@latest build --platform ios --profile development
```

Install the resulting build on the registered iPhone and run:

```bash
npx expo start --dev-client --clear
```

## Preview on an iPhone with Expo Go

This previews the interface, but VisionCamera, Nitro, and live OCR are not available inside Expo Go. Real scanning requires the development build and never returns mock card data.

```bash
npx expo start --clear
```

Install Expo Go on the iPhone and scan the QR code displayed in the terminal.

## iOS development build on macOS

A Mac with Xcode is required to compile iOS locally. This native development build enables VisionCamera, Nitro, and live OCR.

```bash
npm install
npx expo prebuild --platform ios
npx expo run:ios
```

To select a connected physical iPhone:

```bash
npx expo run:ios --device
```

After installing the development build, start its development server with:

```bash
npx expo start --dev-client --clear
```

## iOS development build from Linux or Windows

Local iOS compilation is only supported on macOS. From Linux or Windows, use an EAS cloud build:

```bash
npm install
npx eas-cli@latest login
npx eas-cli@latest build:configure
npx eas-cli@latest build --platform ios --profile development
```

Install the resulting build on the registered iPhone, then start the development server:

```bash
npx expo start --dev-client --clear
```

## App Store build

Configure `EXPO_PUBLIC_POKEWALLET_PROXY_URL` for production, then build and submit:

```bash
npx eas-cli@latest build --platform ios --profile production
npx eas-cli@latest submit --platform ios
```

## PokéWallet proxy requirements

The proxy must attach the private `X-API-Key` header and pass through `/search`, `/cards/:id`, and `/images/:id`. It must preserve query strings and image content types. Card details display available evolution lineage, abilities, attacks, weakness, resistance, retreat cost, illustrator, and regulation mark returned by PokéWallet. pokeScan requires a configured API key or proxy and never returns built-in mock results.

## Supabase dashboard

Set the development project URL and publishable/anon key in `.env`:

```bash
EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY=replace_with_your_publishable_or_anon_key
```

Install the React Native Supabase dependencies and rebuild the development app:

```bash
npx expo install @supabase/supabase-js @react-native-async-storage/async-storage react-native-url-polyfill
npx expo run:ios --device
```

Enable Row Level Security on `profiles` and `scanned_cards`. Policies for `scanned_cards` should restrict reads and writes to `auth.uid() = user_id`; client-side `.eq('user_id', userId)` filtering is not a security boundary.

The database migration is included at `supabase/migrations/202608150001_create_dashboard_tables.sql`. Link this repository to your Supabase project once, then push it:

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npm run supabase:push
```

Your project reference is the identifier in the Supabase dashboard URL. Subsequent database migrations only require `npm run supabase:push`.

## Reusable OCR matcher

[`src/services/card-matcher.ts`](src/services/card-matcher.ts) exports pure, unit-testable OCR cleanup, parsing, query-building, Levenshtein similarity, scoring, and confidence functions. It also provides a complete PokéWallet search orchestrator:

```ts
import { findBestPokeWalletMatch } from './src/services/card-matcher';

const result = await findBestPokeWalletMatch(rawOCRText, {
  apiKey: process.env.EXPO_PUBLIC_POKEWALLET_API_KEY ?? '',
  limit: 10,
  minimumScore: 35,
  // Native spatial OCR fields can override text-only guesses:
  hints: { name: 'Mareep', cardNumber: '027/086', hp: '70' },
});

console.log(result.bestMatch);
console.log(result.topCandidates);
console.log(result.confidence);
console.log(result.extractedFields);
console.log(result.rawQuery);
```

For an App Store build, call PokéWallet through the configured server proxy instead of embedding a private production key in the application bundle.
