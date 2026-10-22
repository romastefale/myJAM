// Cliente da API pública do Last.fm. `fetch` é injetado (o do SDK, em produção).
//
// Os formatos abaixo foram conferidos contra respostas REAIS (scripts/probe-apis.mjs):
//  - valores numéricos vêm como string ("playcount": "168");
//  - nomes de artista/álbum nas faixas recentes ficam em ["#text"];
//  - erro volta como { error: <código>, message } (usuário inexistente = HTTP 404, error 6);
//  - um `period` inválido NÃO dá erro (devolve o ranking geral), por isso é validado aqui;
//  - a imagem placeholder do Last.fm (sem capa) tem sempre o mesmo arquivo.

import { fetchRetry } from './http.js';

const BASE = 'https://ws.audioscrobbler.com/2.0/';

export const PERIODS = ['7day', '1month', '3month', '6month', '12month', 'overall'];
const PLACEHOLDER_IMAGE = '2a96cbd8b46e442fc41c2b86b821562f';

// Introdução da API (last.fm/api/intro): "use um User-Agent identificável em todas as requisições".
const USER_AGENT = 'myJAMrobot/1.0 (Telegram bot; https://t.me/myJAMrobot)';

// Códigos de erro (last.fm/api/errorcodes) que a própria documentação manda tentar de novo:
// 8 (falha do backend), 11 (serviço fora do ar, tente depois) e 16 (erro temporário).
const RETRY_CODES = [8, 11, 16];
// 29 = limite de requisições excedido; 26 = chave suspensa. Nenhum dos dois se resolve repetindo.
export const STOP_CODES = [26, 29];

export class LastfmError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'LastfmError';
    this.code = code;
  }
}

const toArray = (v) => (Array.isArray(v) ? v : v ? [v] : []);

// O Last.fm só informa capas de até 300x300, e o Telegram mostra a imagem no tamanho que ela tem:
// um quadro com 300 px não ocupa a largura do balão. O CDN entrega a mesma capa em 770x0 (medido no
// runtime real: 770x770 JPEG, ~108 KB) pelo mesmo hash; ela vai primeiro, e as da API ficam de reserva.
const CDN_COVER = /^(https:\/\/[^/]+\/i\/u\/)(?:[^/]+\/)?([0-9a-f]{32})\.(\w+)$/;
// Versões 770x0 da mesma capa: .jpg (a menor) e a no formato original; nem todo álbum tem a .jpg.
const largeCovers = (url) => {
  const m = CDN_COVER.exec(url);
  return m ? [`${m[1]}770x0/${m[2]}.jpg`, `${m[1]}770x0/${m[2]}.${m[3]}`] : [];
};

// Capas da maior para a menor (a lista do Last.fm vem do menor para o maior), sem o placeholder.
function coversOf(images) {
  const list = toArray(images);
  const urls = [];
  for (let i = list.length - 1; i >= 0; i--) {
    const url = list[i] && list[i]['#text'];
    if (url && !url.includes(PLACEHOLDER_IMAGE) && !urls.includes(url)) urls.push(url);
  }
  const large = urls.length ? largeCovers(urls[0]).filter((u, i, a) => a.indexOf(u) === i && !urls.includes(u)) : [];
  return [...large, ...urls];
}
const coverOf = (images) => coversOf(images)[0] || null;

function queryString(params) {
  return Object.keys(params)
    .map((k) => `${k}=${encodeURIComponent(params[k])}`)
    .join('&');
}

async function request(method, params, apiKey, fetchImpl) {
  const qs = queryString({ ...params, method, api_key: apiKey, format: 'json' });
  const options = { headers: { 'User-Agent': USER_AGENT } };
  for (let attempt = 1; ; attempt++) {
    const res = await fetchRetry(fetchImpl, `${BASE}?${qs}`, options);
    let body;
    try {
      body = await res.json();
    } catch {
      throw new LastfmError('Resposta inválida do Last.fm', -1);
    }
    if (body && body.error) {
      if (attempt < 2 && RETRY_CODES.includes(Number(body.error))) continue;
      throw new LastfmError(body.message || 'Erro do Last.fm', body.error);
    }
    if (!res.ok) throw new LastfmError(`Last.fm respondeu ${res.status}`, res.status);
    return body;
  }
}

// Converte a resposta crua em { name, artist, album, image, url, nowPlaying, playedAt } ou null.
export function parseRecentTrack(body) {
  const track = toArray(body && body.recenttracks && body.recenttracks.track)[0];
  if (!track) return null;
  const attr = track['@attr'];
  const uts = track.date && Number(track.date.uts);
  return {
    name: track.name || '',
    artist: (track.artist && (track.artist['#text'] || track.artist.name)) || '',
    album: (track.album && track.album['#text']) || '',
    image: coverOf(track.image),
    covers: coversOf(track.image),
    url: track.url || null,
    nowPlaying: !!(attr && String(attr.nowplaying) === 'true'),
    playedAt: Number.isFinite(uts) && uts > 0 ? uts : null,
  };
}

