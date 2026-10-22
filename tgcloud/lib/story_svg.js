// Monta o SVG do story (1080x1920) com as mesmas informações do /playing.
const W = 1080, H = 1920;
export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Quebra em linhas por quantidade de caracteres (a fonte é proporcional; é uma estimativa) com reticências.
export function wrap(text, maxChars, maxLines) {
  const words = String(text ?? '').trim().split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const word = w.length > maxChars ? w.slice(0, maxChars - 1) + '…' : w;
    if (!cur) cur = word;
    else if ((cur + ' ' + word).length <= maxChars) cur += ' ' + word;
    else { lines.push(cur); cur = word; }
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    const keep = lines.slice(0, maxLines);
    let last = keep[maxLines - 1];
    last = last.length >= maxChars ? last.slice(0, maxChars - 1) : last;
    keep[maxLines - 1] = last.replace(/[\s,.;:-]+$/, '') + '…';
    return keep;
  }
  return lines;
}

// Passo 1 (barato): a capa vira um fundo pequeno e desfocado, 216x384 px; no passo 2 ele é só esticado
// 5x. Desfoque forte (std 22 = ~110 px no final): com std 7 num fundo de 108x192, as formas da capa
// continuavam visíveis como "camadas" e apareciam faixas horizontais.
export function blurSvg(cover) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="216" height="384" viewBox="0 0 216 384">
  <defs><filter id="b" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="22"/></filter></defs>
  <image href="${cover}" x="-124" y="0" width="464" height="384" preserveAspectRatio="xMidYMid slice" filter="url(#b)"/></svg>`;
}

// Área segura: o Instagram cobre ~250 px em cima (botões) e embaixo (barra "Add a caption…" e menu) do
// story. Tudo fica entre SAFE_TOP e SAFE_BOTTOM, e o bloco inteiro é centrado nessa faixa; a capa encolhe
// (480 a 700 px) quando o texto precisa de mais espaço.
const SAFE_TOP = 260, SAFE_BOTTOM = 1650, CARD_MAX = 700, CARD_MIN = 480;

// Posições de tudo, de cima para baixo (em px do canvas 1080x1920). Compartilhada por storySvg e por
// cardBox (a rotina de vídeo precisa saber onde fica o quadrado da capa).
function layout({ title, artist, album, plays, bot }) {
  const titleSize = String(title).length > 34 ? 52 : 64;
  const titleStep = titleSize + 12;
  const titleLines = wrap(title, titleSize === 52 ? 32 : 26, 2);
  const artistLines = wrap(artist, 38, 2);
  const albumText = album ? wrap(album, 50, 1)[0] : '';
  const has = Number(plays) > 0;
  const hasFooter = !!(bot && bot.text);

  // Alturas, de cima para baixo (relativas ao topo do bloco).
  const headBase = 46, cardTop = 112;
  const afterCard = 84 + (titleLines.length - 1) * titleStep + 62 + (artistLines.length - 1) * 52
    + (albumText ? 48 : 0) + 28 + (has ? 64 + 100 : 0) + (hasFooter ? 56 + 24 : 0);
  const safeH = SAFE_BOTTOM - SAFE_TOP;
  // Valores inteiros: a rotina de vídeo posiciona o vídeo no quadrado da capa pixel a pixel.
  const C = Math.round(Math.max(CARD_MIN, Math.min(CARD_MAX, safeH - cardTop - afterCard)));
  const top = Math.round(SAFE_TOP + Math.max(0, (safeH - (cardTop + C + afterCard)) / 2));

  const cardX = Math.round((W - C) / 2), cardY = top + cardTop;
  const t1 = cardY + C + 84;
  const lastTitle = t1 + (titleLines.length - 1) * titleStep;
  const a1 = lastTitle + 62;
  const lastArtist = a1 + (artistLines.length - 1) * 52;
  const b1 = lastArtist + 48;
  const textEnd = (albumText ? b1 : lastArtist) + 28;
  const pillY = textEnd + 64;
  const footY = (has ? pillY + 100 : textEnd) + 56;
  return { titleSize, titleStep, titleLines, artistLines, albumText, has, hasFooter, C, cardX, cardY, t1, a1, b1, pillY, footY, headY: top + headBase };
}

// Quadrado onde fica a capa: { x, y, size }.
export function cardBox(args) {
  const l = layout(args);
  return { x: l.cardX, y: l.cardY, size: l.C };
}

// `m` traz as larguras medidas (m.who, m.status, m.note, m.pill, m.footer): o nome e a frase são textos
// separados, porque letras matemáticas no nome fazem o trecho seguinte da mesma linha cair numa fonte
// serifada; o símbolo ♫ também fica à parte do número pelo mesmo motivo.
export function storySvg({ title, artist, album, plays, who, status, cover, bgSmall, bot, m }) {
  const { titleSize, titleStep, titleLines, artistLines, albumText, has, hasFooter, C, cardX, cardY, t1, a1, b1, pillY, footY, headY } =
    layout({ title, artist, album, plays, bot });
  const headX = 540 - (m.who + 16 + m.status) / 2;
  const bg = cover && bgSmall
    ? `<image href="${bgSmall}" x="0" y="0" width="${W}" height="${H}" preserveAspectRatio="none"/>
       <rect width="${W}" height="${H}" fill="#000" opacity="0.48"/>`
    : `<rect width="${W}" height="${H}" fill="url(#grad)"/>`;
  const card = cover
    ? `<image href="${cover}" x="${cardX}" y="${cardY}" width="${C}" height="${C}" preserveAspectRatio="xMidYMid slice" clip-path="url(#round)"/>`
    : `<rect x="${cardX}" y="${cardY}" width="${C}" height="${C}" rx="36" fill="#ffffff" opacity="0.10"/>
       <text x="540" y="${cardY + C / 2 + 120}" font-family="DejaVu Sans" font-size="320" fill="#ffffff" opacity="0.55" text-anchor="middle">♫</text>`;
  const titleSvg = titleLines.map((l, i) => `<text x="540" y="${t1 + i * titleStep}" font-family="Inter" font-weight="700" font-size="${titleSize}" fill="#fff" text-anchor="middle">${esc(l)}</text>`).join('');
  const artistSvg = artistLines.map((l, i) => `<text x="540" y="${a1 + i * 52}" font-family="Inter" font-weight="500" font-size="44" fill="#fff" opacity="0.88" text-anchor="middle">${esc(l)}</text>`).join('');
  const albumSvg = albumText ? `<text x="540" y="${b1}" font-family="Inter" font-weight="500" font-size="34" fill="#fff" opacity="0.6" text-anchor="middle">${esc(albumText)}</text>` : '';

  // Contagem: "♫ N plays" (1 → "play"), só quando N > 0.
  const word = Number(plays) === 1 ? 'play' : 'plays';
  const pillTotal = has ? m.note + 28 + m.pill : 0;
  const pillW = has ? Math.max(260, Math.round(pillTotal + 88)) : 0;
  const pill = has ? `
    <rect x="${540 - pillW / 2}" y="${pillY}" width="${pillW}" height="100" rx="50" fill="#ffffff" opacity="0.16"/>
    <text x="${540 - pillTotal / 2}" y="${pillY + 70}" font-family="DejaVu Sans" font-size="60" fill="#fff">♫</text>
    <text x="${540 - pillTotal / 2 + m.note + 28}" y="${pillY + 70}" font-family="Inter, DejaVu Sans" font-weight="700" font-size="60" fill="#fff">${esc(plays)} ${word}</text>` : '';

  // Rodapé pequeno: ícone do bot, @usuário • nome. O texto começa depois do ícone; o conjunto é centrado
  // pela largura medida (m.footer).
  let footer = '';
  if (hasFooter) {
    const size = 30, r = 20, gap = 14, cy = footY;
    const iconW = bot.icon ? 2 * r + gap : 0;
    const x0 = 540 - (iconW + m.footer) / 2;
    const icon = bot.icon
      ? `<clipPath id="botIcon"><circle cx="${x0 + r}" cy="${cy}" r="${r}"/></clipPath>
         <image href="${bot.icon}" x="${x0}" y="${cy - r}" width="${2 * r}" height="${2 * r}" preserveAspectRatio="xMidYMid slice" clip-path="url(#botIcon)"/>`
      : '';
    footer = `${icon}<text x="${x0 + iconW}" y="${cy + 10}" font-family="Inter, DejaVu Sans" font-weight="500" font-size="${size}" fill="#fff" fill-opacity="0.7">${esc(bot.text)}</text>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
  <defs>
    <radialGradient id="sh" cx="0.5" cy="0.5" r="0.5"><stop offset="0.82" stop-color="#000" stop-opacity="0.45"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
    <clipPath id="round"><rect x="${cardX}" y="${cardY}" width="${C}" height="${C}" rx="36"/></clipPath>
    <linearGradient id="grad" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#1b1830"/><stop offset="1" stop-color="#5a3470"/></linearGradient>
  </defs>
  ${bg}
  <text x="${headX}" y="${headY}" font-family="Inter, DejaVu Sans" font-weight="700" font-size="54" fill="#fff">${esc(who)}</text>
  <text x="${headX + m.who + 16}" y="${headY}" font-family="Inter, DejaVu Sans" font-weight="500" font-size="44" fill="#fff" fill-opacity="0.78">${esc(status)}</text>
  <rect x="${cardX - 20}" y="${cardY - 20}" width="${C + 40}" height="${C + 40}" rx="56" fill="url(#sh)"/>
  ${card}
  ${titleSvg}${artistSvg}${albumSvg}${pill}${footer}
