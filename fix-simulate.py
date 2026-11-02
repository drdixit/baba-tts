import re

with open('frontend/src/App.tsx', 'r') as f:
    content = f.read()

# Replace simulateGoodMessage completely
old_pattern = r"const simulateGoodMessage = \([\s\S]*?\}\]\);\n  \};"

new_func = """const simulateGoodMessage = (theme: 'default' | 'waveform' | 'neon' | 'typewriter' | 'subtitle-sweep' | 'subtitle-karaoke' | 'subtitle-words' | 'pro-clean' = 'default') => {
    const id = `test-${Date.now()}`;
    
    // Generate 30 character random username
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let randomUser = '';
    for (let i = 0; i < 15; i++) randomUser += chars.charAt(Math.floor(Math.random() * chars.length));

    // Generate random ~100 character message
    const words = ['testing', 'animation', 'spotlight', 'zone', 'layout', 'obs', 'stream', 'chat', 'message', 'limits', 'wow', 'cool', 'awesome'];
    let randomText = '';
    while (randomText.length < 100) {
      randomText += words[Math.floor(Math.random() * words.length)] + ' ';
    }
    randomText = randomText.substring(0, 100).trim();

    // Generate a random vibrant hex color for testing
    const hue = Math.floor(Math.random() * 360);
    const authorColor = `hsl(${hue}, 80%, 60%)`;

    const msg = {
      messageId: id,
      authorName: randomUser,
      authorProfileImageUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=${randomUser}`,
      authorColor: authorColor,
      text: randomText,
      timestamp: new Date().toISOString(),
      status: 'idle'
    };
    
    if (wsRef.current?.readyState === 1) { // 1 is WebSocket.OPEN
      wsRef.current.send(JSON.stringify({ type: 'SIMULATE_MESSAGE', payload: msg }));
    }
  };"""

content = re.sub(old_pattern, new_func, content)

with open('frontend/src/App.tsx', 'w') as f:
    f.write(content)
