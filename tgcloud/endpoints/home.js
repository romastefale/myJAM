// endpoints/home.js — dados da tela inicial do Mini App: a faixa atual (ou a última) de quem abriu.
import { fetch, EndpointError } from 'sdk';
import { LASTFM_API_KEY, isOwner } from '../lib/config.js';
import { getLinked } from '../lib/store.js';
import { getRecentTrack, getUserTrackPlays, LastfmError } from '../lib/lastfm.js';
import { displayName } from '../lib/format.js';

export default async function (input, ctx) {
  const user = ctx.initData.user;
  const base = { name: displayName(user), owner: isOwner(user.id) };
  const linked = await getLinked(user.id);
  if (!linked) return { ...base, linked: false, track: null };
  if (!LASTFM_API_KEY) throw new EndpointError('O bot ainda não está configurado com a chave do Last.fm.', { code: 'NO_KEY' });
  let track;
  let plays = 0;
  try {
    track = await getRecentTrack(linked.lastfmUser, LASTFM_API_KEY, fetch);
    if (track) plays = await getUserTrackPlays(track.artist, track.name, linked.lastfmUser, LASTFM_API_KEY, fetch);
  } catch (e) {
    if (!(e instanceof LastfmError)) throw e;
    throw new EndpointError('O Last.fm não respondeu agora. Tente de novo em instantes.', { code: 'LASTFM' });
  }
  if (!track) return { ...base, linked: true, track: null };
  return {
    ...base,
    linked: true,
    track: {
      name: track.name,
      artist: track.artist,
      album: track.album,
      covers: track.covers,
      nowPlaying: track.nowPlaying,
      plays: Number(plays) || 0,
    },
  };
}
