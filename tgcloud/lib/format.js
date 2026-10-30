// Textos e formatação. Parse mode HTML (Bot API): `<`, `>` e `&` de texto de terceiros são
// escapados. Tags usadas, todas do "HTML style" do Bot API: b, i, code, blockquote
// (com `expandable`) e tg-time (formato "r" = tempo relativo, localizado pelo cliente).

export function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Páginas do Last.fm (Termos de Serviço 2.7): usuário em /user/<nome>; artista, álbum e faixa no
// catálogo em /music/<artista>, /music/<artista>/<álbum> e /music/<artista>/_/<faixa>.
const LASTFM_SITE = 'https://www.last.fm';
const seg = (v) => encodeURIComponent(v).replace(/%20/g, '+');
export const lfmArtist = (a) => `${LASTFM_SITE}/music/${seg(a)}`;
export const lfmAlbum = (a, al) => `${lfmArtist(a)}/${seg(al)}`;
export const lfmTrack = (a, t) => `${lfmArtist(a)}/_/${seg(t)}`;

export const escapeAttr = (value) => escapeHtml(value).replace(/"/g, '&quot;');
// text já escapado; url vira atributo href.
export const link = (url, text) => `<a href="${escapeAttr(url)}">${text}</a>`;
// Marca a pessoa no Telegram (Rich HTML: <a href="tg://user?id=…"> é uma menção de usuário).
export const mention = (id, name) => link(`tg://user?id=${Number(id)}`, escapeHtml(cut(name, 40)));
// Nome de exibição (nome + sobrenome); sem nome, @username; por último o id.
export function displayName(user) {
  const full = [user.first_name, user.last_name].filter(Boolean).join(' ').trim();
  return full || (user.username ? `@${user.username}` : String(user.id));
}
export const mentionUser = (user) => mention(user.id, displayName(user));

// Bot API: a legenda de uma foto tem no máximo 1024 caracteres (após o parse das entidades).
// Cada campo é cortado antes de escapar; vários campos de até 200 + texto fixo ficam abaixo do limite.
const FIELD_MAX = 200;
export function cut(value, max = FIELD_MAX) {
  const s = String(value ?? '');
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}

// <tg-time unix="…" format="r">: o texto interno é só o fallback (data em UTC).
export function timeTag(uts) {
  const fallback = new Date(uts * 1000).toISOString().slice(0, 16).replace('T', ' ') + ' UTC';
  return `<tg-time unix="${Number(uts)}" format="r">${fallback}</tg-time>`;
}

// Legenda de foto / texto (parse mode HTML). Limite de legenda: 1024 caracteres.
export function trackCaption(track, user, userPlays) {
  // linha 1: a pessoa; linha 2: ♫ reproduções · **faixa** — _artista_
  const head = playsText(userPlays) ? `${playsText(userPlays)} · ` : '';
  return [
    mentionUser(user),
    `${head}<b>${link(lfmTrack(track.artist, track.name), escapeHtml(cut(track.name)))}</b> — <i>${escapeHtml(cut(track.artist))}</i>`,
  ].join('\n');
}

// Mesmo molde numa mensagem rica (Bot API 10.3): a pessoa como título (h2), a contagem como h3 (só
// com N > 0) e a faixa com o artista num parágrafo; a capa vai no topo (sendRichCard).
export function richTrack(track, user, userPlays) {
  const plays = playsText(userPlays);
  return `<h2>${mentionUser(user)}</h2>` +
    (plays ? `<h3>${plays}</h3>` : '') +
    `<p><b>${link(lfmTrack(track.artist, track.name), escapeHtml(cut(track.name)))}</b> — <i>${escapeHtml(cut(track.artist))}</i></p>`;
}

// Botões da própria mensagem rica (Bot API 10.3, <tg-button> dentro de <tg-button-row>), no lugar do teclado
// inline. type="callback_data": o clique chega como callback_query com `data` (1-64 bytes).
// style: 'primary' | 'success' | 'danger' | 'link' (opcional).
export const richButton = (label, data, style) =>
  `<tg-button type="callback_data"${style ? ` style="${style}"` : ''} data="${escapeAttr(data)}">${escapeHtml(label)}</tg-button>`;
// align: 'left' | 'center' | 'right'; null deixa a linha sem alinhamento (os botões ocupam a largura da linha).
export const richRow = (buttons, align = 'center') => `<tg-button-row${align ? ` align="${align}"` : ''}>${buttons.join('')}</tg-button-row>`;

// ---- Mensagens ricas (Bot API 10.3, Rich HTML) para quadros com tabela. Blocos conferidos nas
// respostas reais do sendRichMessage: h2/h3 → heading, p → paragraph, table → table, tg-time →
// date_time. Contagem de reproduções do usuário: "♫ <número> plays" (1 → "play"); sem número ou 0 = não mostra.
export const playsText = (n) => (Number(n) > 0 ? `♫ ${n} ${Number(n) === 1 ? 'play' : 'plays'}` : '');

// Tabela compacta. headers: [{ text, right? }]; rows: arrays de HTML já escapado.
export function richTable(headers, rows) {
  const th = headers.map((h) => `<th${h.right ? ' align="right"' : ''}>${h.text}</th>`).join('');
  const body = rows.map((cells) =>
    '<tr>' + cells.map((c, i) => `<td${headers[i] && headers[i].right ? ' align="right"' : ''}>${c}</td>`).join('') + '</tr>').join('');
  return `<table compact><tr>${th}</tr>${body}</table>`;
}


export const PERIOD_LABEL = {
  '7day': 'últimos 7 dias',
  '1month': 'último mês',
  '3month': 'últimos 3 meses',
  '6month': 'últimos 6 meses',
  '12month': 'último ano',
  overall: 'de todos os tempos',
};

export const START_TEXT =
  '<h2>Bem-vindo ao myJAMrobot</h2>' +
  '<p>Conecte seu Last.fm para mostrar o que você está ouvindo:</p>' +
  '<p><code>/lastfm seu_usuario</code></p>' +
  '<p>Depois use <code>/playing</code>. Veja tudo com /help.</p>';

export function helpText(chatType, owner = false) {
  const cmd = (c, d) => `<p><code>${c}</code> — ${d}</p>`;
  const out = ['<h2>Comandos</h2>'];
  out.push(cmd('/start', 'apresentação do bot.'));
  out.push(cmd('/help', 'esta lista.'));
  out.push(cmd('/lastfm usuario', 'vincula seu usuário do Last.fm.'));
  out.push(cmd('/lastfmoff', 'remove o vínculo.'));
  out.push(cmd('/playing', 'sua música atual ou a última tocada.'));
  out.push(cmd('/tly', 'trecho da letra da música atual.'));
  out.push(cmd('/albnow', 'o álbum da música atual.'));
  out.push(cmd('/radiofm termo', 'busca uma música (sem termo, pergunta qual).'));
  out.push(cmd('/myself', 'menu dos seus extratos semanal e mensal.'));
  out.push(cmd('/weekfm', 'seus mais ouvidos nos últimos 7 dias.'));
  out.push(cmd('/monthfm', 'seus mais ouvidos no último mês.'));
  if (chatType === 'private') {
    out.push(cmd('/nowp', 'envia sua música atual para um grupo.'));
  } else {
    out.push(cmd('/tnow', 'o que os membros do grupo estão ouvindo.'));
    out.push(cmd('/songcharts', 'ranking de artistas do grupo (<code>/songcharts 1month</code>).'));
  }
  if (owner && chatType === 'private') {
    out.push('<h3>Só para o dono</h3>');
    out.push(cmd('/tnowall', 'o que todos os vinculados ouvem.'));
    out.push(cmd('/songchartsall', 'ranking de artistas de todos (<code>/songchartsall 1month</code>).'));
    out.push('<p><code>/weekall</code> e <code>/monthall</code> — o mesmo, semanal e mensal.</p>');
    out.push(cmd('/tmn id usuario', 'vincula o Last.fm de alguém.'));
    out.push(cmd('/tpv id tnow|mosaico|all|off', 'mascara alguém nos ouvintes.'));
    out.push(cmd('/onoff on|off|status', 'modo silencioso.'));
  }
  out.push('<p>Mande um link de uma faixa do Spotify (sem precisar de comando) para receber o story com o Canvas dela de fundo.</p>');
  out.push('<p>Em qualquer chat: <code>@bot</code> abre o modo inline com a sua música e a letra.</p>');
  return out.join('');
}
