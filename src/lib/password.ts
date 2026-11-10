/** Rough strength guide for a new password: length plus character variety (0 to 5). */
export const strength = (p: string) => {
  const s = [p.length >= 8, p.length >= 12, /[A-Z]/.test(p) && /[a-z]/.test(p), /\d/.test(p), /[^A-Za-z0-9]/.test(p)].filter(Boolean).length;
  return { score: s, text: ['Too short', 'Weak', 'Fair', 'Good', 'Strong', 'Very strong'][s] };
};
