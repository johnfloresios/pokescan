# pokeScan

A polished React Native card scanner that uses Apple Vision OCR on iOS and PokéWallet for Pokémon card matching, images, details, and pricing.

## Run

```bash
npm install
npx expo prebuild --platform ios
npx expo run:ios
```

Apple Vision runs in a development build (not Expo Go). Expo Go uses a Pikachu demo scan so every screen can still be previewed.

## PokéWallet configuration

PokéWallet requires an API key. The safest production setup is a server proxy that attaches `X-API-Key`; set `EXPO_PUBLIC_POKEWALLET_PROXY_URL` to that proxy. For local development only, `EXPO_PUBLIC_POKEWALLET_API_KEY` is supported. Without either value, the app runs with realistic demo results.

The proxy should pass through `/search`, `/cards/:id`, and `/images/:id`, preserving query strings and content types.
# pokescan
