// endpoints/diag.js — TEMPORÁRIO: guarda a última marca do Mini App e mostra o botão de menu configurado.
import { api } from 'sdk';
import { getFlag, setFlag } from '../lib/store.js';
import { queueSound } from '../lib/story_sound.js';

export default async function (input, ctx) {
  if (input.sound) {
    const u = ctx.initData.user;
    await queueSound({ from: u, chat: { id: u.id, type: 'private' } });
    return { ok: true };
  }
  if (input.read) {
    return {
      open: await getFlag('diag_open'),
      err: await getFlag('diag_err'),
      menuDefault: await api.getChatMenuButton({}),
    };
  }
  await setFlag(`diag_${input.key}`, `${new Date().toISOString()} user=${ctx.initData.user.id} ${String(input.note).slice(0, 400)}`);
  return { ok: true };
}
