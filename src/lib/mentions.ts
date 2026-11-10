export interface Mentionable { id: string; name: string }

/** The "@word" being typed right before the caret, if any. */
export function mentionQuery(text: string, caret: number): { at: number; q: string } | null {
  const m = /(^|\s)@([^\s@]*)$/.exec(text.slice(0, caret));
  return m ? { at: caret - m[2].length - 1, q: m[2] } : null;
}

/** The people still mentioned in the final text (one picked and then deleted is dropped). */
export const mentionedIds = (text: string, picked: Mentionable[]) =>
  [...new Set(picked.filter((p) => text.includes(`@${p.name}`)).map((p) => p.id))];
