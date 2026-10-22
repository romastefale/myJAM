// Arquivos grandes que o renderizador de imagem precisa (WebAssembly e fontes). O runtime não tem
// sistema de arquivos nem npm: cada arquivo é baixado por `fetch` de um CDN do npm, conferido contra
// o SHA-256 fixado aqui e guardado no banco (blob). Se o CDN principal falhar, tenta o seguinte.
import { db, fetch } from 'sdk';
import { eq } from 'sdk/db';
import { assetCache } from '../schema.js';
import { fetchRetry, readBytes } from './http.js';

export class AssetError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AssetError';
  }
}

const npm = (pkg, version, path) => [
  `https://cdn.jsdelivr.net/npm/${pkg}@${version}/${path}`,
  `https://unpkg.com/${pkg}@${version}/${path}`,
];

export const ASSETS = {
  resvg: { urls: npm('@resvg/resvg-wasm', '2.6.2', 'index_bg.wasm'), size: 2478606, sha256: '22bf6e9f9a100d972da0411a69c5ba504367fc1fa87b3b64e3f35e53926d2d70' },
  interBold: { urls: npm('@expo-google-fonts/inter', '0.4.2', '700Bold/Inter_700Bold.ttf'), size: 344072, sha256: 'fbe825cbfc749317f57a1433d3905aa9d3f388732fd29b8e8a36f34845e3bc3e' },
  interMedium: { urls: npm('@expo-google-fonts/inter', '0.4.2', '500Medium/Inter_500Medium.ttf'), size: 342892, sha256: 'f1738576525e86db1d5cf63a6c1b56e0a7e2a2898b499ac93db95f2e7a9f9cd5' },
  dejavu: { urls: npm('dejavu-fonts-ttf', '2.37.3', 'ttf/DejaVuSans.ttf'), size: 757076, sha256: '7da195a74c55bef988d0d48f9508bd5d849425c1770dba5d7bfc6ce9ed848954' },
  dejavuMath: { urls: npm('dejavu-fonts-ttf', '2.37.3', 'ttf/DejaVuMathTeXGyre.ttf'), size: 577708, sha256: '40da67c0b6b03076504fbda4bf3e7b4f20b35999c98063019a3392fe9b1294fe' },
};

async function sha256Hex(bytes) {
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  let hex = '';
  for (const b of digest) hex += (b < 16 ? '0' : '') + b.toString(16);
  return hex;
}

async function download(key, asset) {
  const problems = [];
  for (const url of asset.urls) {
    try {
      const res = await fetchRetry(fetch, url);
      if (!res.ok) throw new AssetError(`HTTP ${res.status}`);
      const bytes = await readBytes(res, asset.size + 4096);
      if (bytes.length !== asset.size) throw new AssetError(`tamanho ${bytes.length}, esperado ${asset.size}`);
      if ((await sha256Hex(bytes)) !== asset.sha256) throw new AssetError('SHA-256 diferente do esperado');
      return bytes;
    } catch (e) {
      problems.push(`${url}: ${e.message}`);
    }
  }
  throw new AssetError(`não consegui obter ${key} (${problems.join('; ')})`);
}

const memory = new Map(); // dentro de uma mesma execução/isolate

// Medido no runtime real: o banco grava e lê blobs de até 768 KB; a partir de 1 MB falha com
// "Max serialized size reached". Cada arquivo é guardado em pedaços de 512 KB (uma linha por pedaço).
const CHUNK = 512 * 1024;
const chunkKey = (key, i) => `${key}#${i}`;
const chunksOf = (asset) => Math.ceil(asset.size / CHUNK);

async function readFromDb(key, asset) {
  const out = new Uint8Array(asset.size);
  for (let i = 0; i < chunksOf(asset); i++) {
    const row = await db.select().from(assetCache).where(eq(assetCache.key, chunkKey(key, i))).get();
    const expected = Math.min(CHUNK, asset.size - i * CHUNK);
    if (!row || row.sha256 !== asset.sha256 || !row.data || row.data.length !== expected) return null;
    out.set(row.data, i * CHUNK);
  }
  return out;
}

async function writeToDb(key, asset, bytes) {
  for (let i = 0; i < chunksOf(asset); i++) {
    const data = bytes.slice(i * CHUNK, Math.min((i + 1) * CHUNK, bytes.length));
    await db
      .insert(assetCache)
      .values({ key: chunkKey(key, i), sha256: asset.sha256, data })
      .onConflictDoUpdate({ target: assetCache.key, set: { sha256: asset.sha256, data } })
      .run();
  }
}

export async function loadAsset(key) {
  if (memory.has(key)) return memory.get(key);
  const asset = ASSETS[key];
  if (!asset) throw new AssetError(`arquivo desconhecido: ${key}`);
  let bytes = await readFromDb(key, asset);
  if (!bytes) {
    bytes = await download(key, asset);
    await writeToDb(key, asset, bytes);
  }
  memory.set(key, bytes);
  return bytes;
}
