// endpoints/diag.js — TEMPORÁRIO: guarda a última marca do Mini App e mostra o botão de menu configurado.
import { api } from 'sdk';
import { getFlag, setFlag } from '../lib/store.js';

export default async function (input, ctx) {
  if (input.send) {
    const id = ctx.initData.user.id;
    await api.sendMessage({
      chat_id: id,
      text: 'Teste 3: links comuns (sem Mini App). Toque em D e E e me diga se aparece alguma página.',
      reply_markup: { inline_keyboard: [
        [{ text: 'D · endereço do myJAM', url: 'https://app8786464392.tgcloud.ai/' }],
        [{ text: 'E · endereço do abafigurinhas', url: 'https://app8669881629.tgcloud.ai/' }],
      ] },
    });
    return { sent: true };
  }
  if (input.cmds) {
    const id = ctx.initData.user.id;
    const out = {};
    for (const [nome, extra] of [
      ['default', {}],
      ['privado', { scope: { type: 'all_private_chats' } }],
      ['grupos', { scope: { type: 'all_group_chats' } }],
      ['admins', { scope: { type: 'all_chat_administrators' } }],
      ['dono', { scope: { type: 'chat', chat_id: id } }],
      ['pt', { language_code: 'pt' }],
      ['en', { language_code: 'en' }],
    ]) {
      out[nome] = (await api.getMyCommands(extra)).map((c) => c.command).join(' ');
    }
    return out;
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
