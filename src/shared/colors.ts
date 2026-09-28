export const CHAT_COLORS = [
  '#FF5733', // Bright Red-Orange
  '#FF3366', // Hot Pink
  '#FF33A8', // Magenta
  '#D633FF', // Purple
  '#8A33FF', // Indigo
  '#335BFF', // Royal Blue
  '#33B5FF', // Cyan
  '#33FFD6', // Aqua
  '#33FF7A', // Spring Green
  '#7AFF33', // Lime
  '#D6FF33', // Yellow-Green
  '#FFC733', // Golden Yellow
  '#FF8A33', // Orange
  '#FF3333', // Red
  '#E60000', // Crimson
  '#00E676', // Malachite
  '#00B0FF', // Deep Sky Blue
  '#651FFF', // Deep Purple
  '#F50057', // Pink
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
