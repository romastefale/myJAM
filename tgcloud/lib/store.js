import { db } from 'sdk';
import { eq, desc, inArray, lt } from 'sdk/db';
import { users, memberships, lyricsCache, photoCache, flags, tpv, radioSearch } from '../schema.js';

export function getLinked(tgId) {
  return db.select().from(users).where(eq(users.tgId, tgId)).get();
}

export async function link(tgId, lastfmUser) {
  await db
    .insert(users)
    .values({ tgId, lastfmUser })
    .onConflictDoUpdate({ target: users.tgId, set: { lastfmUser } })
    .run();
}

export async function unlink(tgId) {
  await db.delete(users).where(eq(users.tgId, tgId)).run();
}

// Registra que `from` usou um comando em `chat` (atualiza nome e última atividade).
export async function remember(chat, from) {
  const key = `${chat.id}:${from.id}`;
  const name = from.first_name || from.username || String(from.id);
  const lastSeen = new Date();
  await db
    .insert(memberships)
    .values({ key, chatId: chat.id, userId: from.id, name, lastSeen })
    .onConflictDoUpdate({ target: memberships.key, set: { name, lastSeen } })
    .run();
}

// Membros recentes do grupo que vincularam o Last.fm: [{ userId, name, lastfmUser }].
export async function linkedMembers(chatId, limit) {
  const rows = await db
    .select()
    .from(memberships)
    .where(eq(memberships.chatId, chatId))
    .orderBy(desc(memberships.lastSeen))
    .limit(limit * 3)
    .all();
  if (!rows.length) return [];
  const linked = await db
    .select()
    .from(users)
    .where(inArray(users.tgId, rows.map((r) => r.userId)))
    .all();
  const byId = new Map(linked.map((u) => [u.tgId, u.lastfmUser]));
  return rows
    .filter((r) => byId.has(r.userId))
    .slice(0, limit)
    .map((r) => ({ userId: r.userId, name: r.name, lastfmUser: byId.get(r.userId) }));
}

export const lyricsKey = (artist, track) =>
  `${String(artist).trim().toLowerCase()}|${String(track).trim().toLowerCase()}`;

export function getCachedLyrics(key) {
  return db.select().from(lyricsCache).where(eq(lyricsCache.key, key)).get();
}

export async function cacheLyrics(key, lyrics) {
  await db
    .insert(lyricsCache)
    .values({ key, plain: lyrics.plain, instrumental: lyrics.instrumental })
    .onConflictDoUpdate({ target: lyricsCache.key, set: { plain: lyrics.plain, instrumental: lyrics.instrumental } })
    .run();
}

export async function getPhotoId(url) {
  const row = await db.select().from(photoCache).where(eq(photoCache.url, url)).get();
  return row ? row.fileId : null;
}

export async function savePhotoId(url, fileId) {
  await db
    .insert(photoCache)
    .values({ url, fileId })
    .onConflictDoUpdate({ target: photoCache.url, set: { fileId } })
    .run();
}

// ---- Operação do dono
export async function getFlag(key) {
  const row = await db.select().from(flags).where(eq(flags.key, key)).get();
  return row ? row.value : null;
}

export async function setFlag(key, value) {
  await db
    .insert(flags)
    .values({ key, value })
    .onConflictDoUpdate({ target: flags.key, set: { value } })
    .run();
}

export const isSilent = async () => (await getFlag('silent')) === '1';

export async function setTpv(tgId, mode, label) {
  await db
    .insert(tpv)
    .values({ tgId, mode, label })
    .onConflictDoUpdate({ target: tpv.tgId, set: { mode, label } })
    .run();
}

export async function clearTpv(tgId) {
  const had = await db.select().from(tpv).where(eq(tpv.tgId, tgId)).get();
  await db.delete(tpv).where(eq(tpv.tgId, tgId)).run();
  return !!had;
}

// Rótulos de máscara para `scope` ('tnow' ou 'mosaico'): Map tgId -> rótulo.
export async function masksFor(ids, scope) {
  if (!ids.length) return new Map();
  const rows = await db.select().from(tpv).where(inArray(tpv.tgId, ids)).all();
  return new Map(rows.filter((r) => r.mode === 'all' || r.mode === scope).map((r) => [r.tgId, r.label]));
}

// Todos os vínculos (mais recentes primeiro) com o nome conhecido de cada pessoa: [{ userId, name, lastfmUser }].
export async function allLinked(limit) {
  const rows = await db.select().from(users).orderBy(desc(users.created)).limit(limit).all();
  const total = (await db.select().from(users).all()).length;
  if (!rows.length) return { members: [], total };
  const seen = await db.select().from(memberships).where(inArray(memberships.userId, rows.map((r) => r.tgId))).orderBy(desc(memberships.lastSeen)).all();
  const names = new Map();
  for (const m of seen) if (!names.has(m.userId)) names.set(m.userId, m.name);
  return {
    total,
    members: rows.map((r) => ({ userId: r.tgId, name: names.get(r.tgId) || r.lastfmUser, lastfmUser: r.lastfmUser })),
  };
}

// ---- /radiofm
const RADIO_TTL = 15 * 60; // segundos

export async function saveSearch(key, userId, results) {
  const now = Math.floor(Date.now() / 1000);
  await db.delete(radioSearch).where(lt(radioSearch.created, now - RADIO_TTL)).run();
  await db
    .insert(radioSearch)
    .values({ key, userId, data: JSON.stringify(results), created: now })
    .onConflictDoUpdate({ target: radioSearch.key, set: { userId, data: JSON.stringify(results), created: now } })
    .run();
}

export async function getSearch(key) {
  const row = await db.select().from(radioSearch).where(eq(radioSearch.key, key)).get();
  if (!row || row.created < Math.floor(Date.now() / 1000) - RADIO_TTL) return null;
  return { userId: row.userId, results: JSON.parse(row.data) };
}

export async function dropSearch(key) {
  await db.delete(radioSearch).where(eq(radioSearch.key, key)).run();
}
