// Letras via LRCLIB (https://lrclib.net). Formato conferido contra a resposta real:
//  - GET /api/get?artist_name=&track_name=[&album_name=] -> 200 com
//    { id, trackName, artistName, albumName, duration (segundos), instrumental,
//      plainLyrics, syncedLyrics, ... }; duration e album_name são opcionais na prática;
//  - faixa inexistente -> 404 com { name: "TrackNotFound", message, statusCode }.

const BASE = 'https://lrclib.net/api/get';
const HEADERS = { 'User-Agent': 'myJAMrobot (https://github.com/romastefale/tr5)' };

function queryString(params) {
  return Object.keys(params)
    .map((k) => `${k}=${encodeURIComponent(params[k])}`)
    .join('&');
}

// Uma consulta. Devolve o corpo (200), null (404) ou lança (5xx, corpo inválido, erro de rede).
async function lookup(params, fetchImpl) {
  const res = await fetchImpl(`${BASE}?${queryString(params)}`, { headers: HEADERS });
  if (res.status === 404) return null;
  let body;
  try {
    body = await res.json();
  } catch {
    throw new Error('Resposta inválida do LRCLIB');
  }
  if (!res.ok) throw new Error(`LRCLIB respondeu ${res.status}`);
  return body;
}

// Devolve { plain, instrumental } ou null quando não há letra.
//
// Medido no runtime real: o LRCLIB responde 503 "ServerOverloaded" às vezes ("retry in a moment"),
// e o isolate NÃO tem setTimeout, então não dá para esperar. Em vez de repetir a mesma chamada
// na hora, alterna as variantes (com álbum, sem álbum, com álbum) — até 3 tentativas, com o
// intervalo natural das respostas. 404 sem o álbum = a letra realmente não existe.
export async function getLyrics({ artist, track, album }, fetchImpl) {
  const base = { artist_name: artist, track_name: track };
  const withAlbum = album ? { ...base, album_name: album } : base;
  const variants = album ? [withAlbum, base, withAlbum] : [base, base, base];
  let lastError = null;
  for (const params of variants) {
    let body;
    try {
      body = await lookup(params, fetchImpl);
    } catch (e) {
      lastError = e;
      continue;
    }
    if (body) return { plain: body.plainLyrics || '', instrumental: !!body.instrumental };
    if (params === base) return null; // 404 sem o álbum: não existe
  }
  if (lastError) throw lastError;
  return null;
}

// Trecho para o /tly: o refrão. Letras do LRCLIB separam estrofes por linha em branco, e o refrão é a
// estrofe que mais se repete. Ordem de escolha:
//  1. a estrofe repetida (comparada sem pontuação/caixa) que mais aparece, com ao menos 2 linhas;
//     empate: a que aparece primeiro;
//  2. sem estrofe repetida (refrão no meio de estrofes maiores): o bloco de 2 a 4 linhas seguidas que
//     se repete, preferindo o maior e depois o que mais aparece;
//  3. nada se repete: a primeira estrofe.
// Linhas só de marcação, como "[Refrão]", não entram.
const norm = (text) => text.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
const isTag = (line) => /^\[[^\]]*\]$/.test(line);

export function lyricSnippet(plain, maxLines = 8, maxChars = 700) {
  const blocks = String(plain || '')
    .split(/\r?\n\s*\r?\n/)
    .map((b) => b.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !isTag(l)))
    .filter((b) => b.length > 0);
  if (!blocks.length) return '';
  let lines = null;

  const seen = new Map(); // chave da estrofe -> { count, first }
  blocks.forEach((b, i) => {
    if (b.length < 2) return;
    const key = norm(b.join(' '));
    const cur = seen.get(key) || { count: 0, first: i };
    cur.count += 1;
    seen.set(key, cur);
  });
  let best = null;
  for (const v of seen.values()) {
    if (v.count >= 2 && (!best || v.count > best.count || (v.count === best.count && v.first < best.first))) best = v;
  }
  if (best) lines = blocks[best.first];

  if (!lines) {
    const all = blocks.flat();
    const keys = all.map(norm);
    for (let size = 4; size >= 2 && !lines; size--) {
      const count = new Map();
      for (let i = 0; i + size <= all.length; i++) {
        const key = keys.slice(i, i + size).join(' ');
        if (key.trim()) count.set(key, (count.get(key) || 0) + 1);
      }
      let pick = null;
      for (let i = 0; i + size <= all.length; i++) {
        const n = count.get(keys.slice(i, i + size).join(' '));
        if (n >= 2 && (!pick || n > pick.n)) pick = { n, at: i };
      }
      if (pick) lines = all.slice(pick.at, pick.at + size);
    }
  }

  if (!lines) {
    lines = blocks[0];
    if (lines.length < 3 && blocks[1]) lines = lines.concat(blocks[1]); // estrofe curtíssima: junta a seguinte
  }
  let out = lines.slice(0, maxLines).join('\n');
  if (out.length > maxChars) out = out.slice(0, maxChars - 1).trimEnd() + '…';
  return out;
}
