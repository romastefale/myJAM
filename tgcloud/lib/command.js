// Extrai o comando de uma Message usando a entidade `bot_command` (offset 0).
// Devolve { name, arg, target } ou null. `target` é o @bot citado, em minúsculas.

export function parseCommand(message) {
  const text = message && message.text;
  if (!text || text[0] !== '/') return null;
  const entities = message.entities || [];
  const ent = entities.find((e) => e.type === 'bot_command' && e.offset === 0);
  if (!ent) return null;
  const raw = text.slice(1, ent.length); // sem a barra
  const [name, target] = raw.split('@');
  return {
    name: name.toLowerCase(),
    target: target ? target.toLowerCase() : null,
    arg: text.slice(ent.length).trim(),
  };
}
