/** How a person shows in a people picker: their name; their email too when someone else in `all` has the same
 *  name, so two "Rahul"s can be told apart; and "(Me)" on the signed-in person's own entry. */
export function pickName(p: { id: string; name: string; email?: string }, all: { name: string }[], me?: string) {
  const key = p.name.trim().toLowerCase();
  const twin = all.filter((x) => x.name.trim().toLowerCase() === key).length > 1;
  return `${p.name.trim()}${twin && p.email ? ` (${p.email})` : ''}${p.id === me ? ' (Me)' : ''}`;
}
