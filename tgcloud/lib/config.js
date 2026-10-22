// Preenchido no deploy por scripts/apply-config.mjs (a partir das variáveis do GitHub).
// Não edite os valores aqui: o repositório guarda sempre os valores vazios.

// IDs de usuário do Telegram com permissão de dono. IDs não são segredo.
export const OWNER_IDS = [];

// Chave da API do Last.fm (só a chave; o segredo da chave não é usado).
export const LASTFM_API_KEY = '';

// Rotinas de vídeo (GitHub Actions): repositório e token (fine-grained, só Actions: write neste
// repositório) usados para disparar .github/workflows/story-video.yml e canvas-story.yml. Vazios = vídeo
// desligado (as duas rotinas).
export const GITHUB_REPO = '';
export const GITHUB_DISPATCH_TOKEN = '';

export function isOwner(userId) {
  return OWNER_IDS.includes(userId);
}
