// /radiofm (busca uma música por termo livre) e /myself (menu de extratos pessoais).
// Os dois usam botões inline; os cliques chegam em handlers/callback_query.js.
import { api, fetch, BotApiError } from 'sdk';
import { LASTFM_API_KEY } from './config.js';
import { searchTracks, getTrackInfo } from './lastfm.js';
import { getLinked, saveSearch, getSearch, dropSearch } from './store.js';
import { reply, sendRich } from './telegram.js';
import { sendRichCard } from './photo.js';
import { rankBoard, lfmDown } from './boards.js';
import { NO_KEY, CONNECT_FIRST } from './commands.js';
import { mentionUser, richTrack, escapeHtml, cut, richButton, richRow } from './format.js';

const RESULTS = 5; // botões por busca
export const RADIO_PROMPT = 'Qual música ou artista você quer buscar?';
const PERIOD_BY_CODE = { w: '7day', m: '1month' };

const searchKey = (message) => `${message.chat.id}:${message.message_id}`;

// Texto + botões de uma busca. Cada botão leva só o índice; os dados ficam no banco (callback_data
// aceita no máximo 64 bytes).
async function presentResults(chatId, user, term) {
  if (!LASTFM_API_KEY) return { notice: NO_KEY };
  let found;
  try {
    found = await searchTracks(term, RESULTS, LASTFM_API_KEY, fetch);
  } catch (e) {
    console.error(e);
    return { notice: lfmDown(e) };
  }
  if (!found.length) return { notice: `Nada encontrado para <b>${escapeHtml(cut(term, 60))}</b>.` };
  const rows = found.map((t, i) => richRow([richButton(cut(`${t.name} - ${t.artist}`, 60), `radiofm:${i}`)], 'left')).join('');
  const sent = await sendRich(chatId, `<p>${mentionUser(user)}</p><p>Resultados para <b>${escapeHtml(cut(term, 60))}</b>:</p>${rows}`);
  await saveSearch(searchKey(sent), user.id, found);
  return {};
}

export async function radiofm(message, arg) {
  if (!arg) {
    // Pergunta com resposta forçada, só para quem pediu (selective: vale para os mencionados no texto).
    return api.sendMessage({
      chat_id: message.chat.id,
      text: `${mentionUser(message.from)}\n${RADIO_PROMPT}`,
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      reply_markup: { force_reply: true, selective: true, input_field_placeholder: 'Nome da música ou artista' },
    });
  }
  const out = await presentResults(message.chat.id, message.from, arg);
  if (out.notice) return reply(message, out.notice);
}

// Resposta à pergunta do /radiofm sem termo: mensagem de texto que responde a uma pergunta do bot
// feita para esta mesma pessoa (a menção do texto vira entidade text_mention com o id dela).
export function isRadioAnswer(message) {
  const to = message.reply_to_message;
  if (!message.text || message.text[0] === '/' || !to || !to.from || !to.from.is_bot) return false;
  if (!to.text || !to.text.endsWith(RADIO_PROMPT)) return false;
  return (to.entities || []).some((e) => e.type === 'text_mention' && e.user && e.user.id === message.from.id);
}

export async function radiofmAnswer(message) {
  const out = await presentResults(message.chat.id, message.from, message.text.trim());
  if (out.notice) return reply(message, out.notice);
}

// Clique num resultado.
export async function radioPick(query) {
  const msg = query.message;
  if (!msg) return api.answerCallbackQuery({ callback_query_id: query.id });
  const key = `${msg.chat.id}:${msg.message_id}`;
  const saved = await getSearch(key);
  const index = Number(String(query.data).split(':')[1]);
  const pick = saved && saved.results[index];
  if (!pick) {
    return api.answerCallbackQuery({ callback_query_id: query.id, text: 'Essa busca expirou. Rode /radiofm de novo.', show_alert: true });
  }
  if (saved.userId !== query.from.id) {
    return api.answerCallbackQuery({ callback_query_id: query.id, text: 'Essa busca é de outra pessoa. Rode /radiofm você também.', show_alert: true });
  }
  await api.answerCallbackQuery({ callback_query_id: query.id });
  const linked = await getLinked(query.from.id);
  let info;
  try {
    info = await getTrackInfo(pick.artist, pick.name, linked ? linked.lastfmUser : null, LASTFM_API_KEY, fetch);
  } catch (e) {
    console.error(e);
    return api.sendMessage({ chat_id: msg.chat.id, text: lfmDown(e) });
  }
  const track = info || { name: pick.name, artist: pick.artist, covers: [], plays: null };
  await sendRichCard(msg.chat.id, track.covers, richTrack(track, query.from, track.plays));
  await dropSearch(key);
  try {
    await api.deleteMessage({ chat_id: msg.chat.id, message_id: msg.message_id });
  } catch (e) {
    if (!(e instanceof BotApiError)) throw e;
  }
}

// /myself: botões Semanal / Mensal; o clique manda o extrato correspondente.
export async function myself(message) {
  const linked = await getLinked(message.from.id);
  if (!linked) return reply(message, CONNECT_FIRST);
  const id = message.from.id;
  return sendRich(message.chat.id, `<p>${mentionUser(message.from)}</p><p>Seus extratos — escolha o período:</p>` +
    richRow([richButton('Semanal', `myself:w:${id}`, 'primary'), richButton('Mensal', `myself:m:${id}`, 'primary')]));
}

export async function myselfPick(query) {
  const [, code, owner] = String(query.data).split(':');
  const period = PERIOD_BY_CODE[code];
  if (!period || !query.message) return api.answerCallbackQuery({ callback_query_id: query.id });
  if (Number(owner) !== query.from.id) {
    return api.answerCallbackQuery({ callback_query_id: query.id, text: 'Esse menu é do outro usuário. Rode /myself você mesmo.', show_alert: true });
  }
  await api.answerCallbackQuery({ callback_query_id: query.id });
  const chatId = query.message.chat.id;
  const linked = await getLinked(query.from.id);
  if (!linked) return api.sendMessage({ chat_id: chatId, text: 'Vínculo com o Last.fm não encontrado. Use /lastfm usuario.' });
  const out = await rankBoard(chatId, query.from, linked.lastfmUser, period);
  if (out.notice) return api.sendMessage({ chat_id: chatId, text: out.notice.replace(/<[^>]+>/g, '') });
  await sendRichCard(chatId, out.covers, out.html);
  try {
    await api.deleteMessage({ chat_id: chatId, message_id: query.message.message_id });
  } catch (e) {
    if (!(e instanceof BotApiError)) throw e;
  }
}
