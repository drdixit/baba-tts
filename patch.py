import re

with open('frontend/src/App.tsx', 'r') as f:
    content = f.read()

# 1. Update the Test Azure Voice button
old_button = """<button
              onClick={() => {
                if (wsRef.current?.readyState === WebSocket.OPEN) {
                  wsRef.current.send(JSON.stringify({ type: 'TEST_AZURE_TTS' }));
                }
              }}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-sm font-semibold transition-colors shadow-lg"
            >
              Test Azure Voice
            </button>"""

new_button = """<button
              onClick={() => {
                if (wsRef.current?.readyState === WebSocket.OPEN) {
                  wsRef.current.send(JSON.stringify({ type: 'CLEAR_TTS_QUEUE' }));
                }
                if (audioRef.current) {
                  audioRef.current.pause();
                  audioRef.current.currentTime = 0;
                }
              }}
              className="px-4 py-2 bg-red-600 hover:bg-red-500 rounded text-sm font-semibold transition-colors shadow-lg"
            >
              Clear TTS Queue
            </button>"""

if "Test Azure Voice" in content:
    content = content.replace(old_button, new_button)
    # also try a looser regex if exact replace fails
    content = re.sub(r'<button\s*onClick=\{[\s\S]*?Test Azure Voice\s*</button>', new_button, content)

with open('frontend/src/App.tsx', 'w') as f:
    f.write(content)

