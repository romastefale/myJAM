// handlers/message.js — roteia comandos de texto e a mensagem de serviço chat_shared.
import { api, BotApiError } from 'sdk';
import { parseCommand } from '../lib/command.js';
import { remember, isSilent } from '../lib/store.js';
import { isOwner } from '../lib/config.js';
import * as c from '../lib/commands.js';
import * as radio from '../lib/radio.js';
import * as owner from '../lib/owner.js';
import * as custom from '../lib/story_custom.js';
import * as canvas from '../lib/canvas.js';

const ROUTES = {
  start: (m) => c.start(m),
  help: (m) => c.help(m),
  lastfm: (m, arg) => c.lastfm(m, arg),
  lastfmoff: (m) => c.lastfmoff(m),
  playing: (m) => c.playing(m),
  tly: (m) => c.tly(m),
  tstory: async (m) => { if (await c.tstory(m)) await custom.offerCustom(m); },
  albnow: (m) => c.albnow(m),
  weekfm: (m) => c.rankOf(m, '7day'),
  monthfm: (m) => c.rankOf(m, '1month'),
  nowp: (m) => c.nowp(m),
  tnow: (m) => c.tnow(m),
  songcharts: (m, arg) => c.songcharts(m, arg),
  radiofm: (m, arg) => radio.radiofm(m, arg),
  myself: (m) => radio.myself(m),
  tmn: (m, arg) => owner.tmn(m, arg),
  tpv: (m, arg) => owner.tpv(m, arg),
  onoff: (m, arg) => owner.onoff(m, arg),
  tnowall: (m) => owner.tnowall(m),
  songchartsall: (m, arg) => owner.chartsAll(m, arg, null),
  weekall: (m) => owner.chartsAll(m, '', '7day'),
  monthall: (m) => owner.chartsAll(m, '', '1month'),
  setup: (m) => c.setup(m),
};

// No modo silencioso (/onoff on), quem não é dono só tem /start e /help.
const SILENT_OK = ['start', 'help'];
const silenced = async (message, name) => !isOwner(message.from.id) && !SILENT_OK.includes(name) && (await isSilent());

// Falha não tratada: fica no log e a pessoa é avisada. BotApiError traz .code, .description, .method e
// .parameters; no 429, parameters.retry_after = segundos de espera.
async function guarded(message, name, run) {
  try {
    return await run();
  } catch (e) {
    const detail = e instanceof BotApiError ? `${e.method} ${e.code} ${e.description}` : '';
    console.error(`/${name} falhou: ${detail}`, e);
    const wait = e instanceof BotApiError && e.code === 429 && e.parameters ? e.parameters.retry_after : null;
    try {
      await api.sendMessage({
        chat_id: message.chat.id,
        text: wait
          ? `O Telegram pediu uma pausa. Tente de novo em ${wait} s.`
          : 'Não consegui concluir esse comando agora. Tente de novo em instantes.',
      });
    } catch (notifyError) {
      console.error('aviso de falha também não foi enviado:', notifyError);
    }
  }
}

export default async function (message) {
  if (!message.from) return;
  if (message.chat_shared) return c.onChatShared(message);

  const cmd = parseCommand(message);
  if (!cmd) {
    // resposta à pergunta do /radiofm sem termo
    if (radio.isRadioAnswer(message) && !(await silenced(message, 'radiofm'))) return radio.radiofmAnswer(message);
    // mídia enviada em resposta à pergunta do /tstory (foto ou vídeo quadrado)
    if (custom.isCustomReply(message) && !(await silenced(message, 'tstory'))) return guarded(message, 'tstory', () => custom.customReply(message));
    // link de uma faixa do Spotify em qualquer mensagem: story com o Canvas dela de fundo
    if (canvas.extractSpotifyTrackId(message) && !(await silenced(message, 'tcanvas'))) return guarded(message, 'tcanvas', () => canvas.canvasFromLink(message));
    return;
  }
  const route = ROUTES[cmd.name];
  if (!route) return;

  // Em grupos, /comando@outrobot não é para este bot.
  if (cmd.target) {
    const me = await api.getMe();
    if (String(me.username || '').toLowerCase() !== cmd.target) return;
  }

  if (await silenced(message, cmd.name)) return;

  // Quem usa um comando num grupo passa a ser "membro conhecido" desse grupo (/tnow, /songcharts).
  if (message.chat.type === 'group' || message.chat.type === 'supergroup') {
    await remember(message.chat, message.from);
  }

  return guarded(message, cmd.name, () => route(message, cmd.arg));
}
