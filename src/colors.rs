pub const CHAT_COLORS: [&str; 14] = [
    "#f87171", // red-400
    "#fb7185", // rose-400
    "#f472b6", // pink-400
    "#c084fc", // purple-400
    "#a78bfa", // violet-400
    "#818cf8", // indigo-400
    "#60a5fa", // blue-400
    "#38bdf8", // sky-400
    "#2dd4bf", // teal-400
    "#4ade80", // green-400
    "#a3e635", // lime-400
    "#facc15", // yellow-400
    "#fbbf24", // amber-400
    "#fb923c", // orange-400
];

pub fn get_deterministic_color(username: &str) -> &'static str {
    if username.is_empty() {
        return CHAT_COLORS[0];
    }

    let mut hash: i32 = 0;
    for b in username.encode_utf16() {
        hash = (hash.wrapping_shl(5).wrapping_sub(hash)).wrapping_add(b as i32);
    }

    let index = (hash.unsigned_abs() as usize) % CHAT_COLORS.len();
    CHAT_COLORS[index]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_deterministic_color() {
        let color1 = get_deterministic_color("Rahul_Gaming");
        let color2 = get_deterministic_color("Rahul_Gaming");
        assert_eq!(color1, color2);
        assert!(CHAT_COLORS.contains(&color1));

        let empty = get_deterministic_color("");
        assert_eq!(empty, CHAT_COLORS[0]);
    }
}
