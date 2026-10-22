// Quadros compartilhados entre os comandos do grupo e as versões universais do dono.
// Cada função devolve { html, covers } (mensagem rica com tabela; `covers` = capa do topo, pode ser vazia)
// ou { notice } (texto de aviso para a pessoa).
import { fetch } from 'sdk';
import { LASTFM_API_KEY } from './config.js';
import { getRecentTrack, getTop, getUserTrackPlays, getArtistAlbumCovers, LastfmError, STOP_CODES, PERIODS } from './lastfm.js';
import { typing } from './telegram.js';
import {
  richTable, playsText, escapeHtml, cut, PERIOD_LABEL, timeTag,
  link as anchor, mention, mentionUser, lfmArtist, lfmAlbum, lfmTrack,
} from './format.js';

export const LFM_DOWN = 'Não consegui consultar o Last.fm agora. Tente de novo em instantes.';
// Códigos da página de erros do Last.fm: 29 = limite de requisições, 26 = chave suspensa.
export function lfmDown(e) {
  const code = e instanceof LastfmError ? Number(e.code) : 0;
  if (code === 29) return 'O Last.fm limitou as requisições por um momento. Tente de novo em instantes.';
  if (code === 26) return 'O Last.fm suspendeu a chave de acesso do bot. O dono precisa resolver isso com o Last.fm.';
  return LFM_DOWN;
}
export const isStop = (e) => e instanceof LastfmError && STOP_CODES.includes(Number(e.code));
export const validPeriod = (p) => PERIODS.includes(p);

// O que cada membro está ouvindo. A capa é a da faixa que está tocando (ou da mais recente). members: [{ userId, name, lastfmUser }]; masks: Map id -> rótulo
// (/tpv): a pessoa mascarada aparece só com o rótulo, sem menção.
export async function listenersBoard(chatId, members, masks, title) {
  await typing(chatId);
  const results = [];
  let stopped = null;
  for (const m of members) { // em série (moderação pedida pelo Last.fm); para ao receber 29/26
    try {
      const track = await getRecentTrack(m.lastfmUser, LASTFM_API_KEY, fetch);
      const mine = track ? await getUserTrackPlays(track.artist, track.name, m.lastfmUser, LASTFM_API_KEY, fetch) : null;
      results.push({ m, track, mine });
    } catch (e) {
      console.error(e);
      if (isStop(e)) { stopped = e; break; }
      results.push({ m, track: null, mine: null });
    }
  }
  const withTrack = results.filter((r) => r.track);
  if (!withTrack.length) return { notice: stopped ? lfmDown(stopped) : 'Nenhum ouvinte com histórico no Last.fm.' };
  const who = (m) => (masks.has(m.userId) ? escapeHtml(cut(masks.get(m.userId), 40)) : mention(m.userId, m.name));
  const item = ({ m, track, mine }) =>
    `<li>${who(m)} — ${anchor(lfmTrack(track.artist, track.name), escapeHtml(cut(track.name, 60)))} · ` +
    `<i>${anchor(lfmArtist(track.artist), escapeHtml(cut(track.artist, 40)))}</i>${playsText(mine) ? ` ${playsText(mine)}` : ''}</li>`;
  const now = withTrack.filter((r) => r.track.nowPlaying);
  const before = withTrack.filter((r) => !r.track.nowPlaying).sort((a, b) => (b.track.playedAt || 0) - (a.track.playedAt || 0));
  let html = `<h2>${title}</h2>`;
  if (now.length) html += `<h3>♫ tocando agora</h3><ul>${now.map(item).join('')}</ul>`;
  if (before.length) {
    html += '<h3>Últimas faixas</h3><ul>' + before.map((r) =>
      item(r).replace('</li>', r.track.playedAt ? ` ${timeTag(r.track.playedAt)}</li>` : '</li>')).join('') + '</ul>';
  }
  const withCover = [...now, ...before].find((r) => r.track.covers && r.track.covers.length);
  return { html, covers: withCover ? withCover.track.covers : [] };
}

