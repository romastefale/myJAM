// Handler do update.widget_query da Bot API 10.4.
import { api, BotApiError } from 'sdk';
import { widgetState } from '../lib/live_widget.js';
import { isOwner } from '../lib/config.js';
import { isSilent } from '../lib/store.js';

export default async function (query) {
  const answer = (data) => api.answerWidgetQuery({ widget_query_id: query.id, data });
  if (!query.from || !query.chat || query.chat.type !== 'private' ||
      query.chat.id !== query.from.id || !query.message_id) {
    return answer('Este protótipo funciona somente no privado.');
  }
  if (query.data !== 'refresh' || (query.type && query.type.type !== 'data')) {
    return answer('Ação desconhecida.');
  }
  if (!isOwner(query.from.id) && (await isSilent())) {
    return answer('Bot em modo silencioso.');
  }

  // A resposta precisa chegar em até 15 segundos. Confirmamos antes da consulta externa.
  await answer('Consultando Last.fm…');
  try {
    const state = await widgetState(query.from.id);
    await api.editMessageWidgetData({
      chat_id: query.chat.id,
      message_id: query.message_id,
      chat_data: JSON.stringify(state),
    });
  } catch (e) {
    if (e instanceof BotApiError && /message is not modified/i.test(e.description || '')) return;
    console.error('widget_query refresh falhou:', e);
    // A consulta já foi confirmada; não enviar outra resposta para o mesmo query_id.
  }
}
