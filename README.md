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

## Preview on an iPhone with Expo Go

This runs the complete interface and demo scan. Apple Vision OCR is not available inside Expo Go.

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

The proxy must attach the private `X-API-Key` header and pass through `/search`, `/cards/:id`, and `/images/:id`. It must preserve query strings and image content types. Without an API key or proxy URL, pokeScan uses its built-in demo results.
