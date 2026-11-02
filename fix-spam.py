import re

with open('frontend/src/App.tsx', 'r') as f:
    content = f.read()

# Replace simulateSpamMessage
old_spam = r"const simulateSpamMessage = \(\) => \{[\s\S]*?wsRef\.current\.send\(JSON\.stringify\(\{ type: 'SIMULATE_MESSAGE', payload: msg \}\)\);\n    \}\n  \};"

new_spam = """const simulateSpamMessage = () => {
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
      status: 'default'
    };
    
    // Add locally, bypass backend entirely so it doesn't speak
    useStore.getState().addMessages([msg as any]);
    
    // Auto-skip (or mark deleted) after 800ms
    setTimeout(() => {
      useStore.getState().updateMessageStatus(id, 'skipped');
    }, 800);
  };"""

content = re.sub(old_spam, new_spam, content)

with open('frontend/src/App.tsx', 'w') as f:
    f.write(content)
