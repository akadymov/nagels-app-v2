const NO_MONEY = /\s*(?:-|\(no money\)|\(без денег\))\s*$/i;

/** One name per line; trailing " -" / " (no money)" marks no_stakes. */
export function parseParticipants(text: string): Array<{ display_name: string; no_stakes: boolean }> {
  const seen = new Set<string>();
  const out: Array<{ display_name: string; no_stakes: boolean }> = [];
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const no_stakes = NO_MONEY.test(line);
    const display_name = line.replace(NO_MONEY, '').trim().slice(0, 24);
    if (!display_name || seen.has(display_name.toLowerCase())) continue;
    seen.add(display_name.toLowerCase());
    out.push({ display_name, no_stakes });
  }
  return out;
}

export function moveParticipant(tables: string[][], pid: string, toTable: number): string[][] {
  const from = tables.findIndex((t) => t.includes(pid));
  if (from === -1 || from === toTable) return tables;
  return tables.map((t, i) =>
    i === from ? t.filter((x) => x !== pid) : i === toTable ? [...t, pid] : t);
}
