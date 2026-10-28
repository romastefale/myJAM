// endpoints/home.js — dados da tela inicial do Mini App: a faixa atual (ou a última) de quem abriu.
import { fetch } from 'sdk';
import { LASTFM_API_KEY, isOwner } from '../lib/config.js';
import { getLinked } from '../lib/store.js';
import { getRecentTrack, getUserTrackPlays } from '../lib/lastfm.js';
import { displayName } from '../lib/format.js';

export default async function (input, ctx) {
  const user = ctx.initData.user;
  const name = displayName(user);
  const owner = isOwner(user.id);
  const linked = await getLinked(user.id);
  if (!linked || !LASTFM_API_KEY) return { name, owner, linked: !!linked, track: null };
  let track;
  let plays = 0;
  try {
    track = await getRecentTrack(linked.lastfmUser, LASTFM_API_KEY, fetch);
    if (track) plays = await getUserTrackPlays(track.artist, track.name, linked.lastfmUser, LASTFM_API_KEY, fetch);
  } catch (e) {
    console.error(e);
    return { name, owner, linked: true, track: null, unavailable: true };
  }
  if (!track) return { name, owner, linked: true, track: null };
  return {
    name,
    owner,
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
