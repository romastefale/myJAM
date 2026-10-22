// `fetch` do SDK com uma nova tentativa.
//
// Medido no runtime real (workflow "Net probe"): o fetch falha com "fetch: request failed" depois
// de ~5 s em instabilidades passageiras da rede (3 episódios em mais de 100 chamadas: 5 s, 5 s e
// 10 s). Uma nova tentativa resolve os de 5 s; o de 10 s derrubou 2 tentativas, daí 3. Pior caso
// ~15 s; uma execução de 17,5 s foi medida sem ser interrompida.
// A documentação do SDK só diz que `fetch` rejeita em erro de rede real; não cita timeout.

export class NetworkError extends Error {
  constructor(message) {
    super(message);
    this.name = 'NetworkError';
  }
}

export async function fetchRetry(fetchImpl, url, options, attempts = 3) {
  let last;
  for (let i = 0; i < attempts; i++) {
    try {
      return options ? await fetchImpl(url, options) : await fetchImpl(url);
    } catch (e) {
      last = e;
    }
  }
  throw new NetworkError(`Falha de rede após ${attempts} tentativas: ${last && last.message}`);
}

// SDK: o corpo da resposta do `fetch` é lido em pedaços (`for await (const chunk of res.body)`).
// Junta os pedaços num único Uint8Array e para se passar de `max` bytes.
export async function readBytes(res, max) {
  const chunks = [];
  let size = 0;
  for await (const chunk of res.body) {
    size += chunk.length;
    if (size > max) throw new NetworkError(`resposta maior que ${max} bytes`);
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  return bytes;
}
