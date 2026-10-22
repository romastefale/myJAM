// Temporário (só no runner): roda /albnow e /weekfm de verdade, no runtime real, pra confirmar o novo
// layout (H2 = pessoa, H3 = plays) nos dois comandos que mudaram.
import { OWNER_IDS } from '../lib/config.js';
import message from '../handlers/message.js';

const owner = OWNER_IDS[0];
const from = { id: owner, first_name: '𝙋𝙞', is_bot: false };
const chat = { id: owner, type: 'private' };
const say = (label, v) => console.log(`## ${label}: ${v}`.slice(0, 700));

export default async function () {
  const t0 = Date.now();
  for (const text of ['/albnow', '/weekfm']) {
    try {
      await message({ message_id: Math.floor(Math.random() * 1e6), from, chat, date: 0, text });
      say(text, 'handler terminou');
    } catch (e) {
      say(text, `ERRO ${e && e.message}`);
    }
  }
  say('tempo total ms', Date.now() - t0);
  return 'fim';
}
