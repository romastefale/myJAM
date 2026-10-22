// Letra de uma faixa: cache no banco primeiro, LRCLIB depois (e grava no cache).
import { getLyrics } from './lyrics.js';
import { getCachedLyrics, cacheLyrics, lyricsKey } from './store.js';

// Só do cache (sem rede). Devolve { plain, instrumental } ou null.
export async function cachedLyricsFor(track) {
  const row = await getCachedLyrics(lyricsKey(track.artist, track.name));
  return row ? { plain: row.plain, instrumental: row.instrumental } : null;
}

// Cache, senão rede. null = não existe letra (não é gravado: pode aparecer depois).
export async function lyricsFor(track, fetchImpl) {
  const cached = await cachedLyricsFor(track);
  if (cached) return cached;
  const found = await getLyrics({ artist: track.artist, track: track.name, album: track.album }, fetchImpl);
  if (found) await cacheLyrics(lyricsKey(track.artist, track.name), found);
  return found;
}
