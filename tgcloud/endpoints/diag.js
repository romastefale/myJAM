// endpoints/diag.js — TEMPORÁRIO: guarda a última marca do Mini App e mostra o botão de menu configurado.
import { api } from 'sdk';
import { getFlag, setFlag } from '../lib/store.js';

export default async function (input, ctx) {
  if (input.send) {
    const id = ctx.initData.user.id;
    await api.sendMessage({
      chat_id: id,
      text: 'Teste 2 de abertura. Toque em A, B e C e me diga quais abrem.',
      reply_markup: { inline_keyboard: [
        [{ text: 'A · myJAM (nosso endereço)', web_app: { url: 'https://app8786464392.tgcloud.ai/' } }],
        [{ text: 'B · abafigurinhas (endereço que funciona)', web_app: { url: 'https://app8669881629.tgcloud.ai/' } }],
        [{ text: 'C · página externa qualquer', web_app: { url: 'https://example.com/' } }],
      ] },
    });
    return { sent: true };
  }
  if (input.read) {
    const me = await api.getMe();
    return {
      open: await getFlag('diag_open'),
      err: await getFlag('diag_err'),
      menuDefault: await api.getChatMenuButton({}),
      menuChat: await api.getChatMenuButton({ chat_id: ctx.initData.user.id }),
      me,
    };
  }
  await setFlag(`diag_${input.key}`, `${new Date().toISOString()} user=${ctx.initData.user.id} ${String(input.note).slice(0, 400)}`);
  return { ok: true };
}
