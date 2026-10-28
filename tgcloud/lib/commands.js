// Comandos do bot.
import { api, fetch, BotApiError, InputFile } from 'sdk';
import { LASTFM_API_KEY, MINI_APP_URL, OWNER_IDS, isOwner } from './config.js';
import { getRecentTrack, getAlbumInfo, getUserTrackPlays, LastfmError, PERIODS } from './lastfm.js';
import { lyricSnippet } from './lyrics.js';
import { lyricsFor } from './lyric_service.js';
import { getLinked, link, unlink, linkedMembers, masksFor } from './store.js';
import { listenersBoard, chartsBoard, rankBoard, lfmDown, validPeriod } from './boards.js';
import { reply, typing, sendRich } from './telegram.js';
import { sendRichCard } from './photo.js';
import { renderStory } from './story.js';
import {
  START_TEXT, helpText, richTrack, escapeHtml, cut, displayName, richTable, mentionUser, playsText,
  link as anchor, lfmArtist, lfmAlbum, lfmTrack, escapeAttr, richRow,
} from './format.js';

export const NO_KEY = 'O bot ainda não está configurado com a chave do Last.fm.';
export const CONNECT_FIRST = 'Conecte antes: <code>/lastfm seu_usuario</code>';
const NOWP_REQUEST_ID = 1; // request_id do botão que pede a escolha do grupo (/nowp)
const ALBUM_TRACKS_MAX = 10; // faixas do /albnow com contagem (1 consulta ao Last.fm por faixa)
const GROUP_MEMBERS_MAX = 10; // quantas consultas ao Last.fm um comando de grupo pode disparar

const isGroup = (chat) => chat.type === 'group' || chat.type === 'supergroup';

// Vínculo + chave + faixa atual. Se algo faltar, já responde ao usuário e devolve null.
export async function currentTrack(message) {
  const linked = await getLinked(message.from.id);
  if (!linked) {
    await reply(message, CONNECT_FIRST);
    return null;
  }
  if (!LASTFM_API_KEY) {
    await reply(message, NO_KEY);
    return null;
  }
  await typing(message.chat.id);
  let track;
  try {
    track = await getRecentTrack(linked.lastfmUser, LASTFM_API_KEY, fetch);
  } catch (e) {
    console.error(e);
    await reply(message, lfmDown(e));
    return null;
  }
  if (!track) {
    await reply(message, 'Nenhuma faixa encontrada no seu histórico.');
    return null;
  }
  return { linked, track };
}

// O botão `web_app` da mensagem rica (Bot API 10.3) só vale em conversa privada.
const OPEN_APP = richRow([`<tg-button type="web_app" style="success" url="${escapeAttr(MINI_APP_URL)}">Abrir o app</tg-button>`]);
export const start = (message) => sendRich(message.chat.id, START_TEXT + (message.chat.type === 'private' ? OPEN_APP : ''));
export const help = (message) => sendRich(message.chat.id, helpText(message.chat.type, isOwner(message.from.id)));

export async function lastfm(message, arg) {
  const tgId = message.from.id;
  if (!arg) {
    const linked = await getLinked(tgId);
    return reply(
      message,
      linked
        ? `Vinculado ao Last.fm: <b>${escapeHtml(linked.lastfmUser)}</b>.\nPara trocar: <code>/lastfm novo_usuario</code>`
        : 'Informe seu usuário: <code>/lastfm seu_usuario</code>',
    );
  }
  const username = arg.split(/\s+/)[0];
  if (!LASTFM_API_KEY) return reply(message, NO_KEY);
  try {
    await getRecentTrack(username, LASTFM_API_KEY, fetch); // valida que o usuário existe
  } catch (e) {
    if (e instanceof LastfmError && e.code === 6) {
      return reply(message, `Usuário <b>${escapeHtml(cut(username, 40))}</b> não encontrado no Last.fm.`);
    }
    console.error(e);
    return reply(message, lfmDown(e));
  }
  await link(tgId, username);
  return reply(message, `Last.fm vinculado: <b>${escapeHtml(cut(username, 40))}</b>. Use /playing.`);
}

