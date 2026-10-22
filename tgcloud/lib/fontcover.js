// Lê a tabela `cmap` de uma fonte TrueType/OpenType (formatos 4 e 12) e devolve has(codepoint).
// Serve para nunca desenhar "NOGLYPH": caracteres que nenhuma fonte carregada cobre são descartados.
export function coverage(bytes) {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const tag = (o) => String.fromCharCode(dv.getUint8(o), dv.getUint8(o + 1), dv.getUint8(o + 2), dv.getUint8(o + 3));
  let base = 0;
  if (tag(0) === 'ttcf') base = dv.getUint32(12); // coleção: usa a primeira fonte
  const numTables = dv.getUint16(base + 4);
  let cmapOff = -1;
  for (let i = 0; i < numTables; i++) {
    const rec = base + 12 + i * 16;
    if (tag(rec) === 'cmap') cmapOff = dv.getUint32(rec + 8);
  }
  if (cmapOff < 0) return () => false;
  const n = dv.getUint16(cmapOff + 2);
  const subs = [];
  for (let i = 0; i < n; i++) {
    const p = cmapOff + 4 + i * 8;
    subs.push({ pid: dv.getUint16(p), eid: dv.getUint16(p + 2), off: cmapOff + dv.getUint32(p + 4) });
  }
  const ranges = []; // [start, end]
  for (const s of subs) {
    const unicode = s.pid === 0 || (s.pid === 3 && (s.eid === 1 || s.eid === 10));
    if (!unicode) continue;
    const fmt = dv.getUint16(s.off);
    if (fmt === 12) {
      const groups = dv.getUint32(s.off + 12);
      for (let g = 0; g < groups; g++) {
        const o = s.off + 16 + g * 12;
        ranges.push([dv.getUint32(o), dv.getUint32(o + 4)]);
      }
    } else if (fmt === 4) {
      const segX2 = dv.getUint16(s.off + 6);
      const endO = s.off + 14, startO = endO + segX2 + 2, deltaO = startO + segX2, rangeO = deltaO + segX2;
      for (let i = 0; i < segX2 / 2; i++) {
        const end = dv.getUint16(endO + i * 2), start = dv.getUint16(startO + i * 2);
        if (start === 0xffff) continue;
        const ro = dv.getUint16(rangeO + i * 2);
        if (ro === 0) { ranges.push([start, end]); continue; }
        // há deslocamento no glyphIdArray: confere cada codepoint (glifo 0 = ausente)
        let runStart = -1;
        for (let c = start; c <= end; c++) {
          const gi = dv.getUint16(rangeO + i * 2 + ro + (c - start) * 2);
          if (gi !== 0) { if (runStart < 0) runStart = c; } else if (runStart >= 0) { ranges.push([runStart, c - 1]); runStart = -1; }
        }
        if (runStart >= 0) ranges.push([runStart, end]);
      }
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  return (cp) => {
    let lo = 0, hi = ranges.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      if (cp < ranges[mid][0]) hi = mid - 1; else if (cp > ranges[mid][1]) lo = mid + 1; else return true;
    }
    return false;
  };
}
