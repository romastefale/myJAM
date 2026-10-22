// Núcleo do desenho do story: nada aqui conhece o SDK do bot nem o banco, então o mesmo código roda no
// bot (lib/story.js) e na rotina de vídeo do GitHub Actions (scripts/story-video.mjs). Assim o story com
// vídeo tem exatamente o layout do story normal.
import { Resvg, initWasmSync } from './vendor/resvg.js';
import { coverage } from './fontcover.js';
import { storySvg, overlaySvg, blurSvg, cardBox, b64, esc, wrap } from './story_svg.js';
import { displayName } from './format.js';

// Motor: o wasm do resvg e as fontes (Inter Bold, Inter Medium, DejaVu Sans, DejaVu Math), em bytes.
export function makeEngine({ wasm, fonts }) {
  initWasmSync(wasm);
  return {
    covers: fonts.map(coverage),
    options: { font: { fontBuffers: fonts, defaultFontFamily: 'Inter', loadSystemFonts: false }, fitTo: { mode: 'original' } },
  };
}

// Largura de um texto (getBBox do resvg), para centralizar os trechos do cabeçalho e do rodapé.
function textWidth(eng, text, weight, size) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="200"><text x="0" y="120" font-family="Inter, DejaVu Sans" font-weight="${weight}" font-size="${size}">${esc(text)}</text></svg>`;
  const box = new Resvg(svg, eng.options).getBBox();
  return box ? box.width : text.length * size * 0.56;
}

// `cover`: data URI da capa (ou null); `bot`: { name, username, icon } (icon = data URI ou null).
// Devolve { svg, box } — box é o quadrado da capa: { x, y, size }.
export function composeStory(eng, { track, user, plays, cover, bot }) {
  // NFKC troca letras "decorativas" (matemáticas, largura total) pelas normais: no story elas saíam com
  // espaço entre as letras, e o nome continua legível. O que nenhuma fonte desenha é descartado
  // (nunca aparece "NOGLYPH").
  const clean = (text) => [...String(text ?? '').normalize('NFKC')]
    .filter((ch) => ch === ' ' || eng.covers.some((has) => has(ch.codePointAt(0))))
    .join('').replace(/\s+/g, ' ').trim();
  const bgSmall = cover ? `data:image/png;base64,${b64(new Resvg(blurSvg(cover), eng.options).render().asPng())}` : null;
  const who = wrap(clean(displayName(user)) || 'Você', 18, 1)[0];
  const status = track.nowPlaying ? 'está ouvindo' : 'ouviu';
  const botName = clean(bot.name);
  const botText = bot.username ? `@${bot.username}${botName ? ` • ${botName}` : ''}` : '';
  const args = {
    title: clean(track.name) || '—',
    artist: clean(track.artist),
    album: clean(track.album),
    plays,
    bot: { ...bot, text: botText },
  };
  const svg = storySvg({
    ...args,
    who,
    status,
    m: {
      note: textWidth(eng, '♫', 400, 60),
      pill: Number(plays) > 0 ? textWidth(eng, `${plays} ${Number(plays) === 1 ? 'play' : 'plays'}`, 700, 60) : 0,
      who: textWidth(eng, who, 700, 54),
      status: textWidth(eng, status, 500, 44),
      footer: botText ? textWidth(eng, botText, 500, 30) : 0,
    },
    cover,
    bgSmall,
  });
  return { svg, box: cardBox(args) };
}

// Mesmo texto do composeStory, mas sem o fundo desfocado: usado quando o fundo do story é um vídeo (o
// Canvas do Spotify) em vez da capa — o quadro inteiro já vem do vídeo, essa camada tem a capa (mesmo
// quadrado de sempre), o texto, a pílula e o rodapé, com o resto transparente. Devolve { svg }.
export function composeOverlay(eng, { track, user, plays, cover, bot }) {
  const clean = (text) => [...String(text ?? '').normalize('NFKC')]
    .filter((ch) => ch === ' ' || eng.covers.some((has) => has(ch.codePointAt(0))))
    .join('').replace(/\s+/g, ' ').trim();
  const who = wrap(clean(displayName(user)) || 'Você', 18, 1)[0];
  const status = track.nowPlaying ? 'está ouvindo' : 'ouviu';
  const botName = clean(bot.name);
  const botText = bot.username ? `@${bot.username}${botName ? ` • ${botName}` : ''}` : '';
  const svg = overlaySvg({
    title: clean(track.name) || '—',
    artist: clean(track.artist),
    album: clean(track.album),
    plays,
    cover,
    bot: { ...bot, text: botText },
    who,
    status,
    m: {
      note: textWidth(eng, '♫', 400, 60),
      pill: Number(plays) > 0 ? textWidth(eng, `${plays} ${Number(plays) === 1 ? 'play' : 'plays'}`, 700, 60) : 0,
      who: textWidth(eng, who, 700, 54),
      status: textWidth(eng, status, 500, 44),
      footer: botText ? textWidth(eng, botText, 500, 30) : 0,
    },
  });
  return { svg };
}

// `width` opcional: miniatura proporcional; sem ele, 1080x1920.
export function renderPng(eng, svg, width) {
  const options = width ? { ...eng.options, fitTo: { mode: 'width', value: width } } : eng.options;
  return new Resvg(svg, options).render().asPng();
}

// Quadrado branco de cantos arredondados (PNG): a máscara que recorta o vídeo no quadrado da capa.
export function roundMask(eng, size) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="36" fill="#fff"/></svg>`;
  return new Resvg(svg, eng.options).render().asPng();
}