</svg>`;
}

// Mesmo layout do story (storySvg), mas sem o fundo desfocado — fica transparente aí, para servir de
// camada por cima de um vídeo (o Canvas do Spotify) que preenche o quadro inteiro. A capa continua no
// mesmo quadrado de sempre (mesma fonte do /tstory: a imagem do álbum do Last.fm). Textos, pílula e
// rodapé na mesma posição de sempre.
export function overlaySvg({ title, artist, album, plays, who, status, cover, bot, m }) {
  const { titleStep, titleLines, artistLines, albumText, has, hasFooter, titleSize, cardX, cardY, C, t1, a1, b1, pillY, footY, headY } =
    layout({ title, artist, album, plays, bot });
  const headX = 540 - (m.who + 16 + m.status) / 2;
  const card = cover
    ? `<rect x="${cardX - 20}" y="${cardY - 20}" width="${C + 40}" height="${C + 40}" rx="56" fill="url(#sh)"/>
       <image href="${cover}" x="${cardX}" y="${cardY}" width="${C}" height="${C}" preserveAspectRatio="xMidYMid slice" clip-path="url(#round)"/>`
    : '';
  const titleSvg = titleLines.map((l, i) => `<text x="540" y="${t1 + i * titleStep}" font-family="Inter" font-weight="700" font-size="${titleSize}" fill="#fff" text-anchor="middle">${esc(l)}</text>`).join('');
  const artistSvg = artistLines.map((l, i) => `<text x="540" y="${a1 + i * 52}" font-family="Inter" font-weight="500" font-size="44" fill="#fff" opacity="0.88" text-anchor="middle">${esc(l)}</text>`).join('');
  const albumSvg = albumText ? `<text x="540" y="${b1}" font-family="Inter" font-weight="500" font-size="34" fill="#fff" opacity="0.6" text-anchor="middle">${esc(albumText)}</text>` : '';

  const word = Number(plays) === 1 ? 'play' : 'plays';
  const pillTotal = has ? m.note + 28 + m.pill : 0;
  const pillW = has ? Math.max(260, Math.round(pillTotal + 88)) : 0;
  const pill = has ? `
    <rect x="${540 - pillW / 2}" y="${pillY}" width="${pillW}" height="100" rx="50" fill="#ffffff" opacity="0.16"/>
    <text x="${540 - pillTotal / 2}" y="${pillY + 70}" font-family="DejaVu Sans" font-size="60" fill="#fff">♫</text>
    <text x="${540 - pillTotal / 2 + m.note + 28}" y="${pillY + 70}" font-family="Inter, DejaVu Sans" font-weight="700" font-size="60" fill="#fff">${esc(plays)} ${word}</text>` : '';

  let footer = '';
  if (hasFooter) {
    const size = 30, r = 20, gap = 14, cy = footY;
    const iconW = bot.icon ? 2 * r + gap : 0;
    const x0 = 540 - (iconW + m.footer) / 2;
    const icon = bot.icon
      ? `<clipPath id="botIcon"><circle cx="${x0 + r}" cy="${cy}" r="${r}"/></clipPath>
         <image href="${bot.icon}" x="${x0}" y="${cy - r}" width="${2 * r}" height="${2 * r}" preserveAspectRatio="xMidYMid slice" clip-path="url(#botIcon)"/>`
      : '';
    footer = `${icon}<text x="${x0 + iconW}" y="${cy + 10}" font-family="Inter, DejaVu Sans" font-weight="500" font-size="${size}" fill="#fff" fill-opacity="0.7">${esc(bot.text)}</text>`;
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink" width="1080" height="1920" viewBox="0 0 1080 1920">
  <defs>
    <radialGradient id="sh" cx="0.5" cy="0.5" r="0.5"><stop offset="0.82" stop-color="#000" stop-opacity="0.45"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
    <clipPath id="round"><rect x="${cardX}" y="${cardY}" width="${C}" height="${C}" rx="36"/></clipPath>
  </defs>
  <text x="${headX}" y="${headY}" font-family="Inter, DejaVu Sans" font-weight="700" font-size="54" fill="#fff">${esc(who)}</text>
  <text x="${headX + m.who + 16}" y="${headY}" font-family="Inter, DejaVu Sans" font-weight="500" font-size="44" fill="#fff" fill-opacity="0.78">${esc(status)}</text>
  ${card}
  ${titleSvg}${artistSvg}${albumSvg}${pill}${footer}
</svg>`;
}

export function b64(bytes) {
  const T = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i] << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    out += T[(n >> 18) & 63] + T[(n >> 12) & 63] + (i + 1 < bytes.length ? T[(n >> 6) & 63] : '=') + (i + 2 < bytes.length ? T[n & 63] : '=');
  }
  return out;
}