export async function lastfmoff(message) {
  await unlink(message.from.id);
  return reply(message, 'Vínculo com o Last.fm removido.');
}

export async function playing(message) {
  const ctx = await currentTrack(message);
  if (!ctx) return;
  let mine;
  try {
    mine = await getUserTrackPlays(ctx.track.artist, ctx.track.name, ctx.linked.lastfmUser, LASTFM_API_KEY, fetch);
  } catch (e) {
    return reply(message, lfmDown(e));
  }
  return sendRichCard(message.chat.id, ctx.track.covers, richTrack(ctx.track, message.from, mine));
}

// /tstory: as informações do /playing numa imagem 1080x1920 (PNG), enviada como documento para
// manter a resolução (uma foto seria reduzida pelo Telegram). A pessoa publica o story.
export async function tstory(message) {
  const ctx = await currentTrack(message);
  if (!ctx) return false;
  let mine;
  try {
    mine = await getUserTrackPlays(ctx.track.artist, ctx.track.name, ctx.linked.lastfmUser, LASTFM_API_KEY, fetch);
  } catch (e) {
    await reply(message, lfmDown(e));
    return false;
  }
  await typing(message.chat.id, 'upload_document');
  const png = await renderStory({ track: ctx.track, user: message.from, plays: mine });
  await api.sendDocument({
    chat_id: message.chat.id,
    document: new InputFile(png, 'story.png', { type: 'image/png' }),
  });
  return true;
}

const LYRIC_MAX = 1500; // trecho do refrão numa mensagem rica

export async function tly(message) {
  const ctx = await currentTrack(message);
  if (!ctx) return;
  const { track } = ctx;
  let lyrics, mine;
  try {
    [lyrics, mine] = await Promise.all([
      lyricsFor(track, fetch),
      getUserTrackPlays(track.artist, track.name, ctx.linked.lastfmUser, LASTFM_API_KEY, fetch),
    ]);
  } catch (e) {
    console.error(e);
    return reply(message, e instanceof LastfmError ? lfmDown(e) : 'Não consegui buscar a letra agora. Tente de novo em instantes.');
  }
  // Mesmo cartão do /playing (capa + linhas da faixa); embaixo, o refrão.
  const snippet = lyrics && !lyrics.instrumental ? lyricSnippet(lyrics.plain, 8, LYRIC_MAX) : '';
  let body;
  if (snippet) body = `<blockquote expandable>${snippet.split('\n').map((l) => escapeHtml(l)).join('<br/>')}</blockquote>`;
  else body = `<p>${lyrics && lyrics.instrumental ? 'Esta faixa é instrumental.' : 'Letra não encontrada.'}</p>`;
  return sendRichCard(message.chat.id, track.covers, richTrack(track, message.from, mine) + body);
}

export async function albnow(message) {
  const ctx = await currentTrack(message);
  if (!ctx) return;
  const { track } = ctx;
  if (!track.album) return reply(message, 'O Last.fm não tem o álbum desta faixa.');
  let info;
  try {
    info = await getAlbumInfo(track.artist, track.album, LASTFM_API_KEY, fetch);
  } catch (e) {
    console.error(e);
    return reply(message, lfmDown(e));
  }
  if (!info) return reply(message, `Álbum <b>${escapeHtml(cut(track.album))}</b> não encontrado no Last.fm.`);
  const listed = info.tracks.slice(0, ALBUM_TRACKS_MAX);
  await typing(message.chat.id);
  const counts = [];
  try {
    for (const name of listed) { // em série: o Last.fm pede moderação (várias chamadas por segundo podem suspender a conta)
      counts.push(await getUserTrackPlays(info.artist, name, ctx.linked.lastfmUser, LASTFM_API_KEY, fetch));
    }
  } catch (e) {
    return reply(message, lfmDown(e));
  }
  const rows = listed.map((name, i) => {
    const label = anchor(lfmTrack(info.artist, name), escapeHtml(cut(name, 60)));
    // sem número quando não há reproduções desse nome de faixa; a faixa atual vai em negrito
    return [String(i + 1), name === track.name ? `<b>${label}</b>` : label, counts[i] ? String(counts[i]) : ''];
  });
  const more = info.tracks.length > listed.length ? `<p>+${info.tracks.length - listed.length} faixas</p>` : '';
  const table = richTable([{ text: '#' }, { text: 'Faixa' }, { text: '♫ plays', right: true }], rows);
  // mesmo molde do /playing: pessoa em H2, plays da faixa atual em H3 (quando há); o álbum vai no corpo.
  const mine = counts[listed.indexOf(track.name)];
  const html = `<h2>${mentionUser(message.from)}</h2>` +
    (playsText(mine) ? `<h3>${playsText(mine)}</h3>` : '') +
    `<p>${anchor(lfmAlbum(info.artist, info.name), escapeHtml(cut(info.name)))} — <i>${anchor(lfmArtist(info.artist), escapeHtml(cut(info.artist)))}</i></p>${table}${more}`;
  return sendRichCard(message.chat.id, info.covers, html);
}

