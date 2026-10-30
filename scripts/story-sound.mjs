// Story com som: o MESMO story do /tstory (tgcloud/lib/story_render.js) vira um vídeo de 15 segundos, parado, com
// um trecho da faixa como som (prévia pública do iTunes; Deezer como reserva — nenhuma das duas é Spotify).
// Roda no GitHub Actions (.github/workflows/story-sound.yml), onde há ffmpeg; o bot dispara esta rotina porque o
// ambiente dele não tem codificador de vídeo.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { makeEngine, composeStory, renderPng } from '../tgcloud/lib/story_render.js';
import { b64 } from '../tgcloud/lib/story_svg.js';
import { previewAudio } from './preview-audio.mjs';

const payload = JSON.parse(process.env.STORY_PAYLOAD || '{}');
const token = process.env.TELEGRAM_BOT_TOKEN;
const SECONDS = Number(payload.audio_seconds) > 0 ? Number(payload.audio_seconds) : 15;

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

async function main() {
  try {
    const preview = await previewAudio(payload.track.artist, payload.track.name);
    if (!preview) {
      await tg('sendMessage', { chat_id: payload.chat_id, text: 'Não achei um trecho de som para essa faixa, então não montei o story com som.' });
      return;
    }
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'story-sound-'));
    const eng = makeEngine({ wasm: bytes(wasmPath), fonts: fontPaths.map(bytes) });
    const cover = await coverUri(payload.track.covers);
    const { svg } = composeStory(eng, { track: payload.track, user: payload.user, plays: payload.plays, cover, bot: await botIdentity() });
    const png = path.join(dir, 'story.png');
    fs.writeFileSync(png, renderPng(eng, svg));
    const audio = path.join(dir, `audio.${preview.ext}`);
    fs.writeFileSync(audio, preview.bytes);

    const out = path.join(dir, 'story-som.mp4');
    run('ffmpeg', [
      '-y', '-loglevel', 'error',
      '-loop', '1', '-framerate', '30', '-i', png,
      '-i', audio,
      '-vf', 'scale=1080:1920,format=yuv420p',
      '-c:v', 'libx264', '-tune', 'stillimage', '-preset', 'medium', '-crf', '23',
      '-c:a', 'aac', '-b:a', '128k', '-t', String(SECONDS), '-movflags', '+faststart',
      out,
    ]);
    const probe = JSON.parse(run('ffprobe', ['-v', 'error', '-show_entries', 'format=duration:stream=codec_type', '-of', 'json', out]));
    const kinds = (probe.streams || []).map((s) => s.codec_type).join('+');
    console.log(`story-som.mp4: ${Number(probe.format.duration).toFixed(1)} s, ${(fs.statSync(out).size / 1048576).toFixed(1)} MB, fluxos: ${kinds}`);

    const form = new FormData();
    form.append('chat_id', String(payload.chat_id));
    form.append('width', '1080');
    form.append('height', '1920');
    form.append('duration', String(SECONDS));
    form.append('supports_streaming', 'true');
    form.append('video', new Blob([fs.readFileSync(out)], { type: 'video/mp4' }), 'story-som.mp4');
    const res = await fetch(`https://api.telegram.org/bot${token}/sendVideo`, { method: 'POST', body: form });
    const json = await res.json();
    if (!json.ok) throw new Error(`sendVideo: ${json.error_code} ${json.description}`);
    console.log('vídeo enviado');
  } catch (e) {
    console.error(e);
    try {
      await tg('sendMessage', { chat_id: payload.chat_id, text: `Não consegui montar o story com som: ${String(e.message).split('\n')[0].slice(0, 200)}` });
    } catch (notify) {
      console.error('aviso também falhou:', notify.message);
    }
    process.exitCode = 1;
  }
}

await main();
