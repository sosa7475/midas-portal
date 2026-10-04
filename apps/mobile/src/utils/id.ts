// Lightweight, dependency-free unique ID for local message keys.
// Avoids `uuid`, which requires a crypto.getRandomValues polyfill not
// present in the Expo/React Native runtime by default.
let counter = 0;
export function genId(): string {
  counter = (counter + 1) % 1_000_000;
  return `${Date.now().toString(36)}-${counter.toString(36)}-${Math.floor(Math.random() * 1e9).toString(36)}`;
}