// /weekfm (7day) e /monthfm (1month): os mais ouvidos do próprio usuário.
export async function rankOf(message, period) {
  const linked = await getLinked(message.from.id);
  if (!linked) return reply(message, CONNECT_FIRST);
  if (!LASTFM_API_KEY) return reply(message, NO_KEY);
  const out = await rankBoard(message.chat.id, message.from, linked.lastfmUser, period);
  return out.notice ? reply(message, out.notice) : sendRichCard(message.chat.id, out.covers, out.html);
}

// /nowp (só no privado): o Telegram lista os grupos do usuário em que o bot está (request_chat).
export async function nowp(message) {
  if (message.chat.type !== 'private') return reply(message, 'Use /nowp na conversa privada comigo.');
  const linked = await getLinked(message.from.id);
  if (!linked) return reply(message, CONNECT_FIRST);
  return reply(message, 'Escolha o grupo para enviar o que você está ouvindo.', {
    reply_markup: {
      keyboard: [[{
        text: 'Escolher grupo',
        request_chat: { request_id: NOWP_REQUEST_ID, chat_is_channel: false, bot_is_member: true },
      }]],
      resize_keyboard: true,
      one_time_keyboard: true,
    },
  });
}

// Mensagem de serviço `chat_shared`: o usuário escolheu o grupo pelo botão do /nowp.
export async function onChatShared(message) {
  const shared = message.chat_shared;
  if (!shared || shared.request_id !== NOWP_REQUEST_ID || message.chat.type !== 'private') return;
  const ctx = await currentTrack(message);
  if (!ctx) return;
  let mine;
  try {
    mine = await getUserTrackPlays(ctx.track.artist, ctx.track.name, ctx.linked.lastfmUser, LASTFM_API_KEY, fetch);
  } catch (e) {
    return reply(message, lfmDown(e), { reply_markup: { remove_keyboard: true } });
  }
  try {
    await sendRichCard(shared.chat_id, ctx.track.covers, richTrack(ctx.track, message.from, mine));
  } catch (e) {
    if (!(e instanceof BotApiError)) throw e;
    return reply(message, 'Não consegui enviar para esse grupo. Confira se o bot ainda está nele e pode enviar mensagens.', {
      reply_markup: { remove_keyboard: true },
    });
  }
  return reply(message, 'Enviado.', { reply_markup: { remove_keyboard: true } });
}

// /tnow (grupo): o que cada membro conhecido (que vinculou o Last.fm) está ouvindo.
export async function tnow(message) {
  if (!isGroup(message.chat)) return reply(message, 'Use /tnow em um grupo.');
  if (!LASTFM_API_KEY) return reply(message, NO_KEY);
  const members = await linkedMembers(message.chat.id, GROUP_MEMBERS_MAX);
  if (!members.length) {
    return reply(message, 'Ainda não conheço ouvintes neste grupo. Quem usar um comando e tiver o Last.fm vinculado (<code>/lastfm usuario</code>) passa a aparecer aqui.');
  }
  const masks = await masksFor(members.map((m) => m.userId), 'tnow');
  const out = await listenersBoard(message.chat.id, members, masks, 'Ouvintes do grupo');
  return out.notice ? reply(message, out.notice) : sendRichCard(message.chat.id, out.covers, out.html);
}

