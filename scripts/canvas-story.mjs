// Story com o Canvas do Spotify como fundo: baixa o vídeo do Canvas (vindo do canvasdownloader.com, já
// resolvido pelo bot — aqui só o arquivo .mp4 é baixado, direto do CDN do Spotify canvaz.scdn.co, sem
// nenhuma chamada à API do Spotify) e desenha por cima o mesmo layout do /tstory (capa do álbum — a mesma
// imagem do Last.fm usada em /playing —, nome, "está ouvindo", faixa, artista, contagem e rodapé), sem
// fundo desfocado — o vídeo do Canvas preenche o quadro inteiro atrás de tudo. O áudio é a prévia pública
// de 30s da faixa (iTunes Search API, sem chave; Deezer como reserva — nenhuma das duas é Spotify),
// cortada no tamanho do próprio vídeo do Canvas (poucos segundos).
// Roda no GitHub Actions (.github/workflows/canvas-story.yml), onde há ffmpeg; o ambiente do bot não tem
// codificador de vídeo.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { makeEngine, composeOverlay, renderPng } from '../tgcloud/lib/story_render.js';
import { b64 } from '../tgcloud/lib/story_svg.js';

const payload = JSON.parse(process.env.STORY_PAYLOAD || '{}');
const token = process.env.TELEGRAM_BOT_TOKEN;

const modules = process.env.STORY_MODULES || 'node_modules';
const wasmPath = process.env.STORY_WASM || path.join(modules, '@resvg/resvg-wasm/index_bg.wasm');
const fontPaths = [
  '@expo-google-fonts/inter/700Bold/Inter_700Bold.ttf',
  '@expo-google-fonts/inter/500Medium/Inter_500Medium.ttf',
  'dejavu-fonts-ttf/ttf/DejaVuSans.ttf',
  'dejavu-fonts-ttf/ttf/DejaVuMathTeXGyre.ttf',
].map((p) => path.join(modules, p));

const bytes = (file) => new Uint8Array(fs.readFileSync(file));
const dataUri = (buf, type) => `data:${type};base64,${b64(buf)}`;

async function tg(method, body) {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`${method}: ${json.error_code} ${json.description}`);
  return json.result;
}

async function tgFile(fileId) {
  const info = await tg('getFile', { file_id: fileId });
  const res = await fetch(`https://api.telegram.org/file/bot${token}/${info.file_path}`);
  if (!res.ok) throw new Error(`download do arquivo: HTTP ${res.status}`);
  return new Uint8Array(await res.arrayBuffer());
}

async function coverUri(covers) {
  let last = null;
  for (const url of covers || []) {
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const type = (res.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
      return dataUri(new Uint8Array(await res.arrayBuffer()), type);
    } catch (e) {
      console.error(`capa ${url}: ${e.message}`);
      last = e;
    }
  }
  if (last) console.error('nenhuma capa do álbum disponível; story sem capa.');
  return null;
}

// Normaliza pra comparar nome de artista/faixa sem bater na cabeça com acento, maiúscula ou
// "feat./remix/ao vivo" entre parênteses — sem isso, o 1º resultado de uma busca por texto pode vir de
// uma faixa errada (cover, remix, artista homônimo).
const norm = (s) => String(s ?? '').normalize('NFKD').replace(/\p{M}/gu, '').replace(/\([^)]*\)/g, ' ').replace(/[^a-z0-9]+/gi, ' ').trim().toLowerCase();
const matches = (wantArtist, wantTrack, gotArtist, gotTrack) => {
  const a = norm(wantArtist), t = norm(wantTrack), ga = norm(gotArtist), gt = norm(gotTrack);
  return a && t && ga && gt && (ga.includes(a) || a.includes(ga)) && (gt.includes(t) || t.includes(gt));
};

// Prévia pública de 30s da faixa: iTunes Search API primeiro (sem restrição de uso comercial, feita
// para apps de terceiros embutirem preview), Deezer como reserva (uso pessoal, com atribuição). Nenhuma
// chamada ao Spotify. Confere artista e faixa do resultado antes de aceitar (evita cover/remix errado).
// Devolve { bytes, ext } ou null se não achar em nenhuma das duas.
async function previewAudio(artist, track) {
  const q = `${artist} ${track}`.trim();
  if (!q) return null;
  try {
    const url = `https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=music&entity=song&limit=5`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const hit = (data.results || []).find((r) => r.previewUrl && matches(artist, track, r.artistName, r.trackName));
    if (hit) {
      const audio = await fetch(hit.previewUrl);
      if (!audio.ok) throw new Error(`baixar prévia: HTTP ${audio.status}`);
      return { bytes: new Uint8Array(await audio.arrayBuffer()), ext: 'm4a' };
    }
    console.error(`iTunes (prévia de áudio): nenhum resultado bate com "${artist} — ${track}".`);
  } catch (e) {
    console.error(`iTunes (prévia de áudio): ${e.message}`);
  }
  try {
    const url = `https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=5`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const hit = (data.data || []).find((r) => r.preview && matches(artist, track, r.artist && r.artist.name, r.title));
    if (hit) {
      const audio = await fetch(hit.preview);
      if (!audio.ok) throw new Error(`baixar prévia: HTTP ${audio.status}`);
      return { bytes: new Uint8Array(await audio.arrayBuffer()), ext: 'mp3' };
    }
    console.error(`Deezer (prévia de áudio): nenhum resultado bate com "${artist} — ${track}".`);
  } catch (e) {
    console.error(`Deezer (prévia de áudio): ${e.message}`);
  }
  console.error('nenhuma prévia de áudio disponível (iTunes e Deezer); vídeo sem som.');
  return null;
}

