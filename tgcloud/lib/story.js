// Imagem de story (1080x1920 PNG) com as mesmas informações do /playing. O desenho está em
// story_render.js (renderizador de SVG em WebAssembly, lib/vendor/resvg.js); aqui ficam as partes que
// dependem do bot: os arquivos do motor no banco, a capa e a identidade do bot.
import { api, BotApiError } from 'sdk';
import { loadAsset } from './assets.js';
import { downloadImage, PhotoError } from './photo.js';
import { makeEngine, composeStory, renderPng } from './story_render.js';
import { b64 } from './story_svg.js';

let engine = null; // por isolate

async function getEngine() {
  if (engine) return engine;
  const [wasm, bold, medium, dejavu, math] = await Promise.all(
    ['resvg', 'interBold', 'interMedium', 'dejavu', 'dejavuMath'].map(loadAsset),
  );
  engine = makeEngine({ wasm, fonts: [bold, medium, dejavu, math] });
  return engine;
}

// Identidade do bot para o rodapé: nome, @usuário e a foto de perfil (getMe + getUserProfilePhotos +
// download por file_id). Não muda durante a vida do isolate. Sem foto de perfil, o rodapé vai só com o texto.
let bot = null;
async function getBot() {
  if (bot) return bot;
  const me = await api.getMe();
  let icon = null;
  try {
    const photos = await api.getUserProfilePhotos({ user_id: me.id, limit: 1 });
    const sizes = photos && photos.photos && photos.photos[0];
    if (sizes && sizes.length) {
      const size = sizes.find((s) => s.width >= 160) || sizes[sizes.length - 1];
      icon = `data:image/jpeg;base64,${b64(await api.getFileContent(size.file_id))}`;
    }
  } catch (e) {
    if (!(e instanceof BotApiError)) throw e;
    console.error(`foto do bot indisponível: ${e.description}`);
  }
  bot = { name: me.first_name || '', username: me.username || '', icon };
  return bot;
}

const IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/gif', 'image/webp'];

// Primeira capa que baixa e é um formato que o renderizador entende. Há capas e nenhuma serve -> erro.
async function coverDataUri(covers) {
  let last = null;
  for (const url of covers || []) {
    try {
      const { bytes, type } = await downloadImage(url);
      if (!IMAGE_TYPES.includes(type)) throw new PhotoError(`formato de capa não suportado: ${type}`);
      return `data:${type};base64,${b64(bytes)}`;
    } catch (e) {
      if (!(e instanceof PhotoError)) throw e;
      console.error(`capa do story ${url}: ${e.message}`);
      last = e;
    }
  }
  if (last) throw last;
  return null; // faixa sem capa: o desenho sem capa é o previsto
}

// `custom` = { bytes, type }: imagem da pessoa no lugar da capa (recorte quadrado central); o resto do
// layout é o mesmo.
export async function renderStory({ track, user, plays, width, custom }) {
  const eng = await getEngine();
  const botInfo = await getBot();
  const cover = custom ? `data:${custom.type};base64,${b64(custom.bytes)}` : await coverDataUri(track.covers);
  const { svg } = composeStory(eng, { track, user, plays, cover, bot: botInfo });
  return renderPng(eng, svg, width);
}
