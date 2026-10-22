// Story com vídeo: o MESMO layout do story normal (tgcloud/lib/story_render.js), com o vídeo da pessoa
// dentro do quadrado da capa — cortado em quadrado pelo centro, cantos arredondados, até 1 minuto.
// Roda no GitHub Actions (.github/workflows/story-video.yml), onde há ffmpeg; o bot dispara essa rotina
// porque o ambiente dele não tem codificador de vídeo.
//
// Entrada: STORY_PAYLOAD (JSON) e TELEGRAM_BOT_TOKEN. Modo local (testes): STORY_LOCAL=1, e o payload traz
// `local: { video, cover, icon, botName, botUsername, out }` com caminhos de arquivo, sem rede nem Telegram.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { makeEngine, composeStory, renderPng, roundMask } from '../tgcloud/lib/story_render.js';
import { b64 } from '../tgcloud/lib/story_svg.js';

const MAX_SECONDS = 60;
const payload = JSON.parse(process.env.STORY_PAYLOAD || '{}');
const local = process.env.STORY_LOCAL === '1' ? payload.local : null;
const token = process.env.TELEGRAM_BOT_TOKEN;

// ---- arquivos do motor (mesmas versões fixadas no bot: resvg-wasm 2.6.2, Inter 0.4.2, DejaVu 2.37.3)
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

// ---- Bot API (só fora do modo local)
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

async function botIdentity() {
  if (local) {
    return { name: local.botName || '', username: local.botUsername || '', icon: local.icon ? dataUri(bytes(local.icon), 'image/png') : null };
  }
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

async function coverUri(covers) {
  if (local) return local.cover ? dataUri(bytes(local.cover), 'image/png') : null;
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
  if (last) throw last;
  return null;
}

function run(cmd, args) {
  const r = spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  if (r.status !== 0) throw new Error(`${cmd} falhou (${r.status}): ${(r.stderr || '').split('\n').slice(-8).join('\n')}`);
  return r.stdout;
}

async function build() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'story-'));
  const eng = makeEngine({ wasm: bytes(wasmPath), fonts: fontPaths.map(bytes) });

  // vídeo de entrada
  const inVideo = path.join(dir, 'in');
  if (local) fs.copyFileSync(local.video, inVideo);
  else fs.writeFileSync(inVideo, await tgFile(payload.file_id));
  const probe = JSON.parse(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'json', inVideo]));
  const seconds = Number(probe.format.duration);
  if (!(seconds > 0)) throw new Error('não consegui ler a duração do vídeo');
  if (seconds > MAX_SECONDS + 0.5) throw new Error(`o vídeo tem ${Math.round(seconds)} s; o limite é de 1 minuto`);

  // o story normal (com a capa no quadrado) e a máscara de cantos arredondados
  const cover = await coverUri(payload.track.covers);
  const { svg, box } = composeStory(eng, { track: payload.track, user: payload.user, plays: payload.plays, cover, bot: await botIdentity() });
  const storyPng = path.join(dir, 'story.png');
  const maskPng = path.join(dir, 'mask.png');
  fs.writeFileSync(storyPng, renderPng(eng, svg));
  fs.writeFileSync(maskPng, roundMask(eng, box.size));

  // o vídeo: corte quadrado pelo centro, máscara e posição exata do quadrado da capa
  const out = local ? local.out : path.join(dir, 'story.mp4');
  const S = box.size;
  run('ffmpeg', [
    '-y', '-loglevel', 'error',
    '-loop', '1', '-framerate', '30', '-i', storyPng,
    '-i', inVideo,
    '-loop', '1', '-framerate', '30', '-i', maskPng,
    '-filter_complex',
    `[1:v]fps=30,scale=${S}:${S}:force_original_aspect_ratio=increase,crop=${S}:${S},setsar=1,format=rgba[v];` +
      `[2:v]alphaextract[m];[v][m]alphamerge[vr];` +
      `[0:v][vr]overlay=${box.x}:${box.y}:shortest=1,format=yuv420p[out]`,
    '-map', '[out]', '-map', '1:a:0?',
    '-c:v', 'libx264', '-preset', 'medium', '-crf', '23', '-maxrate', '5M', '-bufsize', '10M',
    '-c:a', 'aac', '-b:a', '128k', '-t', seconds.toFixed(3), '-movflags', '+faststart',
    out,
  ]);
  const size = fs.statSync(out).size;
  console.log(`story.mp4: ${seconds.toFixed(1)} s, ${(size / 1048576).toFixed(1)} MB, quadrado ${S}px em (${box.x},${box.y})`);
  return { out, seconds, size };
}

async function main() {
  if (local) {
    await build();
    return;
  }
  try {
    const { out, seconds } = await build();
    const form = new FormData();
    form.append('chat_id', String(payload.chat_id));
    form.append('width', '1080');
    form.append('height', '1920');
    form.append('duration', String(Math.round(seconds)));
    form.append('supports_streaming', 'true');
    form.append('video', new Blob([fs.readFileSync(out)], { type: 'video/mp4' }), 'story.mp4');
    const res = await fetch(`https://api.telegram.org/bot${token}/sendVideo`, { method: 'POST', body: form });
    const json = await res.json();
    if (!json.ok) throw new Error(`sendVideo: ${json.error_code} ${json.description}`);
    console.log('vídeo enviado');
  } catch (e) {
    console.error(e);
    try {
      await tg('sendMessage', { chat_id: payload.chat_id, text: `Não consegui montar o vídeo do story: ${String(e.message).split('\n')[0].slice(0, 200)}` });
    } catch (notify) {
      console.error('aviso também falhou:', notify.message);
    }
    process.exitCode = 1;
  }
}

await main();
