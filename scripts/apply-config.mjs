// Grava a configuração de deploy em tgcloud/lib/config.js a partir de variáveis do GitHub.
// O runtime do tgcloud não lê variáveis de ambiente: só enxerga os módulos publicados,
// então os valores precisam ser escritos no módulo ANTES do `tgcloud push` (feito no CI).
//
//   OWNER_ID         um ou mais IDs numéricos do Telegram, separados por vírgula/espaço
//   LASTFM_API_KEY   chave da API do Last.fm (só letras e números)
//   DISPATCH_TOKEN   (opcional) token do GitHub que dispara a rotina de vídeo do /tstory
//   REPO_NAME        (opcional, com DISPATCH_TOKEN) dono/repositório, ex.: romastefale/tr5 (também
//                    dispara canvas-story.yml, para o story com o Canvas do Spotify de fundo)
//
// Os valores entram em código JavaScript, então nunca são copiados sem validar, e nunca
// são impressos no log.
import fs from 'node:fs';
import path from 'node:path';

function fail(msg) {
  console.error(msg);
  process.exit(1);
}

const ownerRaw = (process.env.OWNER_ID ?? '').trim();
const keyRaw = (process.env.LASTFM_API_KEY ?? '').trim();
if (!ownerRaw) fail('OWNER_ID não definido (Settings → Secrets and variables → Actions).');
if (!keyRaw) fail('LASTFM_API_KEY não definido (Settings → Secrets and variables → Actions → Secrets).');

const parts = ownerRaw.split(/[\s,]+/).filter(Boolean);
if (!parts.every((p) => /^\d{1,15}$/.test(p))) {
  fail('OWNER_ID inválido: use só IDs numéricos do Telegram, separados por vírgula.');
}
const ids = [...new Set(parts.map(Number))];

if (!/^[A-Za-z0-9]{16,64}$/.test(keyRaw)) {
  fail('LASTFM_API_KEY inválida: esperado só letras e números (16 a 64 caracteres).');
}

const file = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../tgcloud/lib/config.js');
let src = fs.readFileSync(file, 'utf8');
const reOwner = /export const OWNER_IDS = \[[^\]]*\];/;
const reKey = /export const LASTFM_API_KEY = '[^']*';/;
if (!reOwner.test(src)) fail('Linha "export const OWNER_IDS = [...]" não encontrada em config.js.');
if (!reKey.test(src)) fail("Linha \"export const LASTFM_API_KEY = '...';\" não encontrada em config.js.");
src = src.replace(reOwner, `export const OWNER_IDS = [${ids.join(', ')}];`);
src = src.replace(reKey, `export const LASTFM_API_KEY = '${keyRaw}';`);

// Opcional: vídeo do /tstory. Sem token, a função fica desligada (o bot avisa).
const dispatch = (process.env.DISPATCH_TOKEN ?? '').trim();
const repo = (process.env.REPO_NAME ?? '').trim();
const reRepo = /export const GITHUB_REPO = '[^']*';/;
const reDispatch = /export const GITHUB_DISPATCH_TOKEN = '[^']*';/;
if (!reRepo.test(src) || !reDispatch.test(src)) fail('Linhas GITHUB_REPO / GITHUB_DISPATCH_TOKEN não encontradas em config.js.');
if (dispatch) {
  if (!/^[A-Za-z0-9_]{20,255}$/.test(dispatch)) fail('DISPATCH_TOKEN inválido: esperado só letras, números e _.');
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo)) fail('REPO_NAME inválido: esperado dono/repositório.');
  src = src.replace(reRepo, `export const GITHUB_REPO = '${repo}';`).replace(reDispatch, `export const GITHUB_DISPATCH_TOKEN = '${dispatch}';`);
}
fs.writeFileSync(file, src);
console.log(`Configuração gravada: ${ids.length} dono(s), chave do Last.fm definida, vídeo do /tstory e story com Canvas ${dispatch ? 'ligados' : 'desligados'}.`);
