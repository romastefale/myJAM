// Canvas do Spotify como fundo do story: a pessoa manda (cola ou compartilha) um link de uma faixa do
// Spotify, em qualquer mensagem, sem precisar de comando. O bot acha o vídeo do Canvas no
// canvasdownloader.com (site público, testado ao vivo — zero chamada ao Spotify), pega a faixa atual do
// Last.fm (a mesma fonte do /tstory) e monta o story com o Canvas como fundo, no GitHub Actions (o
// ambiente do bot não tem codificador de vídeo).
import { api, fetch, BotApiError } from 'sdk';
import { reply, typing, sendRich } from './telegram.js';
import { currentTrack } from './commands.js';
import { getUserTrackPlays } from './lastfm.js';
import { lfmDown } from './boards.js';
import { LASTFM_API_KEY, GITHUB_REPO, GITHUB_DISPATCH_TOKEN } from './config.js';
import { canvasForLink } from './spotify_canvas.js';
import { mentionUser, richButton, richRow } from './format.js';

// Link do Spotify em qualquer forma que o app/navegador gera ao compartilhar: open.spotify.com/track/<id>
// (com ou sem /intl-xx/ e com ou sem ?si=...) ou spotify:track:<id>.
const SPOTIFY_TRACK_RE = /open\.spotify\.com\/(?:intl-[a-z-]+\/)?track\/([A-Za-z0-9]{22})|spotify:track:([A-Za-z0-9]{22})/;

// Pergunta do /tstory: a mesma montagem do link do Spotify, pedida pelo próprio /tstory, com um trecho de som.
export const CANVAS_ASK = 'Quer também uma versão com o Canvas do Spotify e 15 segundos de som?';
export const CANVAS_PROMPT = 'Responda esta mensagem com o link da faixa no Spotify.';
export const STORY_AUDIO_SECONDS = 15;

// Pergunta Sim/Não logo depois da pergunta da foto/vídeo.
export function offerCanvas(message) {
  const id = message.from.id;
  return sendRich(message.chat.id, `<p>${mentionUser(message.from)}</p><p>${CANVAS_ASK}</p>` +
    richRow([richButton('Sim', `canvas:yes:${id}`, 'success'), richButton('Não', `canvas:no:${id}`)]));
}

// Clique em Sim/Não. Sim: pede o link com resposta forçada, só para quem pediu (selective: vale para os
// mencionados no texto).
export async function canvasChoice(query) {
  const [, choice, owner] = String(query.data).split(':');
  const msg = query.message;
  if (!msg) return api.answerCallbackQuery({ callback_query_id: query.id });
  if (Number(owner) !== query.from.id) {
    return api.answerCallbackQuery({ callback_query_id: query.id, text: 'Essa pergunta é de outra pessoa. Rode /tstory você mesmo.', show_alert: true });
  }
  await api.answerCallbackQuery({ callback_query_id: query.id });
  try {
    await api.deleteMessage({ chat_id: msg.chat.id, message_id: msg.message_id });
  } catch (e) {
    if (!(e instanceof BotApiError)) throw e;
  }
  if (choice !== 'yes') return;
  return api.sendMessage({
    chat_id: msg.chat.id,
    text: `${mentionUser(query.from)}\n${CANVAS_PROMPT}`,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    reply_markup: { force_reply: true, selective: true, input_field_placeholder: 'Link da faixa no Spotify' },
  });
}

// Resposta à pergunta do Sim: um link de faixa do Spotify em resposta a uma pergunta do bot feita para esta
// mesma pessoa.
export function isCanvasReply(message) {
  const to = message.reply_to_message;
  if (!extractSpotifyTrackId(message) || !to || !to.from || !to.from.is_bot || !to.text || !to.text.endsWith(CANVAS_PROMPT)) return false;
  return (to.entities || []).some((e) => e.type === 'text_mention' && e.user && e.user.id === message.from.id);
}

export function extractSpotifyTrackId(message) {
  const text = (message && (message.text || message.caption)) || '';
  const m = SPOTIFY_TRACK_RE.exec(text);
  return m ? m[1] || m[2] : null;
}

// Dispara a montagem no GitHub Actions (workflow_dispatch: 204 = aceito). O workflow avisa a pessoa se falhar.
async function queueCanvasStory(message, canvasUrl, track, mine, audioSeconds) {
  if (!GITHUB_REPO || !GITHUB_DISPATCH_TOKEN) {
    return reply(message, 'O story com o Canvas ainda não está ligado neste bot (falta a configuração do GitHub).');
  }
  const u = message.from;
  const payload = {
    chat_id: message.chat.id,
    canvas_url: canvasUrl,
    audio_seconds: audioSeconds || 0,
    plays: mine,
    user: { id: u.id, first_name: u.first_name || '', last_name: u.last_name || '', username: u.username || '' },
    track: { name: track.name, artist: track.artist, album: track.album || '', nowPlaying: !!track.nowPlaying, covers: track.covers || [] },
  };
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/canvas-story.yml/dispatches`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${GITHUB_DISPATCH_TOKEN}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'myJAMrobot',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ ref: 'main', inputs: { payload: JSON.stringify(payload) } }),
  });
  if (res.status !== 204) {
    console.error(`dispatch do canvas-story: HTTP ${res.status} ${await res.text()}`);
    return reply(message, 'Achei o Canvas, mas não consegui iniciar a montagem agora. Tente de novo em instantes.');
  }
  return reply(message, `Achei o Canvas dessa faixa. Estou montando o story com ele de fundo${audioSeconds ? ` e ${audioSeconds} segundos de som` : ''} e mando aqui quando ficar pronto.`);
}

export async function canvasFromLink(message, { audioSeconds = 0 } = {}) {
  const id = extractSpotifyTrackId(message);
  if (!id) return;
  await typing(message.chat.id, 'upload_video');
  const log = [];
  const trace = (line) => log.push(line);
  let canvasUrl;
  try {
    canvasUrl = await canvasForLink(`https://open.spotify.com/track/${id}`, trace);
    console.log(`canvas: ${log.join(' | ')}`);
  } catch (e) {
    console.error(`canvas falhou: ${e && e.message}`, log.join(' | '));
    return reply(message, 'Não consegui buscar o Canvas agora. Tente de novo mais tarde.');
  }
  if (!canvasUrl) return reply(message, 'Esta faixa não tem Canvas.');

  const ctx = await currentTrack(message);
  if (!ctx) return;
  let mine;
  try {
    mine = await getUserTrackPlays(ctx.track.artist, ctx.track.name, ctx.linked.lastfmUser, LASTFM_API_KEY, fetch);
  } catch (e) {
    return reply(message, lfmDown(e));
  }
  return queueCanvasStory(message, canvasUrl, ctx.track, mine, audioSeconds);
}
