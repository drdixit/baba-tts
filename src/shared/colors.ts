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

export function getDeterministicColor(username: string): string {
  if (!username) return CHAT_COLORS[0];
  
  let hash = 0;
  for (let i = 0; i < username.length; i++) {
    hash = username.charCodeAt(i) + ((hash << 5) - hash);
  }
  
  const index = Math.abs(hash) % CHAT_COLORS.length;
  return CHAT_COLORS[index];
}