// Artistas mais ouvidos somando os membros. `scope` aparece no subtítulo ("3 membros", "3 ouvintes").
export async function chartsBoard(chatId, members, period, title, noun = 'membro') {
  await typing(chatId);
  const lists = [];
  let stopped = null;
  for (const m of members) { // em série (moderação pedida pelo Last.fm); para ao receber 29/26
    try {
      lists.push(await getTop('artists', m.lastfmUser, period, 50, LASTFM_API_KEY, fetch));
    } catch (e) {
      console.error(e);
      if (isStop(e)) { stopped = e; break; }
    }
  }
  const total = new Map(); // nome (minúsculo) -> { name, plays, listeners }
  for (const list of lists) {
    for (const a of list) {
      const k = a.name.toLowerCase();
      const cur = total.get(k) || { name: a.name, plays: 0, listeners: 0 };
      cur.plays += a.plays;
      cur.listeners += 1;
      total.set(k, cur);
    }
  }
  const ranking = [...total.values()].sort((a, b) => b.plays - a.plays).slice(0, 10);
  if (!ranking.length) return { notice: stopped ? lfmDown(stopped) : `Sem reproduções ${PERIOD_LABEL[period]}.` };
  let covers = [];
  try {
    covers = (await getArtistAlbumCovers(ranking[0].name, LASTFM_API_KEY, fetch)) || [];
  } catch (e) {
    console.error(e);
    if (isStop(e)) return { notice: lfmDown(e) };
  }
  const table = richTable(
    [{ text: '#' }, { text: 'Artista' }, { text: '♫ plays', right: true }, { text: 'Ouvintes', right: true }],
    ranking.map((a, i) => [String(i + 1), anchor(lfmArtist(a.name), escapeHtml(cut(a.name, 60))), String(a.plays), String(a.listeners)]));
  return { html: `<h2>${title}</h2><p>${PERIOD_LABEL[period]} · ${members.length} ${noun}${members.length > 1 ? 's' : ''}</p>${table}`, covers };
}

// Mais ouvidos (artistas, faixas, álbuns) de uma pessoa: /weekfm, /monthfm e o /myself.
export async function rankBoard(chatId, user, lastfmUser, period) {
  await typing(chatId);
  let artists, tracks, albums;
  try {
    artists = await getTop('artists', lastfmUser, period, 5, LASTFM_API_KEY, fetch);
    tracks = await getTop('tracks', lastfmUser, period, 5, LASTFM_API_KEY, fetch);
    albums = await getTop('albums', lastfmUser, period, 5, LASTFM_API_KEY, fetch);
  } catch (e) {
    console.error(e);
    return { notice: lfmDown(e) };
  }
  if (!artists.length && !tracks.length && !albums.length) return { notice: `Sem reproduções nos ${PERIOD_LABEL[period]}.` };
  const num = (n) => String(n);
  // mesmo molde do /playing: pessoa em H2; sem um só número de plays aqui (são 3 listas), H3 segue
  // marcando as seções (Artistas/Faixas/Álbuns), como já faz o quadro de ouvintes.
  const sections = [`<h2>${mentionUser(user)}</h2><p>Mais ouvidos · ${PERIOD_LABEL[period]}</p>`];
  if (artists.length) {
    sections.push('<h3>Artistas</h3>' + richTable(
      [{ text: '#' }, { text: 'Artista' }, { text: '♫ plays', right: true }],
      artists.map((a, i) => [String(i + 1), anchor(lfmArtist(a.name), escapeHtml(cut(a.name, 60))), num(a.plays)])));
  }
  if (tracks.length) {
    sections.push('<h3>Faixas</h3>' + richTable(
      [{ text: '#' }, { text: 'Faixa' }, { text: '♫ plays', right: true }],
      tracks.map((t, i) => [String(i + 1), `${anchor(lfmTrack(t.artist, t.name), escapeHtml(cut(t.name, 60)))} <i>${escapeHtml(cut(t.artist, 40))}</i>`, num(t.plays)])));
  }
  if (albums.length) {
    sections.push('<h3>Álbuns</h3>' + richTable(
      [{ text: '#' }, { text: 'Álbum' }, { text: '♫ plays', right: true }],
      albums.map((a, i) => [String(i + 1), `${anchor(lfmAlbum(a.artist, a.name), escapeHtml(cut(a.name, 60)))} <i>${escapeHtml(cut(a.artist, 40))}</i>`, num(a.plays)])));
  }
  const cover = albums.find((a) => a.covers && a.covers.length);
  return { html: sections.join(''), covers: cover ? cover.covers : [] };
}