async function botIdentity() {
  const me = await tg('getMe', {});
  let icon = null;
  try {
    const photos = await tg('getUserProfilePhotos', { user_id: me.id, limit: 1 });
    const sizes = photos.photos[0];
    if (sizes && sizes.length) {
      const size = sizes.find((s) => s.width >= 160) || sizes[sizes.length - 1];
      icon = dataUri(await tgFile(size.file_id), 'image/jpeg');
    }
  } catch (e) {
    console.error(`foto do bot indisponível: ${e.message}`);
  }
  return { name: me.first_name || '', username: me.username || '', icon };
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`${cmd} falhou (${r.status}): ${(r.stderr || '').split('\n').slice(-8).join('\n')}`);
  return r.stdout;
}

async function build() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'canvas-'));
  const eng = makeEngine({ wasm: bytes(wasmPath), fonts: fontPaths.map(bytes) });

  // vídeo do Canvas: direto do CDN do Spotify (canvaz.scdn.co), já validado pelo bot antes de disparar.
  const inVideo = path.join(dir, 'in');
  const res = await fetch(payload.canvas_url);
  if (!res.ok) throw new Error(`baixar o Canvas: HTTP ${res.status}`);
  fs.writeFileSync(inVideo, new Uint8Array(await res.arrayBuffer()));
  const probe = JSON.parse(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', inVideo]));
  const canvasSeconds = Number(probe.format.duration);
  if (!(canvasSeconds > 0)) throw new Error('não consegui ler a duração do vídeo do Canvas');
  // pedido pelo /tstory: o vídeo dura o trecho de som pedido (o Canvas repete em loop); senão, a duração do Canvas.
  const wanted = Number(payload.audio_seconds) > 0 ? Number(payload.audio_seconds) : 0;
  const seconds = wanted || canvasSeconds;

  // camada na frente (capa, texto, pílula e rodapé — transparente no resto), com o layout do story normal.
  const cover = await coverUri(payload.track.covers);
  const { svg } = composeOverlay(eng, { track: payload.track, user: payload.user, plays: payload.plays, cover, bot: await botIdentity() });
  const overlayPng = path.join(dir, 'overlay.png');
  fs.writeFileSync(overlayPng, renderPng(eng, svg));

  // trilha: prévia pública da faixa (iTunes/Deezer), cortada no tamanho do vídeo do Canvas; sem prévia
  // disponível, o vídeo segue sem som (nunca falha o story por causa do áudio).
  const preview = await previewAudio(payload.track.artist, payload.track.name);
  const inAudio = preview ? path.join(dir, `audio.${preview.ext}`) : null;
  if (preview) fs.writeFileSync(inAudio, preview.bytes);

  const out = path.join(dir, 'canvas-story.mp4');
  const args = ['-y', '-loglevel', 'error', ...(wanted ? ['-stream_loop', '-1'] : []), '-i', inVideo, '-loop', '1', '-framerate', '30', '-i', overlayPng];
  if (inAudio) args.push('-i', inAudio);
  args.push(
    '-filter_complex',
    `[0:v]scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,setsar=1[bg];` +
      `[bg][1:v]overlay=0:0:shortest=1,format=yuv420p[out]`,
    '-map', '[out]',
  );
  args.push(...(inAudio ? ['-map', '2:a'] : ['-map', '0:a?']));
  args.push(
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-maxrate', '5M', '-bufsize', '10M',
    '-c:a', 'aac', '-b:a', '128k', '-t', seconds.toFixed(3), '-movflags', '+faststart',
    out,
  );
  run('ffmpeg', args);
  const size = fs.statSync(out).size;
  console.log(`canvas-story.mp4: ${seconds.toFixed(1)} s, ${(size / 1048576).toFixed(1)} MB, com som: ${!!preview}`);
  return { out, seconds, hasAudio: !!preview };
}

async function main() {
  try {
    const { out, seconds, hasAudio } = await build();
    const form = new FormData();
    form.append('chat_id', String(payload.chat_id));
    form.append('width', '1080');
    form.append('height', '1920');
    form.append('duration', String(Math.round(seconds)));
    form.append('supports_streaming', 'true');
    if (!hasAudio) form.append('caption', 'Não achei uma prévia de áudio pra essa faixa; o vídeo foi sem som.');
    form.append('video', new Blob([fs.readFileSync(out)], { type: 'video/mp4' }), 'canvas-story.mp4');
    const res = await fetch(`https://api.telegram.org/bot${token}/sendVideo`, { method: 'POST', body: form });
    const json = await res.json();
    if (!json.ok) throw new Error(`sendVideo: ${json.error_code} ${json.description}`);
    console.log('vídeo enviado');
  } catch (e) {
    console.error(e);
    try {
      await tg('sendMessage', { chat_id: payload.chat_id, text: `Não consegui montar o story com o Canvas: ${String(e.message).split('\n')[0].slice(0, 200)}` });
    } catch (notify) {
      console.error('aviso também falhou:', notify.message);
    }
    process.exitCode = 1;
  }
}

await main();