// /songcharts [periodo] (grupo): artistas mais ouvidos somando os membros conhecidos.
export async function songcharts(message, arg) {
  if (!isGroup(message.chat)) return reply(message, 'Use /songcharts em um grupo.');
  const period = arg ? arg.split(/\s+/)[0].toLowerCase() : '7day';
  if (!validPeriod(period)) {
    return reply(message, `Período inválido. Use: ${PERIODS.map((p) => `<code>${p}</code>`).join(', ')}.`);
  }
  if (!LASTFM_API_KEY) return reply(message, NO_KEY);
  const members = await linkedMembers(message.chat.id, GROUP_MEMBERS_MAX);
  if (!members.length) {
    return reply(message, 'Ainda não conheço ouvintes neste grupo. Quem usar um comando e tiver o Last.fm vinculado (<code>/lastfm usuario</code>) passa a entrar no ranking.');
  }
  const out = await chartsBoard(message.chat.id, members, period, 'Songcharts');
  return out.notice ? reply(message, out.notice) : sendRichCard(message.chat.id, out.covers, out.html);
}

// /setup (dono): publica o menu de comandos (Bot API: setMyCommands, um por escopo).
const PRIVATE_COMMANDS = [
  { command: 'start', description: 'Apresentação do bot' },
  { command: 'help', description: 'Comandos disponíveis' },
  { command: 'lastfm', description: 'Vincular seu usuário do Last.fm' },
  { command: 'lastfmoff', description: 'Remover o vínculo' },
  { command: 'playing', description: 'Sua música atual' },
  { command: 'tly', description: 'Trecho da letra da música atual' },
  { command: 'tstory', description: 'Imagem da música atual para story' },
  { command: 'albnow', description: 'O álbum da música atual' },
  { command: 'weekfm', description: 'Mais ouvidos dos últimos 7 dias' },
  { command: 'monthfm', description: 'Mais ouvidos do último mês' },
  { command: 'radiofm', description: 'Buscar uma música' },
  { command: 'myself', description: 'Menu dos seus extratos' },
  { command: 'nowp', description: 'Enviar sua música para um grupo' },
];
const OWNER_COMMANDS = [
  { command: 'tnowall', description: 'Ouvintes de todos os vinculados' },
  { command: 'songchartsall', description: 'Ranking de artistas de todos' },
  { command: 'weekall', description: 'Ranking semanal de todos' },
  { command: 'monthall', description: 'Ranking mensal de todos' },
  { command: 'tmn', description: 'Vincular o Last.fm de alguém' },
  { command: 'tpv', description: 'Mascarar alguém nos ouvintes' },
  { command: 'onoff', description: 'Modo silencioso' },
];
const GROUP_COMMANDS = [
  ...PRIVATE_COMMANDS.filter((c) => c.command !== 'nowp'),
  { command: 'tnow', description: 'O que o grupo está ouvindo' },
  { command: 'songcharts', description: 'Ranking de artistas do grupo' },
];

export async function setup(message) {
  if (!isOwner(message.from.id)) return; // silencioso para quem não é dono
  await api.setMyCommands({ commands: PRIVATE_COMMANDS, scope: { type: 'all_private_chats' } });
  await api.setMyCommands({ commands: GROUP_COMMANDS, scope: { type: 'all_group_chats' } });
  for (const id of OWNER_IDS) { // os comandos do dono aparecem só no privado de cada dono
    await api.setMyCommands({ commands: [...PRIVATE_COMMANDS, ...OWNER_COMMANDS], scope: { type: 'chat', chat_id: id } });
  }
  return reply(message, 'Menu de comandos atualizado.');
}
