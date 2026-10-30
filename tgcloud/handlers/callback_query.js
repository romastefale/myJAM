// handlers/callback_query.js — cliques nos botões do /radiofm, do /myself e das perguntas do /tstory.
import { api, BotApiError } from 'sdk';
import { isOwner } from '../lib/config.js';
import { isSilent } from '../lib/store.js';
import { radioPick, myselfPick } from '../lib/radio.js';
import { storyChoice } from '../lib/story_custom.js';
import { canvasChoice } from '../lib/canvas.js';

export default async function (query) {
  const data = String(query.data || '');
  const kind = data.split(':')[0];
  const handler = kind === 'radiofm' ? radioPick : kind === 'myself' ? myselfPick : kind === 'story' ? storyChoice : kind === 'canvas' ? canvasChoice : null;
  if (!handler) return api.answerCallbackQuery({ callback_query_id: query.id });
  if (!isOwner(query.from.id) && (await isSilent())) return api.answerCallbackQuery({ callback_query_id: query.id });
  try {
    return await handler(query);
  } catch (e) {
    const detail = e instanceof BotApiError ? `${e.method} ${e.code} ${e.description}` : '';
    console.error(`botão ${kind} falhou: ${detail}`, e);
    try {
      await api.answerCallbackQuery({ callback_query_id: query.id, text: 'Não consegui concluir agora. Tente de novo em instantes.', show_alert: true });
    } catch (notifyError) {
      console.error('aviso de falha também não foi enviado:', notifyError);
    }
  }
}