export async function getRecentTrack(username, apiKey, fetchImpl) {
  const body = await request('user.getrecenttracks', { user: username, limit: '1' }, apiKey, fetchImpl);
  return parseRecentTrack(body);
}

const TOP = {
  tracks: { method: 'user.gettoptracks', root: 'toptracks', item: 'track' },
  artists: { method: 'user.gettopartists', root: 'topartists', item: 'artist' },
  albums: { method: 'user.gettopalbums', root: 'topalbums', item: 'album' },
};

// kind: 'tracks' | 'artists' | 'albums'. Devolve [{ name, artist, plays, url, image }].
export async function getTop(kind, username, period, limit, apiKey, fetchImpl) {
  const def = TOP[kind];
  if (!def) throw new LastfmError(`Tipo de ranking inválido: ${kind}`, -2);
  if (!PERIODS.includes(period)) throw new LastfmError(`Período inválido: ${period}`, -2);
  const body = await request(def.method, { user: username, period, limit: String(limit) }, apiKey, fetchImpl);
  return toArray(body[def.root] && body[def.root][def.item]).map((it) => ({
    name: it.name || '',
    artist: kind === 'artists' ? null : (it.artist && (it.artist.name || it.artist['#text'])) || '',
    plays: Number(it.playcount) || 0,
    url: it.url || null,
    image: coverOf(it.image),
    covers: coversOf(it.image),
  }));
}

// { name, artist, plays, listeners, image, tracks: [nome] } ou null se o álbum não existir.
export async function getAlbumInfo(artist, album, apiKey, fetchImpl) {
  let body;
  try {
    body = await request('album.getinfo', { artist, album }, apiKey, fetchImpl);
  } catch (e) {
    if (e instanceof LastfmError && e.code === 6) return null; // álbum não encontrado
    throw e;
  }
  const a = body && body.album;
  if (!a) return null;
  return {
    name: a.name || album,
    artist: a.artist || artist,
    plays: Number(a.playcount) || 0,
    listeners: Number(a.listeners) || 0,
    image: coverOf(a.image),
    covers: coversOf(a.image),
    tracks: toArray(a.tracks && a.tracks.track).map((t) => t.name || ''),
  };
}

// Reproduções do próprio usuário numa faixa (track.getInfo + username → `userplaycount`, string).
// Conferido na resposta real: o campo vem sempre que o usuário existe; sem ele (ou com a faixa
// desconhecida, HTTP 200 + error 6) devolve null. Qualquer falha também vira null: a contagem é
// um enfeite e não pode derrubar o comando.
export async function getUserTrackPlays(artist, track, username, apiKey, fetchImpl) {
  try {
    const body = await request('track.getinfo', { artist, track, username, autocorrect: '1' }, apiKey, fetchImpl);
    const raw = body && body.track && body.track.userplaycount;
    const n = Number(raw);
    return raw !== undefined && raw !== '' && Number.isFinite(n) ? n : null;
  } catch (e) {
    if (e instanceof LastfmError && STOP_CODES.includes(Number(e.code))) throw e;
    console.error(e);
    return null;
  }
}

// track.search: [{ name, artist }] (as faixas mais prováveis para o termo livre).
export async function searchTracks(term, limit, apiKey, fetchImpl) {
  const body = await request('track.search', { track: term, limit: String(limit) }, apiKey, fetchImpl);
  const found = body && body.results && body.results.trackmatches && body.results.trackmatches.track;
  return toArray(found)
    .map((t) => ({ name: t.name || '', artist: (typeof t.artist === 'string' ? t.artist : t.artist && t.artist.name) || '' }))
    .filter((t) => t.name && t.artist);
}

// track.getInfo com nome canônico (autocorrect), capas do álbum e, se `username` vier, as
// reproduções dele. null se a faixa não existir (error 6).
export async function getTrackInfo(artist, track, username, apiKey, fetchImpl) {
  const params = { artist, track, autocorrect: '1' };
  if (username) params.username = username;
  let body;
  try {
    body = await request('track.getinfo', params, apiKey, fetchImpl);
  } catch (e) {
    if (e instanceof LastfmError && e.code === 6) return null;
    throw e;
  }
  const t = body && body.track;
  if (!t) return null;
  const n = Number(t.userplaycount);
  return {
    name: t.name || track,
    artist: (t.artist && (t.artist.name || t.artist['#text'])) || artist,
    album: (t.album && t.album.title) || '',
    covers: coversOf(t.album && t.album.image),
    plays: t.userplaycount !== undefined && t.userplaycount !== '' && Number.isFinite(n) ? n : null,
  };
}

// Capas (maior primeiro) do álbum mais ouvido do artista (artist.getTopAlbums): serve de capa para
// quadros que não têm uma faixa. null se não houver álbum com capa.
export async function getArtistAlbumCovers(artist, apiKey, fetchImpl) {
  const body = await request('artist.gettopalbums', { artist, limit: '5', autocorrect: '1' }, apiKey, fetchImpl);
  const albums = toArray(body && body.topalbums && body.topalbums.album);
  for (const a of albums) {
    const covers = coversOf(a.image);
    if (a.name && a.name !== '(null)' && covers.length) return covers;
  }
  return null;
}
