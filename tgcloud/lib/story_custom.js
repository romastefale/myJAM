// Personalização do /tstory: depois do story, o bot faz UMA pergunta com as opções "foto ou vídeo" e "música de
// 15 segundos" (esta, em story_sound.js). Na primeira, a pessoa responde com uma foto (ou vídeo) quadrada e o story
// é refeito com ela no lugar da capa.
// Só o quadrado da capa muda; o layout do story é o mesmo. Foto: entra no quadrado, aqui mesmo. Vídeo (até
// 1 minuto): o ambiente do bot não tem codificador de vídeo, então a montagem roda no GitHub Actions
// (.github/workflows/story-video.yml + scripts/story-video.mjs), que devolve o MP4 ao chat.
import { api, fetch, InputFile, BotApiError } from 'sdk';
import { LASTFM_API_KEY, GITHUB_REPO, GITHUB_DISPATCH_TOKEN } from './config.js';
import { getUserTrackPlays } from './lastfm.js';
import { currentTrack } from './commands.js';
import { lfmDown } from './boards.js';
import { reply, typing, sendRich } from './telegram.js';
import { renderStory } from './story.js';
import { mentionUser, richButton, richRow } from './format.js';

export const STORY_ASK = 'Quer personalizar este story?';
const STORY_HINT = 'use a sua própria foto ou vídeo, ou acrescente um trecho de música.';
export const STORY_PROMPT = 'Responda esta mensagem com a foto ou o vídeo quadrado (vídeo de até 1 minuto).';
const VIDEO_MAX_SECONDS = 60;
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;

// Pergunta única logo depois do story (título em <h2>, como o do /start): foto ou vídeo (story:yes) e música de 15s (sound:yes), em verde, na primeira
// linha; "Cancelar" (story:no), em vermelho, sozinho na segunda. A Bot API não tem largura para o botão: o texto do
// Cancelar leva espaços em branco invisíveis (U+2800) dos dois lados para a largura chegar perto da soma dos dois verdes.
const CANCEL_PAD = '\u2800'.repeat(10);
export function offerCustom(message) {
  const id = message.from.id;
  return sendRich(message.chat.id, `<h2>${STORY_ASK}</h2><p>${mentionUser(message.from)}, ${STORY_HINT}</p>` +
    richRow([richButton('Minha foto ou vídeo', `story:yes:${id}`, 'success'), richButton('Música de 15s', `sound:yes:${id}`, 'success')]) +
    richRow([richButton(`${CANCEL_PAD}Cancelar${CANCEL_PAD}`, `story:no:${id}`, 'danger')], null));
}

// Clique em Sim/Não. Sim: pede a mídia com resposta forçada, só para quem pediu (selective: vale para os
// mencionados no texto).
export async function storyChoice(query) {
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
    text: `${mentionUser(query.from)}\n${STORY_PROMPT}`,
    parse_mode: 'HTML',
    link_preview_options: { is_disabled: true },
    reply_markup: { force_reply: true, selective: true, input_field_placeholder: 'Foto ou vídeo quadrado' },
  });
}

const isImageDoc = (d) => !!d && /^image\//.test(d.mime_type || '');
const videoOf = (m) => m.video || m.video_note || m.animation || null;

// Resposta à pergunta do Sim: mídia (foto, imagem enviada como arquivo, vídeo, vídeo redondo ou animação)
// em resposta a uma pergunta do bot feita para esta mesma pessoa.
export function isCustomReply(message) {
  const to = message.reply_to_message;
  const media = message.photo || videoOf(message) || isImageDoc(message.document);
  if (!media || !to || !to.from || !to.from.is_bot || !to.text || !to.text.endsWith(STORY_PROMPT)) return false;
  return (to.entities || []).some((e) => e.type === 'text_mention' && e.user && e.user.id === message.from.id);
}

// Tipo da imagem pelos primeiros bytes (o renderizador entende JPEG, PNG, GIF e WebP).
function sniff(b) {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'image/jpeg';
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return 'image/png';
  if (b[0] === 0x47 && b[1] === 0x49 && b[2] === 0x46) return 'image/gif';
  if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return 'image/webp';
  return null;
}

export async function customReply(message) {
  const video = videoOf(message);
  if (video && Number(video.duration) > VIDEO_MAX_SECONDS) {
    return reply(message, `Esse vídeo tem ${video.duration} s. O limite é de 1 minuto.`);
  }
  const file = video ? null : (message.photo ? message.photo[message.photo.length - 1] : message.document);
  if (file && file.file_size && file.file_size > IMAGE_MAX_BYTES) return reply(message, 'Essa imagem passa de 5 MB. Mande uma menor.');
  const ctx = await currentTrack(message);
  if (!ctx) return;
  let mine;
  try {
    mine = await getUserTrackPlays(ctx.track.artist, ctx.track.name, ctx.linked.lastfmUser, LASTFM_API_KEY, fetch);
  } catch (e) {
    return reply(message, lfmDown(e));
  }
  if (video) return queueVideo(message, ctx, mine, video);
  await typing(message.chat.id, 'upload_document');
  const bytes = await api.getFileContent(file.file_id);
  const type = sniff(bytes);
  if (!type) return reply(message, 'Não reconheci esse formato de imagem. Use JPEG, PNG ou WebP.');
  const png = await renderStory({ track: ctx.track, user: message.from, plays: mine, custom: { bytes, type } });
  return api.sendDocument({
    chat_id: message.chat.id,
    document: new InputFile(png, 'story.png', { type: 'image/png' }),
  });
}

// Dispara a montagem do vídeo no GitHub Actions (workflow_dispatch: 204 = aceito). O workflow avisa a pessoa se falhar.
async function queueVideo(message, ctx, mine, video) {
  if (!GITHUB_REPO || !GITHUB_DISPATCH_TOKEN) {
    return reply(message, 'O vídeo do story ainda não está ligado neste bot (falta a configuração do GitHub). A foto já funciona.');
  }
  const t = ctx.track;
  const u = message.from;
  const payload = {
    chat_id: message.chat.id,
    file_id: video.file_id,
    plays: mine,
    user: { id: u.id, first_name: u.first_name || '', last_name: u.last_name || '', username: u.username || '' },
    track: { name: t.name, artist: t.artist, album: t.album || '', nowPlaying: !!t.nowPlaying, covers: (t.covers || []).slice(0, 3) },
  };
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/story-video.yml/dispatches`, {
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
    console.error(`dispatch do vídeo: HTTP ${res.status} ${await res.text()}`);
    return reply(message, 'Não consegui iniciar a montagem do vídeo agora. Tente de novo em instantes.');
  }
  return reply(message, 'Recebi o vídeo. Estou montando o story com ele dentro do quadrado e mando aqui quando ficar pronto (leva alguns minutos).');
}
