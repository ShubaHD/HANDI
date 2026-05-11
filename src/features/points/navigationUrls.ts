/** Deschide navigarea rutieră către coordonate (Google Maps). */
export function googleMapsDirectionsUrl(lat: number, lon: number): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(String(lat))},${encodeURIComponent(String(lon))}`;
}

/** Link „Hărți” Apple (folositor pe iPhone). */
export function appleMapsDirectionsUrl(lat: number, lon: number): string {
  return `https://maps.apple.com/?daddr=${encodeURIComponent(String(lat))},${encodeURIComponent(String(lon))}`;
}
