// Música no story: na pergunta única do /tstory (story_custom.js), a opção "Música de 15 s" monta o MESMO story com
// 15 segundos de som da faixa. O vídeo é montado no GitHub Actions (.github/workflows/story-sound.yml +
// scripts/story-sound.mjs): o ambiente do bot não tem codificador de vídeo.
import { api, fetch, BotApiError } from 'sdk';
import { LASTFM_API_KEY, GITHUB_REPO, GITHUB_DISPATCH_TOKEN } from './config.js';
import { getUserTrackPlays } from './lastfm.js';
import { currentTrack } from './commands.js';
import { lfmDown } from './boards.js';
import { reply } from './telegram.js';

export const SOUND_SECONDS = 15;

// Clique em "Música de 15 s".
export async function soundChoice(query) {
  const owner = String(query.data).split(':')[2];
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
  return queueSound({ from: query.from, chat: msg.chat });
}

// Dispara a montagem no GitHub Actions (workflow_dispatch: 204 = aceito). O workflow avisa a pessoa se falhar.
export async function queueSound(message) {
  if (!GITHUB_REPO || !GITHUB_DISPATCH_TOKEN) {
    return reply(message, 'O story com som ainda não está ligado neste bot (falta a configuração do GitHub).');
  }
  const ctx = await currentTrack(message);
  if (!ctx) return;
  let mine;
  try {
    mine = await getUserTrackPlays(ctx.track.artist, ctx.track.name, ctx.linked.lastfmUser, LASTFM_API_KEY, fetch);
  } catch (e) {
    return reply(message, lfmDown(e));
  }
  const t = ctx.track;
  const u = message.from;
  const payload = {
    chat_id: message.chat.id,
    audio_seconds: SOUND_SECONDS,
    plays: mine,
    user: { id: u.id, first_name: u.first_name || '', last_name: u.last_name || '', username: u.username || '' },
    track: { name: t.name, artist: t.artist, album: t.album || '', nowPlaying: !!t.nowPlaying, covers: t.covers || [] },
  };
  const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/actions/workflows/story-sound.yml/dispatches`, {
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
    console.error(`dispatch do story com som: HTTP ${res.status} ${await res.text()}`);
    return reply(message, 'Não consegui iniciar a montagem agora. Tente de novo em instantes.');
  }
  return reply(message, 'Estou montando o story com 15 segundos de som e mando aqui quando ficar pronto.');
}
