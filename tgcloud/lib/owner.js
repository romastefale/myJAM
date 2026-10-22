// Comandos do dono (só na conversa privada): /tmn, /tpv, /onoff e as versões universais
// /tnowall, /songchartsall, /weekall, /monthall.
import { api, fetch, BotApiError } from 'sdk';
import { LASTFM_API_KEY, isOwner } from './config.js';
import { getRecentTrack, LastfmError } from './lastfm.js';
import { link, setTpv, clearTpv, masksFor, allLinked, isSilent, setFlag } from './store.js';
import { reply } from './telegram.js';
import { sendRichCard } from './photo.js';
import { listenersBoard, chartsBoard, lfmDown, validPeriod } from './boards.js';
import { NO_KEY } from './commands.js';
import { mention, escapeHtml, cut } from './format.js';

const TPV_MODES = ['tnow', 'mosaico', 'all'];
const TPV_LABEL = 'User';
const UNIVERSAL_TNOW_MAX = 20; // 2 consultas ao Last.fm por pessoa
const UNIVERSAL_CHARTS_MAX = 40; // 1 consulta por pessoa

// true = pode seguir. Quem não é dono recebe aviso no privado e silêncio no grupo; o dono em grupo
// é mandado para o privado (o resultado universal só vai para a DM).
async function ownerDm(message) {
  if (!isOwner(message.from.id)) {
    if (message.chat.type === 'private') await reply(message, 'Função exclusiva do dono do código.');
    return false;
  }
  if (message.chat.type !== 'private') {
    try {
      await api.sendMessage({ chat_id: message.from.id, text: 'Use este comando aqui na conversa privada. O resultado só é enviado aqui.' });
    } catch (e) {
      if (!(e instanceof BotApiError)) throw e;
    }
    return false;
  }
  return true;
}

// /tmn <user_id> <usuario_lastfm>: vincula o Last.fm de outra pessoa sem ela precisar digitar.
export async function tmn(message, arg) {
  if (!(await ownerDm(message))) return;
  const [rawId, lfmUser] = arg.split(/\s+/);
  const id = Number(rawId);
  if (!Number.isInteger(id) || id <= 0 || !lfmUser) {
    return reply(message, 'Uso: <code>/tmn user_id usuario_lastfm</code>');
  }
  if (!LASTFM_API_KEY) return reply(message, NO_KEY);
  try {
    await getRecentTrack(lfmUser, LASTFM_API_KEY, fetch); // confere que o usuário existe
  } catch (e) {
    if (e instanceof LastfmError && e.code === 6) return reply(message, `Usuário <b>${escapeHtml(cut(lfmUser, 40))}</b> não encontrado no Last.fm.`);
    console.error(e);
    return reply(message, lfmDown(e));
  }
  await link(id, lfmUser);
  return reply(message, `${mention(id, String(id))}\nLast.fm vinculado: <b>${escapeHtml(cut(lfmUser, 40))}</b>`);
}

// /tpv <id> tnow|mosaico|all|off [rótulo]: mascara a pessoa nos quadros de ouvintes.
export async function tpv(message, arg) {
  if (!(await ownerDm(message))) return;
  const [rawId, rawMode, ...rest] = arg.split(/\s+/);
  const id = Number(rawId);
  const mode = (rawMode || '').toLowerCase();
  if (!Number.isInteger(id) || id <= 0 || !(mode === 'off' || TPV_MODES.includes(mode))) {
    return reply(message, 'Uso: <code>/tpv id tnow|mosaico|all|off [rótulo]</code>');
  }
  if (mode === 'off') {
    const had = await clearTpv(id);
    return reply(message, had ? `TPV desativado para <code>${id}</code>.` : `TPV já estava inativo para <code>${id}</code>.`);
  }
  const label = cut(rest.join(' ').trim() || TPV_LABEL, 40);
  await setTpv(id, mode, label);
  return reply(message, `TPV ativo: <code>${id}</code> aparece como <b>${escapeHtml(label)}</b> em <code>${mode}</code>.`);
}

// /onoff on|off|status: modo silencioso (usuários comuns só têm /start e /help).
export async function onoff(message, arg) {
  if (!(await ownerDm(message))) return;
  const word = (arg || 'status').split(/\s+/)[0].toLowerCase();
  if (word === 'on') await setFlag('silent', '1');
  else if (word === 'off') await setFlag('silent', '0');
  else if (word !== 'status') return reply(message, 'Uso: <code>/onoff on|off|status</code>');
  return reply(message, (await isSilent())
    ? 'Modo silencioso: <b>ligado</b>. Usuários comuns só recebem /start e /help.'
    : 'Modo silencioso: <b>desligado</b>. Respostas normais.');
}

// /tnowall: o que todas as pessoas vinculadas estão ouvindo (só na DM do dono).
export async function tnowall(message) {
  if (!(await ownerDm(message))) return;
  if (!LASTFM_API_KEY) return reply(message, NO_KEY);
  const { members, total } = await allLinked(UNIVERSAL_TNOW_MAX);
  if (!members.length) return reply(message, 'Ninguém vinculou o Last.fm ainda.');
  const masks = await masksFor(members.map((m) => m.userId), 'mosaico');
  const out = await listenersBoard(message.chat.id, members, masks, `Ouvintes (${members.length} de ${total})`);
  return out.notice ? reply(message, out.notice) : sendRichCard(message.chat.id, out.covers, out.html);
}

// /songchartsall [periodo], /weekall e /monthall: ranking de artistas de todos os vinculados.
export async function chartsAll(message, arg, period) {
  if (!(await ownerDm(message))) return;
  const chosen = period || (arg ? arg.split(/\s+/)[0].toLowerCase() : '7day');
  if (!validPeriod(chosen)) return reply(message, 'Período inválido. Use <code>7day</code>, <code>1month</code>, <code>3month</code>, <code>6month</code>, <code>12month</code> ou <code>overall</code>.');
  if (!LASTFM_API_KEY) return reply(message, NO_KEY);
  const { members, total } = await allLinked(UNIVERSAL_CHARTS_MAX);
  if (!members.length) return reply(message, 'Ninguém vinculou o Last.fm ainda.');
  const out = await chartsBoard(message.chat.id, members, chosen, `Songcharts (${members.length} de ${total})`, 'ouvinte');
  return out.notice ? reply(message, out.notice) : sendRichCard(message.chat.id, out.covers, out.html);
}
