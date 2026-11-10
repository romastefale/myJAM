// Protótipo isolado do Live Card (Bot API 10.4). Não modifica /playing.
import { api, fetch } from 'sdk';
import { LASTFM_API_KEY } from './config.js';
import { getLinked } from './store.js';
import { getRecentTrack, getUserTrackPlays } from './lastfm.js';

const DEMO = { name: 'Get Lucky', artist: 'Daft Punk', album: 'Random Access Memories', nowPlaying: false, plays: 42 };

export async function widgetState(userId) {
  const linked = await getLinked(userId);
  if (!linked || !LASTFM_API_KEY) {
    return { track: DEMO, mode: 'demo', updatedAt: Date.now() };
  }
  const track = await getRecentTrack(linked.lastfmUser, LASTFM_API_KEY, fetch);
  if (!track) return { track: null, mode: 'live', updatedAt: Date.now() };
  const plays = await getUserTrackPlays(track.artist, track.name, linked.lastfmUser, LASTFM_API_KEY, fetch);
  return {
    track: { name: track.name, artist: track.artist, album: track.album || '', nowPlaying: !!track.nowPlaying, plays: Number(plays) || 0 },
    mode: 'live', updatedAt: Date.now(),
  };
}

// HTML autocontido: QuickJS do Telegram não tem acesso à rede nem a scripts externos.
export const WIDGET_HTML = [
  '<!doctype html><html><head><style>',
  '*{box-sizing:border-box}body{margin:0;padding:14px;font-family:system-ui,sans-serif;color:var(--tg-theme-text-color)}',
  '.head{display:flex;justify-content:space-between;align-items:center;gap:8px}.brand{font-size:12px;font-weight:800;letter-spacing:1px}',
  '.tag{font-size:10px;color:var(--tg-theme-hint-color)}.art{margin:16px 0;padding:17px;border-radius:16px;background:var(--tg-theme-secondary-bg-color)}',
  '.name{font-size:21px;font-weight:800;overflow-wrap:anywhere}.artist{font-size:14px;margin-top:5px}.meta{font-size:12px;color:var(--tg-theme-hint-color);margin-top:8px}',
  '.tabs{display:flex;gap:6px;margin:10px 0}.tabs button{flex:1;padding:9px 4px;border-radius:10px;font-size:12px}',
  '.tabs button.sel{background:var(--tg-theme-button-color);color:var(--tg-theme-button-text-color)}',
  '.detail{min-height:52px;font-size:13px;padding:8px 2px;overflow-wrap:anywhere}',
  '#refresh{width:100%;padding:11px;border-radius:12px;margin-top:8px}',
  '#status{min-height:17px;font-size:11px;color:var(--tg-theme-hint-color);margin-top:8px}',
  '</style></head><body>',
  '<div class="head"><span class="brand">♫ myJAM LIVE</span><span class="tag" id="mode">BOT API 10.4</span></div>',
  '<div class="art"><div class="tag" id="live">CARREGANDO</div><div class="name" id="name">...</div><div class="artist" id="artist"></div><div class="meta" id="album"></div></div>',
  '<div class="tabs"><button id="tab-track" class="sel">Música</button><button id="tab-album">Álbum</button><button id="tab-stats">Estatísticas</button></div>',
  '<div class="detail" id="detail"></div><button id="refresh">↻ Atualizar pelo bot</button><div id="status"></div>',
  '<script>',
  '(function(){',
  'var W=window.TelegramWidget;var tab="track";var state=null;var pending=false;',
  'function el(id){return document.getElementById(id)}',
  'function read(){try{return JSON.parse(W.chatData||"null")}catch(e){return null}}',
  'function draw(){state=read();var t=state&&state.track;',
  'el("name").textContent=t?t.name:"Nenhuma faixa encontrada";',
  'el("artist").textContent=t?t.artist:"";el("album").textContent=t?(t.album||"Álbum não informado"):"";',
  'el("live").textContent=t&&t.nowPlaying?"● TOCANDO AGORA":"ÚLTIMA FAIXA";',
  'el("mode").textContent=state&&state.mode==="demo"?"MODO DEMO":"LAST.FM";',
  '["track","album","stats"].forEach(function(x){el("tab-"+x).className=x===tab?"sel":""});',
  'el("detail").textContent=!t?"Vincule seu Last.fm com /lastfm usuario.":tab==="album"?"Álbum: "+(t.album||"não informado"):tab==="stats"?"Reproduções desta faixa: "+t.plays:("Faixa: "+t.name+" · "+t.artist);',
  '}',
  'function select(x){tab=x;draw()}',
  'el("tab-track").addEventListener("click",function(){select("track")});',
  'el("tab-album").addEventListener("click",function(){select("album")});',
  'el("tab-stats").addEventListener("click",function(){select("stats")});',
  'el("refresh").addEventListener("click",function(){',
  'if(pending)return;pending=true;el("refresh").disabled=true;el("status").textContent="Solicitando atualização…";',
  'W.request("refresh").then(function(answer){',
  'el("status").textContent=answer.result||"Atualização solicitada.";',
  '},function(err){el("status").textContent="Erro: "+(err.code||"FAILED")}).finally(function(){pending=false;el("refresh").disabled=false})',
  '});',
  'W.onEvent("chatDataChanged",function(){draw();el("status").textContent="Cartão atualizado."});',
  'draw();W.ready();',
  '})();',
  '</script></body></html>',
].join('\n');

export async function widgettest(message) {
  if (message.chat.type !== 'private') {
    return api.sendMessage({ chat_id: message.chat.id, text: 'Use /widgettest no privado do bot. Widgets em grupos ainda não estão disponíveis em produção.' });
  }
  let state;
  try {
    state = await widgetState(message.from.id);
  } catch (e) {
    console.error('widgettest: Last.fm indisponível', e);
    state = { track: DEMO, mode: 'demo', updatedAt: Date.now() };
  }
  return api.sendWidget({
    chat_id: message.chat.id,
    html: WIDGET_HTML,
    height: 340,
    chat_data: JSON.stringify(state),
    allow_queries: true,
    caption: 'myJAM Live Card · protótipo /widgettest',
  });
}
