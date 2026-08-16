# NicePull

**Know what you've pulled.**

## RevenueCat NicePull Pro setup

RevenueCat controls purchasing, restoration, the hosted paywall, and Customer
Center. Supabase stores a convenient mirror of the active entitlement; the app
only unlocks Pro after RevenueCat returns an active entitlement.

### RevenueCat dashboard

1. Create an entitlement whose **identifier** is exactly `NicePull Pro`.
   Identifiers are case-sensitive. If you choose another identifier, set
   `EXPO_PUBLIC_REVENUECAT_ENTITLEMENT_ID` to the exact value.
2. Create/import these products and attach all of them to that entitlement:

   | Product ID | Store type | RevenueCat package |
   | --- | --- | --- |
   | `lifetime` | Non-consumable / one-time | Lifetime |
   | `yearly` | Auto-renewing subscription | Annual |
   | `monthly` | Auto-renewing subscription | Monthly |

3. Put the products in one Offering and mark it **Current**.
4. Build and publish a Paywall for the current Offering. The app opens this
   remotely managed paywall, so pricing and presentation do not need app code.
5. Configure Customer Center if the RevenueCat project is on a plan that supports
   it. NicePull shows it to active Pro users for subscription management.

The App Store and Play Console—not application code—set prices. Configure the
Lifetime product at $9.99 there, and choose the desired Monthly/Yearly prices.

### Local Test Store

The provided `test_...` key is a **RevenueCat Test Store public SDK key**, not a
production key. It simulates success, cancellation, and errors without StoreKit
or Google Play. Local `.env` uses it only when both conditions are true:

```dotenv
EXPO_PUBLIC_REVENUECAT_USE_TEST_STORE=true
EXPO_PUBLIC_REVENUECAT_TEST_API_KEY=test_your_test_store_key
EXPO_PUBLIC_REVENUECAT_ENTITLEMENT_ID=NicePull Pro
```

The code additionally requires React Native's `__DEV__` flag, so a release build
cannot select the Test Store key. Create the three Test Store products, entitlement,
current Offering, and Paywall in RevenueCat before testing.

### Apple/Google sandbox and production

To test actual store integration, turn Test Store off and provide each app's
public RevenueCat SDK key:

```dotenv
EXPO_PUBLIC_REVENUECAT_USE_TEST_STORE=false
EXPO_PUBLIC_REVENUECAT_IOS_API_KEY=appl_your_public_sdk_key
EXPO_PUBLIC_REVENUECAT_ANDROID_API_KEY=goog_your_public_sdk_key
EXPO_PUBLIC_REVENUECAT_ENTITLEMENT_ID=NicePull Pro
```

Run the database migration and rebuild the native app after installing or updating
either RevenueCat native package:

```bash
npm install
npm run supabase:push
npx expo run:ios --device
# Android: npx expo run:android --device
```

Expo Go is not enough for native purchasing UI. Use an Expo development build,
TestFlight/App Store sandbox, or a Play internal-testing build. Before shipping,
set production environment variables in EAS and omit the Test Store key entirely.

`useEntitlements()` exposes `isPro`, `getCustomerInfo`, `presentPaywall`,
`restorePurchases`, and `presentCustomerCenter`. The app uses the signed-in
Supabase UUID as RevenueCat's App User ID, preventing anonymous purchases from
being mixed between NicePull accounts.

## Smart Trade Builder (Pro)

The Trade tab is protected by `FeatureGate` and the `smart_trade_builder`
feature key. Active NicePull Pro customers can add multiple collection cards to
Giving and Receiving, change each card's condition, compare adjusted totals, and
request balance suggestions from available collection copies.

Condition multipliers live in `public.conditions.value_multiplier`, not in the
mobile UI. Apply the migration before using the builder:

```bash
npm run supabase:push
```

Current seeded values are NM 1.000, LP 0.875, MP 0.725, HP 0.550, and DMG 0.350.
Admins can update these values in Supabase and the cached card-option hook will
refresh the app without a mobile release.

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

NicePull does not return mock OCR, cards, or prices. Live frames run through VisionCamera v5 and its Nitro-powered on-device OCR pipeline. The app waits for the same card name and collector number across three stable reads, captures a three-photo full-resolution burst, finishes all local OCR, and only then sends the strongest merged identifiers to PokéWallet.

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

Open the installed **NicePull development build**, not Expo Go. Point the camera at a card and align every edge within the frame from roughly 12–18 inches away. A moving cyan beam shows that live OCR is active, while the status gives distance, stability, tilt, and glare guidance. NicePull proceeds only after three reads agree on both the card name and bottom collector number. No shutter press is required; the manual shutter unlocks when the same positioning gate passes. NicePull will:

1. Capture three real full-resolution camera images.
2. Detect the card rectangle and use Core Image perspective correction to flatten and crop it.
3. Run accurate full-card, title-band, bottom-25%, and tight collector-strip OCR passes.
4. Score all frames, strongly preferring set code plus full collector number, and merge non-conflicting clues.
5. Build cascading queries locally, then make the first PokéWallet request.
6. Display the returned images, details, and prices.

The OCR layer includes targeted correction for Pokémon TCG suffixes such as `ex`, `GX`, `VMAX`, and `VSTAR`, plus collector-number character corrections. Collector numbers remain mandatory for automatic capture. If the title or bottom number is unreadable, auto-scan keeps gathering frames instead of sending a weak query. After capture, scanning proceeds to ranked results. Candidates receive evidence points for the bottom identifier, set and collector number, full number/total, name similarity, set, HP, card category, type, rarity, stage, regulation mark, attacks, abilities, evolution text, description words, and damage values. Conflicting identifiers subtract points, and PokéWallet result order or artwork never adds points.

If `.env` is missing, the API key is rejected, OCR cannot read the card, or PokéWallet returns an error, NicePull displays the real error instead of fallback data.

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

The proxy must attach the private `X-API-Key` header and pass through `/search`, `/cards/:id`, and `/images/:id`. It must preserve query strings and image content types. Card details display available evolution lineage, abilities, attacks, weakness, resistance, retreat cost, illustrator, and regulation mark returned by PokéWallet. NicePull requires a configured API key or proxy and never returns built-in mock results.

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

### Collection and Pro entitlements

The Collection screen uses server-backed search, pagination, set/rarity filters,
portfolio statistics, and quantity-aware values. Apply the latest metadata fields
with `npm run supabase:push` before running this version against an existing project.

Pro features are locked by default through `src/hooks/useEntitlements.ts`. Screens
should call `canUse(feature)` instead of checking purchase providers directly. The
hook exposes placeholders for eligibility checks and restoring purchases so a
verified App Store or RevenueCat implementation can be added without refactoring
feature screens.

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
