import re

with open('src/backend/tts.ts', 'r') as f:
    content = f.read()

# Replace the voice name line
old_voice = r'const voiceName = "hi-IN-AnanyaNeural";'

new_voice = """const voices = [
      "hi-IN-AnanyaNeural",
      "en-IN-NeerjaNeural",
      "en-IN-PrabhatNeural",
      "hi-IN-MadhurNeural"
    ];
    const voiceName = voices[Math.floor(Math.random() * voices.length)];"""

content = re.sub(old_voice, new_voice, content)

with open('src/backend/tts.ts', 'w') as f:
    f.write(content)
