import re

with open('frontend/src/App.tsx', 'r') as f:
    content = f.read()

# Replace simulateGoodMessage completely (from line 108 to 149)
old_func_pattern = r"const simulateGoodMessage = \([\s\S]*?simulateSpamMessage = \(\) => \{"

new_funcs = """const simulateGoodMessage = (theme: 'default' | 'waveform' | 'neon' | 'typewriter' | 'subtitle-sweep' | 'subtitle-karaoke' | 'subtitle-words' | 'pro-clean' = 'default') => {
    const id = `test-${Date.now()}`;
    const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
    let randomUser = '';
    for (let i = 0; i < 15; i++) randomUser += chars.charAt(Math.floor(Math.random() * chars.length));

    const words = ['testing', 'animation', 'spotlight', 'zone', 'layout', 'obs', 'stream', 'chat', 'message', 'limits', 'wow', 'cool', 'awesome'];
    let randomText = '';
    while (randomText.length < 100) {
      randomText += words[Math.floor(Math.random() * words.length)] + ' ';
    }
    randomText = randomText.substring(0, 100).trim();

    const hue = Math.floor(Math.random() * 360);
    const authorColor = `hsl(${hue}, 80%, 60%)`;

    const msg = {
      messageId: id,
      authorName: randomUser,
      authorProfileImageUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=${randomUser}`,
      authorColor: authorColor,
      text: randomText, // Removed [THEME] text!
      status: 'idle',
      theme: theme
    };
    
    if (wsRef.current?.readyState === 1) {
      wsRef.current.send(JSON.stringify({ type: 'SIMULATE_MESSAGE', payload: msg }));
    }
  };

  const simulateSpamMessage = () => {"""

content = re.sub(old_func_pattern, new_funcs, content)

spam_old_pattern = r"const simulateSpamMessage = \(\) => \{[\s\S]*?setTimeout\(\(\) => updateMessageStatus\(id, 'skipped'\), 800\);\n  \};"

spam_new_func = """const simulateSpamMessage = () => {
    const id = `spam-${Date.now()}`;
    let spamText = '';
    while (spamText.length < 200) {
      spamText += 'BUY FOLLOWERS SCAM.COM 😡🤬 ';
    }
    spamText = spamText.substring(0, 200).trim();

    const msg = {
      messageId: id,
      authorName: 'SpamBot9000_ExtraLongName12345',
      authorProfileImageUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=spambot`,
      text: spamText,
      status: 'idle'
    };
    
    if (wsRef.current?.readyState === 1) {
      wsRef.current.send(JSON.stringify({ type: 'SIMULATE_MESSAGE', payload: msg }));
    }
  };"""

content = re.sub(spam_old_pattern, spam_new_func, content)

with open('frontend/src/App.tsx', 'w') as f:
    f.write(content)
