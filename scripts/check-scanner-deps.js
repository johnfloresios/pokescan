const required = [
  'react-native-vision-camera',
  'react-native-nitro-modules',
  'react-native-nitro-image',
  'react-native-vision-camera-ocr-plus',
  'react-native-vision-camera-worklets',
  'react-native-worklets',
];

const missing = required.filter((name) => {
  try {
    require.resolve(name);
    return false;
  } catch {
    return true;
  }
});

if (missing.length) {
  console.error(`\nMissing scanner dependencies:\n  ${missing.join('\n  ')}\n\nRun npm install before starting Expo.\n`);
  process.exitCode = 1;
} else {
  console.log('VisionCamera and Nitro scanner dependencies are installed.');
}
