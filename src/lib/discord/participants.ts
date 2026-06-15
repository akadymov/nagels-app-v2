// Discord Activity participant tracking → prompt freeze. The pure diff is
// unit-tested; the hook (added in a later task) wires it to the SDK + snapshot
// resync.

/** Given the previous id set and the new id list, return who left + the new set. */
export function diffParticipants(prev: Set<string>, nextIds: string[]): { next: Set<string>; left: string[] } {
  const next = new Set(nextIds);
  const left: string[] = [];
  for (const id of prev) {
    if (!next.has(id)) left.push(id);
  }
  return { next, left };
}
