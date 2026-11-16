export const CHAT_COLORS = [
  '#f87171', // red-400
  '#fb7185', // rose-400
  '#f472b6', // pink-400
  '#c084fc', // purple-400
  '#a78bfa', // violet-400
  '#818cf8', // indigo-400
  '#60a5fa', // blue-400
  '#38bdf8', // sky-400
  '#2dd4bf', // teal-400
  '#4ade80', // green-400
  '#a3e635', // lime-400
  '#facc15', // yellow-400
  '#fbbf24', // amber-400
  '#fb923c', // orange-400
];

export const CHAT_COLORS_LIGHT = [
  '#dc2626', // red-600
  '#e11d48', // rose-600
  '#db2777', // pink-600
  '#9333ea', // purple-600
  '#7c3aed', // violet-600
  '#4f46e5', // indigo-600
  '#2563eb', // blue-600
  '#0284c7', // sky-600
  '#0d9488', // teal-600
  '#16a34a', // green-600
  '#65a30d', // lime-600
  '#ca8a04', // yellow-600
  '#d97706', // amber-600
  '#ea580c', // orange-600
];

export function getDeterministicColor(username: string, mode: 'dark' | 'light' = 'dark'): string {
  const palette = mode === 'light' ? CHAT_COLORS_LIGHT : CHAT_COLORS;
  if (!username) return palette[0];

  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = username.charCodeAt(i) + ((hash << 5) - hash);
  }

  const index = Math.abs(hash) % palette.length;
  return palette[index];
}
