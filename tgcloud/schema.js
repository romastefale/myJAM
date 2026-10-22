import { table, integer, text, boolean, blob, index, sql } from 'sdk/db';

// Usuários que vincularam um perfil do Last.fm. Sem chaves estrangeiras: a
// plataforma as proíbe, então nada aqui referencia outra tabela.
export const users = table('users', {
  tgId:       integer('tg_id').primaryKey(),
  lastfmUser: text('lastfm_user').notNull(),
  created:    integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

// Quem já usou um comando em cada grupo. O bot só enxerga os membros que falam com ele
// (a Bot API não lista membros), então "membros do grupo" = quem já usou um comando ali.
export const memberships = table('memberships', {
  key:      text('key').primaryKey(), // `${chatId}:${userId}`
  chatId:   integer('chat_id').notNull(),
  userId:   integer('user_id').notNull(),
  name:     text('name').notNull(),
  lastSeen: integer('last_seen', { mode: 'timestamp' }).notNull(),
}, (t) => ({
  byChat: index('idx_memberships_chat').on(t.chatId),
}));

// Letras já buscadas (a letra de uma música não muda). Poupa o LRCLIB, que às vezes responde 503
// de sobrecarga, e deixa o /tly e o inline instantâneos nas repetições.
export const lyricsCache = table('lyrics_cache', {
  key:          text('key').primaryKey(), // `${artista}|${faixa}` em minúsculas
  plain:        text('plain').notNull(),
  instrumental: boolean('instrumental').notNull().default(false),
  created:      integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

// Capas já enviadas: URL do Last.fm -> file_id do Telegram. Bot API (sendPhoto): "Pass a file_id ...
// (recommended)" — reenviar por file_id dispensa baixar e enviar a imagem de novo.
export const photoCache = table('photo_cache', {
  url:     text('url').primaryKey(),
  fileId:  text('file_id').notNull(),
  created: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

// Arquivos grandes do renderizador de imagem (WebAssembly e fontes), guardados depois de baixados e
// conferidos por SHA-256 (lib/assets.js). `blob()` lê e grava Uint8Array.
export const assetCache = table('asset_cache', {
  key:     text('key').primaryKey(),
  sha256:  text('sha256').notNull(),
  data:    blob('data').notNull(),
  created: integer('created_at', { mode: 'timestamp' }).default(sql`(unixepoch())`),
});

// Chaves de operação do dono (hoje: `silent`, o modo silencioso do /onoff).
export const flags = table('flags', {
  key:   text('key').primaryKey(),
  value: text('value').notNull(),
});

// /tpv: quem aparece mascarado (só o rótulo, sem menção) nos quadros de ouvintes.
// mode: 'tnow' (/tnow), 'mosaico' (/tnowall) ou 'all'.
export const tpv = table('tpv', {
  tgId:  integer('tg_id').primaryKey(),
  mode:  text('mode').notNull(),
  label: text('label').notNull(),
});

// Resultados de uma busca do /radiofm, presos à mensagem com os botões (`${chatId}:${messageId}`).
export const radioSearch = table('radio_search', {
  key:     text('key').primaryKey(),
  userId:  integer('user_id').notNull(),
  data:    text('data').notNull(), // JSON: [{ name, artist }]
  created: integer('created_at').notNull(), // unix, para expirar
});
