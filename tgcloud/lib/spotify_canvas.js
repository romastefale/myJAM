// Canvas do Spotify (vídeo vertical em loop): consulta o canvasdownloader.com, um site público
// (romastefale/my-spotify-canvas usava o mesmo como reserva). Testado ao vivo: só aceita o link exato da
// faixa (https://open.spotify.com/track/<id>), não busca por nome. Zero chamada ao Spotify — é só o
// texto do link, que a pessoa já trouxe ao compartilhar a faixa.
import { fetch } from 'sdk';
import { fetchRetry, readBytes } from './http.js';

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';
const MAX_VIDEO = 8 * 1024 * 1024;
const CANVAS_URL_RE = /https:\/\/canvaz\.scdn\.co\/[^\s"'<>\\]+/;
const NOT_FOUND_MARKER = 'Canvas not found';

const text = (bytes) => {
  let s = '';
  for (let i = 0; i < bytes.length; i += 8192) s += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return s;
};

// Consulta o site com o link exato da faixa; devolve a URL do vídeo (canvaz.scdn.co) ou null se a faixa
// não tiver Canvas.
export async function canvasForLink(link, trace = () => {}) {
  const res = await fetchRetry(fetch, `https://www.canvasdownloader.com/canvas?link=${encodeURIComponent(link)}`, {
    headers: {
      'user-agent': UA,
      accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      referer: 'https://www.canvasdownloader.com/',
    },
  });
  const body = text(await readBytes(res, 2 * 1024 * 1024));
  const match = body.match(CANVAS_URL_RE);
  const notFound = body.includes(NOT_FOUND_MARKER);
  trace(`canvasdownloader.com link=${link.slice(0, 80)}…: HTTP ${res.status}, achou=${!!match}, "não encontrado"=${notFound}`);
  if (!res.ok) throw new Error(`canvasdownloader.com: HTTP ${res.status}`);
  if (match) return match[0];
  if (!notFound) trace(`resposta sem URL e sem o aviso esperado — início do corpo: ${body.slice(0, 200).replace(/\s+/g, ' ')}`);
  return null;
}

// Baixa o MP4 do Canvas (só do CDN oficial do Spotify — é o domínio que o próprio canvasdownloader.com
// devolve; baixar o arquivo de lá não é diferente de abrir o link que qualquer visitante do site abriria).
export async function downloadCanvas(url) {
  if (!/^https:\/\/canvaz\.scdn\.co\//.test(url)) throw new Error('URL do Canvas fora do CDN esperado');
  const res = await fetch(url, { headers: { 'user-agent': UA } });
  if (!res.ok) throw new Error(`download do Canvas: HTTP ${res.status}`);
  return readBytes(res, MAX_VIDEO);
}
