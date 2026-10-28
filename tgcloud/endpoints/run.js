// endpoints/run.js — um botão do Mini App executa o comando do bot e a resposta vai para o privado da pessoa.
import { EndpointError } from 'sdk';
import { ROUTES } from '../lib/routes.js';
import { isOwner } from '../lib/config.js';
import { isSilent } from '../lib/store.js';

// Só comandos que respondem a quem os pede; os demais continuam só no chat.
const ALLOWED = ['tly', 'albnow', 'tstory', 'weekfm', 'monthfm', 'nowp', 'tnow', 'tnowall', 'songcharts', 'radiofm'];

export default async function (input, ctx) {
  const name = String(input && input.command);
  if (!ALLOWED.includes(name)) throw new EndpointError('Comando desconhecido.', { code: 'UNKNOWN_COMMAND' });
  const from = ctx.initData.user;
  if (!isOwner(from.id) && (await isSilent())) throw new EndpointError('O bot está em modo silencioso.', { code: 'SILENT' });
  // Mesma forma de uma Message do privado: os comandos só leem from, chat e (às vezes) message_id.
  const message = { message_id: 0, from, chat: { id: from.id, type: 'private' }, text: `/${name}` };
  try {
    await ROUTES[name](message, '');
  } catch (e) {
    console.error(`/${name} (Mini App) falhou`, e);
    throw new EndpointError('Não consegui concluir agora. Tente de novo em instantes.', { code: 'FAILED' });
  }
  return { ok: true };
}
