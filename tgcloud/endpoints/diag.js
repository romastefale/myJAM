// endpoints/diag.js — TEMPORÁRIO: guarda a última marca do Mini App e mostra o botão de menu configurado.
import { api } from 'sdk';
import { getFlag, setFlag } from '../lib/store.js';

export default async function (input, ctx) {
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
