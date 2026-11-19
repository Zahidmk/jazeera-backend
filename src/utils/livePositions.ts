/**
 * Latest phone-reported position per user, kept in memory.
 *
 * The merchandiser app reports where it is every ~30 s while the user is checked in (POST
 * /merchandiser/location). That feeds the team map and the dashboard live map between the
 * recorded events (check-in, visit start...). Deliberately not stored in the database: it is
 * only meaningful for a few minutes, and a restart simply refills within one reporting interval.
 */
export interface LivePosition {
  lat: number;
  lng: number;
  accuracy: number | null;
  at: Date;
}

const positions = new Map<string, LivePosition>();
const MAX_AGE_MS = 12 * 60 * 60 * 1000;

export function recordLivePosition(userId: string, lat: number, lng: number, accuracy: number | null): void {
  positions.set(userId, { lat, lng, accuracy, at: new Date() });
  if (positions.size > 2000) {
    const cutoff = Date.now() - MAX_AGE_MS;
    for (const [id, p] of positions) if (p.at.getTime() < cutoff) positions.delete(id);
  }
}

/** The user's latest reported position if it is at most `maxAgeMs` old. */
export function getLivePosition(userId: string, maxAgeMs: number): LivePosition | null {
  const p = positions.get(userId);
  return p && Date.now() - p.at.getTime() <= maxAgeMs ? p : null;
}
