// Prévia pública de 30s de uma faixa (iTunes Search API; Deezer como reserva). Nenhuma chamada ao Spotify.

// Normaliza pra comparar nome de artista/faixa sem bater na cabeça com acento, maiúscula ou
// "feat./remix/ao vivo" entre parênteses — sem isso, o 1º resultado de uma busca por texto pode vir de
// uma faixa errada (cover, remix, artista homônimo).
const norm = (s) => String(s ?? '').normalize('NFKD').replace(/\p{M}/gu, '').replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9]+/gi, ' ').trim().toLowerCase();
const matches = (wantArtist, wantTrack, gotArtist, gotTrack) => {
  const a = norm(wantArtist), t = norm(wantTrack), ga = norm(gotArtist), gt = norm(gotTrack);
  return a && t && ga && gt && (ga.includes(a) || a.includes(ga)) && (gt.includes(t) || t.includes(gt));
};

// Prévia pública de 30s da faixa: iTunes Search API primeiro (sem restrição de uso comercial, feita
// para apps de terceiros embutirem preview), Deezer como reserva (uso pessoal, com atribuição). Nenhuma
// chamada ao Spotify. Confere artista e faixa do resultado antes de aceitar (evita cover/remix errado).
// Devolve { bytes, ext } ou null se não achar em nenhuma das duas.
export async function previewAudio(artist, track) {
  const q = `${artist} ${track}`.trim();
  if (!q) return null;
  try {
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=music&entity=song&limit=5`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const hit = (data.results || []).find((r) => r.previewUrl && matches(artist, track, r.artistName, r.trackName));
    if (hit) {
      const audio = await fetch(hit.previewUrl);
      if (!audio.ok) throw new Error(`baixar prévia: HTTP ${audio.status}`);
      return { bytes: new Uint8Array(await audio.arrayBuffer()), ext: 'm4a' };
    }
    console.error(`iTunes (prévia de áudio): nenhum resultado bate com "${artist} — ${track}".`);
  } catch (e) {
    console.error(`iTunes (prévia de áudio): ${e.message}`);
  }
  try {
    const url = `https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=5`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const hit = (data.data || []).find((r) => r.preview && matches(artist, track, r.artist && r.artist.name, r.title));
    if (hit) {
      const audio = await fetch(hit.preview);
      if (!audio.ok) throw new Error(`baixar prévia: HTTP ${audio.status}`);
      return { bytes: new Uint8Array(await audio.arrayBuffer()), ext: 'mp3' };
    }
    console.error(`Deezer (prévia de áudio): nenhum resultado bate com "${artist} — ${track}".`);
  } catch (e) {
    console.error(`Deezer (prévia de áudio): ${e.message}`);
  }
  console.error('nenhuma prévia de áudio disponível (iTunes e Deezer); vídeo sem som.');
  return null;
}
