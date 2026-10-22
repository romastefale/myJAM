// Envio de mensagens. Parâmetros conferidos contra as tabelas de sendMessage/sendPhoto do Bot API.
import { api, BotApiError } from 'sdk';

export const HTML = 'HTML';

// Mostra "digitando…" enquanto o comando consulta serviços externos (Bot API: sendChatAction).
// Falha aqui nunca deve impedir a resposta.
export async function typing(chatId, action = 'typing') {
  try {
    await api.sendChatAction({ chat_id: chatId, action });
  } catch (e) {
    if (!(e instanceof BotApiError)) throw e;
  }
}

// Texto HTML sem prévia de link, como resposta a `message`.
export function reply(message, text, extra = {}) {
  return api.sendMessage({
    chat_id: message.chat.id,
    text,
    parse_mode: HTML,
    link_preview_options: { is_disabled: true },
    ...extra,
  });
}

// Mensagem rica (Bot API 10.3, sendRichMessage). `photo` (file_id ou InputFile) vira a capa no topo:
// InputRichMessage.media lista a mídia e o html a usa com <img src="tg://photo?id=…"/>.
export function sendRich(chatId, html, photo = null) {
  const rich = { html, skip_entity_detection: true };
  if (photo) {
    rich.html = `<img src="tg://photo?id=cover"/>${html}`;
    rich.media = [{ id: 'cover', media: { type: 'photo', media: photo } }];
  }
  return api.sendRichMessage({ chat_id: chatId, rich_message: rich });
}
