// Envio da capa na mensagem rica: file_id guardado (se houver) -> baixar com fetch e enviar como
// InputFile (bytes + InputFile fazem o upload; a imagem tem no máximo 10 MB).
import { fetch, InputFile, BotApiError } from 'sdk';
import { fetchRetry, readBytes, NetworkError } from './http.js';
import { getPhotoId } from './store.js';
import { sendRich } from './telegram.js';

const PHOTO_MAX = 10 * 1024 * 1024; // sendPhoto.photo: no máximo 10 MB

export class PhotoError extends Error {
  constructor(message) {
    super(message);
    this.name = 'PhotoError';
  }
}

export async function downloadImage(url) {
  const res = await fetchRetry(fetch, url);
  if (!res.ok) throw new PhotoError(`a capa respondeu HTTP ${res.status}`);
  const type = String(res.headers.get('content-type') || '').split(';')[0].trim() || 'image/jpeg';
  try {
    return { bytes: await readBytes(res, PHOTO_MAX), type };
  } catch (e) {
    if (e instanceof NetworkError) throw new PhotoError('a capa passa de 10 MB');
    throw e;
  }
}

// Mensagem rica com a capa no topo (cartões de faixa e quadros com tabela). Ordem: file_id guardado ->
// baixar e enviar como InputFile; cada capa é tentada, cada falha esperada (BotApiError do Telegram ou PhotoError ao baixar) passa para a próxima e fica no log; se todas falharem, o último erro sobe.
// Sem capa, vai só a mensagem rica.
export async function sendRichCard(chatId, covers, html) {
  let last = null;
  for (const url of covers || []) {
    try {
      const cached = await getPhotoId(url);
      if (cached) {
        try {
          return await sendRich(chatId, html, cached);
        } catch (e) {
          if (!(e instanceof BotApiError && e.code === 400)) throw e;
          console.error(`file_id guardado recusado para ${url}: ${e.description}`);
        }
      }
      const { bytes, type } = await downloadImage(url);
      return await sendRich(chatId, html, new InputFile(bytes, type === 'image/png' ? 'cover.png' : 'cover.jpg', { type }));
    } catch (e) {
      if (!(e instanceof BotApiError || e instanceof PhotoError)) throw e;
      console.error(`capa ${url} não enviada: ${e instanceof BotApiError ? `${e.code} ${e.description}` : e.message}`);
      last = e;
    }
  }
  if (last) throw last;
  return sendRich(chatId, html);
}
