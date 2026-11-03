// Brand color choices for Organization settings. Every color here is contrast-tested in light and dark mode
// (palette.test.ts), so any of them gives readable buttons, links and badges.

/** The quick row (null = Taskify's default green). */
export const QUICK: [string, string | null][] = [
  ['Taskify green', null], ['Ocean blue', '#2563eb'], ['Indigo', '#4f46e5'], ['Violet', '#7c3aed'], ['Teal', '#0d9488'],
  ['Crimson', '#dc2626'], ['Orange', '#ea580c'], ['Rose', '#db2777'], ['Slate', '#475569'],
  ['Sky', '#0284c7'], ['Gold', '#eab308'], ['Brown', '#92400e'], ['Black', '#111111'],
  ['Navy', '#1e3a8a'], ['Cyan', '#0891b2'], ['Emerald', '#059669'], ['Lime', '#65a30d'], ['Olive', '#4d7c0f'],
  ['Amber', '#d97706'], ['Coral', '#f97362'], ['Maroon', '#7f1d1d'], ['Magenta', '#c026d3'], ['Purple', '#6b21a8'],
  ['Lavender', '#8b5cf6'], ['Plum', '#86198f'], ['Steel', '#4b6584'], ['Charcoal', '#374151'],
];

const SHADES = ['Light', 'Bright', 'Classic', 'Deep', 'Darker', 'Darkest'];
/** Color families, each from light to darkest (the widely used modern UI palette). */
const RAW: [string, string[]][] = [
  ['Red', ['#f87171', '#ef4444', '#dc2626', '#b91c1c', '#991b1b', '#7f1d1d']],
  ['Rose', ['#fb7185', '#f43f5e', '#e11d48', '#be123c', '#9f1239', '#881337']],
  ['Pink', ['#f472b6', '#ec4899', '#db2777', '#be185d', '#9d174d', '#831843']],
  ['Fuchsia', ['#e879f9', '#d946ef', '#c026d3', '#a21caf', '#86198f', '#701a75']],
  ['Purple', ['#c084fc', '#a855f7', '#9333ea', '#7e22ce', '#6b21a8', '#581c87']],
  ['Violet', ['#a78bfa', '#8b5cf6', '#7c3aed', '#6d28d9', '#5b21b6', '#4c1d95']],
  ['Indigo', ['#818cf8', '#6366f1', '#4f46e5', '#4338ca', '#3730a3', '#312e81']],
  ['Blue', ['#60a5fa', '#3b82f6', '#2563eb', '#1d4ed8', '#1e40af', '#1e3a8a']],
  ['Sky', ['#38bdf8', '#0ea5e9', '#0284c7', '#0369a1', '#075985', '#0c4a6e']],
  ['Cyan', ['#22d3ee', '#06b6d4', '#0891b2', '#0e7490', '#155e75', '#164e63']],
  ['Teal', ['#2dd4bf', '#14b8a6', '#0d9488', '#0f766e', '#115e59', '#134e4a']],
  ['Emerald', ['#34d399', '#10b981', '#059669', '#047857', '#065f46', '#064e3b']],
  ['Green', ['#4ade80', '#22c55e', '#16a34a', '#15803d', '#166534', '#14532d']],
  ['Lime', ['#a3e635', '#84cc16', '#65a30d', '#4d7c0f', '#3f6212', '#365314']],
  ['Yellow', ['#facc15', '#eab308', '#ca8a04', '#a16207', '#854d0e', '#713f12']],
  ['Amber', ['#fbbf24', '#f59e0b', '#d97706', '#b45309', '#92400e', '#78350f']],
  ['Orange', ['#fb923c', '#f97316', '#ea580c', '#c2410c', '#9a3412', '#7c2d12']],
  ['Stone', ['#a8a29e', '#78716c', '#57534e', '#44403c', '#292524', '#1c1917']],
  ['Neutral', ['#a3a3a3', '#737373', '#525252', '#404040', '#262626', '#171717']],
  ['Zinc', ['#a1a1aa', '#71717a', '#52525b', '#3f3f46', '#27272a', '#18181b']],
  ['Gray', ['#9ca3af', '#6b7280', '#4b5563', '#374151', '#1f2937', '#111827']],
  ['Slate', ['#94a3b8', '#64748b', '#475569', '#334155', '#1e293b', '#0f172a']],
];
export const FAMILIES = RAW.map(([family, hexes]) => ({ family, colors: hexes.map((hex, i) => ({ name: `${family}, ${SHADES[i].toLowerCase()}`, hex })) }));

/** Recent "color of the year" picks, a popular source of on-trend brand colors. */
export const TRENDING: { name: string; hex: string }[] = [
  { name: 'Mocha mousse (2025)', hex: '#a47864' }, { name: 'Peach fuzz (2024)', hex: '#ffbe98' }, { name: 'Viva magenta (2023)', hex: '#bb2649' },
  { name: 'Very peri (2022)', hex: '#6667ab' }, { name: 'Illuminating (2021)', hex: '#f5df4d' }, { name: 'Ultimate gray (2021)', hex: '#939597' },
  { name: 'Classic blue (2020)', hex: '#0f4c81' }, { name: 'Living coral (2019)', hex: '#ff6f61' }, { name: 'Ultra violet (2018)', hex: '#5f4b8b' },
  { name: 'Greenery (2017)', hex: '#88b04b' }, { name: 'Rose quartz (2016)', hex: '#f7cac9' }, { name: 'Serenity (2016)', hex: '#92a8d1' },
  { name: 'Marsala (2015)', hex: '#955251' }, { name: 'Radiant orchid (2014)', hex: '#b163a3' }, { name: 'Emerald (2013)', hex: '#009473' },
  { name: 'Tangerine tango (2012)', hex: '#dd4124' }, { name: 'Honeysuckle (2011)', hex: '#d94f70' }, { name: 'Turquoise (2010)', hex: '#45b5aa' },
];

/** Every preset hex (for tests). */
export const ALL_PRESETS = [...QUICK.flatMap(([, h]) => (h ? [h] : [])), ...FAMILIES.flatMap((f) => f.colors.map((c) => c.hex)), ...TRENDING.map((t) => t.hex)];
