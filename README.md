# pokeScan

A React Native Pokémon card scanner that uses Apple Vision OCR on iOS and PokéWallet for card matching, images, details, and pricing.

## Environment setup

Install dependencies and create your local environment file:

```bash
npm install
cp .env.example .env
```

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

pokeScan does not return mock OCR, cards, or prices. A camera capture must run through the native Apple Vision module, and the extracted card name and collector number are sent to the configured PokéWallet API.

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

Open the installed **pokeScan development build**, not Expo Go. Point the camera at a card and align it within the frame. Once the camera is ready, pokeScan waits briefly for autofocus and captures automatically; no shutter press is required. The shutter remains available as a manual retry after an unsuccessful scan. pokeScan will:

1. Capture the real camera image.
2. Extract text locally with Apple Vision.
3. Build a search query from the card name and collector number.
4. Request live matches from PokéWallet.
5. Display the returned images, details, and prices.

The OCR layer includes Pokémon TCG terminology such as `ex`, `GX`, `VMAX`, and `VSTAR`, plus targeted correction for stylized suffixes and collector-number characters. Apple Vision returns the position of every text box, so pokeScan prioritizes text near the top for the card name and text near the bottom for the collector number and set code. It tries progressively broader searches when an exact query has no results, then reranks matches using the detected number, name, set, HP, rarity, attacks, and matching description words. For best results, fill most of the guide frame with the card, keep both the top name and bottom collector number sharp, and tilt the card slightly if a foil surface creates glare.

If `.env` is missing, the API key is rejected, Apple Vision cannot read the card, or PokéWallet returns an error, pokeScan displays the real error instead of fallback data.

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

This previews the interface, but Apple Vision OCR is not available inside Expo Go. Pressing the camera shutter in Expo Go will show an instruction to install a development build; it never returns mock card data.

```bash
npx expo start --clear
```

Install Expo Go on the iPhone and scan the QR code displayed in the terminal.

## iOS development build on macOS

A Mac with Xcode is required to compile iOS locally. This native development build enables Apple Vision OCR.

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
