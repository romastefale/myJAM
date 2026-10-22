// handlers/inline_query.js — modo inline: a música atual e o trecho da letra.
// Bot API: answerInlineQuery + InlineQueryResultArticle + InputTextMessageContent.
// Requer o modo inline ligado no @BotFather (/setinline).
import { api, fetch } from 'sdk';
import { LASTFM_API_KEY } from '../lib/config.js';
import { getRecentTrack } from '../lib/lastfm.js';
import { lyricSnippet } from '../lib/lyrics.js';
import { lyricsFor, cachedLyricsFor } from '../lib/lyric_service.js';
import { getLinked, isSilent } from '../lib/store.js';
import { isOwner } from '../lib/config.js';
import { HTML } from '../lib/telegram.js';
import { trackCaption, escapeHtml, cut } from '../lib/format.js';

// Miniatura do resultado: a capa pequena (a grande é só para a prévia do link).
const smallCover = (track) => (track.covers || []).find((u) => /\/(174s|64s)\//.test(u)) || track.image;

const CACHE_SECONDS = 5; // a música muda: nada de cache longo (o padrão da Bot API é 300 s)

function article({ id, title, description, text, thumb, preview }) {
  return {
    type: 'article',
    id,
    title,
    description,
    input_message_content: {
      message_text: text,
      parse_mode: HTML,
      // prévia do link com a capa em destaque (LinkPreviewOptions); sem capa, sem prévia
      link_preview_options: preview
        ? { url: preview, prefer_large_media: true, show_above_text: true }
        : { is_disabled: true },
    },
    ...(thumb ? { thumbnail_url: thumb } : {}),
  };
}

export default async function (query) {
  const answer = (results, extra = {}) =>
    api.answerInlineQuery({
      inline_query_id: query.id,
      results,
      cache_time: CACHE_SECONDS,
      is_personal: true,
      ...extra,
    });

  if (!isOwner(query.from.id) && (await isSilent())) return answer([]);
  const linked = await getLinked(query.from.id);
  // Sem vínculo: botão que abre o bot com /start lastfm (InlineQueryResultsButton.start_parameter).
  if (!linked || !LASTFM_API_KEY) {
    return answer([], { button: { text: 'Conectar Last.fm', start_parameter: 'lastfm' } });
  }

  let track;
  try {
    track = await getRecentTrack(linked.lastfmUser, LASTFM_API_KEY, fetch);
  } catch (e) {
    console.error(e);
    return answer([]);
  }
  if (!track) return answer([]);

  const wantsLyrics = /^(tly|letra)\b/i.test((query.query || '').trim());
  const results = [];

  if (!wantsLyrics) {
    results.push(article({
      id: 'playing',
      title: track.nowPlaying ? '♫ Tocando agora' : 'Última faixa',
      description: `${cut(track.name, 60)} — ${cut(track.artist, 40)}`,
      text: trackCaption(track, query.from),
      thumb: smallCover(track),
      preview: track.image,
    }));
  }

  let lyrics = null;
  try {
    // letra pedida ("@bot letra"): cache ou rede; senão só se já estiver no cache (nada de rede a cada tecla)
    lyrics = wantsLyrics ? await lyricsFor(track, fetch) : await cachedLyricsFor(track);
  } catch (e) {
    console.error(e);
  }
  const snippet = lyrics && !lyrics.instrumental ? lyricSnippet(lyrics.plain) : '';
  if (snippet) {
    const title = `<b>${escapeHtml(cut(track.name))}</b> — <i>${escapeHtml(cut(track.artist))}</i>`;
    results.push(article({
      id: 'lyrics',
      title: 'Trecho da letra',
      description: `${cut(track.name, 60)} — ${cut(track.artist, 40)}`,
      text: `${title}\n<blockquote expandable>${escapeHtml(snippet)}</blockquote>`,
      thumb: smallCover(track),
      preview: null,
    }));
  }
  return answer(results);
}
