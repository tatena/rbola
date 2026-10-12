// card-face placeholders shared by the garage and the race result, so one
// card reads the same everywhere

// placeholder until reverse geocoding lands — GPS catches read as Tbilisi,
// the rest get a stable pseudo-random city per card
const CITIES = [
  "BERLIN",
  "MIAMI",
  "MONACO",
  "GOODWOOD",
  "TOKYO",
  "LONDON",
  "DUBAI",
  "MILAN",
];
export function placeFor(gps: boolean, seed: string) {
  if (gps) return "TBILISI";
  let h = 2166136261;
  for (const ch of seed) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return CITIES[Math.abs(h) % CITIES.length];
}

export const cardNumber = (assetId: string) =>
  `#${assetId.slice(-4).toUpperCase()}`;
