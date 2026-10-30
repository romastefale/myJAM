// endpoints/diag.js — TEMPORÁRIO: guarda a última marca do Mini App e mostra o botão de menu configurado.
import { api, fetch } from 'sdk';
import { LASTFM_API_KEY } from '../lib/config.js';
import { getLinked } from '../lib/store.js';
import { getRecentTrack } from '../lib/lastfm.js';
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
  if (input.spot) {
    const linked = await getLinked(ctx.initData.user.id);
    const track = await getRecentTrack(linked.lastfmUser, LASTFM_API_KEY, fetch);
    const out = { faixa: `${track.artist} - ${track.name}` };
    const it = await fetch(`https://itunes.apple.com/search?term=${encodeURIComponent(`${track.artist} ${track.name}`)}&media=music&entity=song&limit=5`);
    out.itunes = it.status;
    const dados = await it.json();
    const hit = (dados.results || [])[0];
    out.achado = hit ? `${hit.artistName} - ${hit.trackName}` : null;
    out.apple = hit ? hit.trackViewUrl : null;
    if (hit) {
      const od = await fetch(`https://api.song.link/v1-alpha.1/links?url=${encodeURIComponent(hit.trackViewUrl)}&userCountry=BR`);
      out.odesli = od.status;
      const texto = await od.text();
      let j = null;
      try { j = JSON.parse(texto); } catch (e) { out.odesliCorpo = texto.slice(0, 200); }
      out.spotify = j && j.linksByPlatform && j.linksByPlatform.spotify ? j.linksByPlatform.spotify.url : null;
    }
    return out;
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
