import { useEffect, useRef, useState, useCallback } from 'react';
import { ShieldAlert, Volume2, RotateCcw, LayoutDashboard, Sliders } from 'lucide-react';
import ChatMessage from './components/ChatMessage';
import ModerationPanel from './components/ModerationPanel';
import SettingsPanel from './components/SettingsPanel';
import { useStore } from './store';
import { getDeterministicColor } from '../../src/shared/colors';
import { useAppWebSocket } from './hooks/useAppWebSocket';

function App() {
  const { messages, bannedUsers } = useStore();
  const { wsRef, currentAudioTime } = useAppWebSocket(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'settings'>('dashboard');

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleBanCurrent = useCallback(() => {
    fetch('/api/skip-ban-current', { method: 'POST' })
      .then(async (r) => {
        const txt = await r.text();
        setToast(txt || 'Banned & skipped current speaker');
        setTimeout(() => setToast(null), 3000);
      })
      .catch(console.error);
  }, []);

  const handleSpeakAsBanned = useCallback(() => {
    fetch('/api/speak-as-banned', { method: 'GET' })
      .then(async (r) => {
        if (r.ok) {
          const res = await r.json();
          setToast(`Queued banned apology for "${res.user}"`);
        } else {
          setToast('No banned users available');
        }
        setTimeout(() => setToast(null), 3000);
      })
      .catch(console.error);
  }, []);

  const handleSpeakAsUser = useCallback(() => {
    // Triggers local speech prompt or fallback test speech
    const defaultText = "Haan bhai sab badhiya chal raha hai!";
    fetch('/api/baba-say', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: defaultText }),
    })
      .then(async (r) => {
        if (r.ok) {
          setToast('Queued BABA speech');
        }
        setTimeout(() => setToast(null), 3000);
      })
      .catch(console.error);
  }, []);

  const handleRestartServer = useCallback(() => {
    if (window.confirm('Restart BABA TTS Server now?')) {
      fetch('/api/restart', { method: 'POST' })
        .then(() => {
          setToast('Server restarting... Reconnecting in 3s');
          setTimeout(() => {
            window.location.reload();
          }, 3000);
        })
        .catch((err) => {
          setToast('Failed to restart server: ' + err.message);
          setTimeout(() => setToast(null), 3000);
        });
    }
  }, []);

  const handleSkipCurrent = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'SKIP_CURRENT_MESSAGE' }));
    } else {
      fetch('/api/skip-current').catch(console.error);
    }
    setToast('Skipped current TTS');
    setTimeout(() => setToast(null), 2500);
  }, [wsRef]);

  const handleClearQueue = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'CLEAR_TTS_QUEUE' }));
    }
    setToast('Cleared TTS queue');
    setTimeout(() => setToast(null), 2500);
  }, [wsRef]);

  // Global Numpad keyboard shortcuts for the Windows application
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes((e.target as HTMLElement)?.tagName)) {
        return;
      }

      if (e.code === 'Numpad1' || (e.key === '1' && e.location === 3)) {
        e.preventDefault();
        handleBanCurrent();
      } else if (e.code === 'Numpad2' || (e.key === '2' && e.location === 3)) {
        e.preventDefault();
        handleSpeakAsBanned();
      } else if (e.code === 'Numpad3' || (e.key === '3' && e.location === 3)) {
        e.preventDefault();
        handleSkipCurrent();
      } else if (e.code === 'Numpad4' || (e.key === '4' && e.location === 3)) {
        e.preventDefault();
        handleSpeakAsUser();
      } else if (e.code === 'Numpad0' || (e.key === '0' && e.location === 3)) {
        e.preventDefault();
        handleClearQueue();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleBanCurrent, handleSpeakAsBanned, handleSpeakAsUser, handleSkipCurrent, handleClearQueue]);

  const simulateGoodMessage = (theme: 'subtitle-sweep' | 'subtitle-karaoke' | 'subtitle-words' | 'pro-clean' = 'subtitle-karaoke') => {
    const id = `test-${Date.now()}`;
    const usernames = [
      'Rahul_Gaming', 'Priya123', 'CoderBhai', 'AmanOP', 'Neha_Sharma', 
      'RohanXD', 'DevNinja', 'TechGuru', 'Sneha_Codes', 'Vikram_YT'
    ];
    const randomUser = usernames[Math.floor(Math.random() * usernames.length)];
    const phrases = [
      'Kya dosto 😄', 'Hello bhai!', 'Namaste dosto!', 'Kya haal hai sabka?',
      'Stream kaafi mast chal rahi hai 🔥', 'Aaj ka setup sach mein bohot clean lag raha hai!',
      'Kya dosto chai pi li sabne? ☕', 'Maza aa raha hai stream dekhne mein 😄'
    ];
    const randomText = phrases[Math.floor(Math.random() * phrases.length)];

    const msg = {
      messageId: id,
      authorName: randomUser,
      authorId: `sim-user-${randomUser}`,
      authorProfileImageUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=${randomUser}`,
      authorColor: getDeterministicColor(randomUser),
      text: randomText,
      status: 'queued' as const,
      theme: theme
    };
    
    if (wsRef.current?.readyState === 1) {
      wsRef.current.send(JSON.stringify({ type: 'SIMULATE_MESSAGE', payload: msg }));
    }
  };

  const banUser = (authorId: string, displayName: string, profileImageUrl?: string) => {
    if (wsRef.current?.readyState === 1) {
      wsRef.current.send(JSON.stringify({ type: 'BAN_USER', payload: { authorId, displayName, profileImageUrl } }));
    }
  };

  const unbanUser = (authorId: string) => {
    if (wsRef.current?.readyState === 1) {
      wsRef.current.send(JSON.stringify({ type: 'UNBAN_USER', payload: { authorId } }));
    }
  };

  const simulateSpamMessage = () => {
    const spamText = 'BUY FOLLOWERS SCAM.COM 😡🤬';
    const msg1 = {
      messageId: `spam-${Date.now()}-1`,
      authorName: 'SpamBot9000',
      authorId: 'sim-bot-9000',
      authorColor: getDeterministicColor('SpamBot9000'),
      authorProfileImageUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=spambot1`,
      text: spamText,
      status: 'queued' as const
    };

    if (wsRef.current?.readyState === 1) {
      wsRef.current.send(JSON.stringify({ type: 'SIMULATE_MESSAGE', payload: msg1 }));
    }
  };

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-gray-950 text-white relative">
      {/* Toast Notification */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-gray-900/95 border border-cyan-500/50 text-cyan-200 px-5 py-3 rounded-2xl shadow-2xl backdrop-blur-md flex items-center gap-3 animate-fade-in text-base font-semibold">
          <span>{toast}</span>
        </div>
      )}

      {/* Top Application Header */}
      <header className="w-full h-16 bg-gray-900 border-b border-gray-800 px-6 flex items-center justify-between shrink-0 z-50">
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-2.5">
            <Volume2 className="w-6 h-6 text-cyan-400" />
            <span className="text-xl font-black tracking-wider text-white">BABA TTS</span>
          </div>

          {/* Navigation Tabs */}
          <div className="flex items-center gap-1 bg-gray-950 p-1 rounded-xl border border-gray-800">
            <button
              onClick={() => setActiveTab('dashboard')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                activeTab === 'dashboard'
                  ? 'bg-cyan-600 text-white shadow'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <LayoutDashboard className="w-4 h-4" />
              <span>Dashboard & Moderation</span>
            </button>

            <button
              onClick={() => setActiveTab('settings')}
              className={`flex items-center gap-2 px-3.5 py-1.5 rounded-lg text-xs font-bold transition-colors ${
                activeTab === 'settings'
                  ? 'bg-cyan-600 text-white shadow'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              <Sliders className="w-4 h-4" />
              <span>Settings</span>
            </button>
          </div>
        </div>

        {/* Right Header Status & Controls */}
        <div className="flex items-center gap-3">
          {/* Banned Users Count Badge */}
          <div 
            className="flex items-center gap-2 px-3 py-1.5 bg-red-950/80 border border-red-700/60 rounded-xl text-red-200 shadow-sm"
            title="Total users banned from TTS"
          >
            <ShieldAlert className="w-4 h-4 text-red-400" />
            <span className="font-bold text-xs uppercase tracking-wide">Banned:</span>
            <span className="px-2 py-0.5 bg-red-800 text-white font-extrabold rounded-full text-xs">
              {bannedUsers.length}
            </span>
          </div>

          <button
            onClick={handleRestartServer}
            className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-red-500/40 rounded-xl text-xs font-semibold text-red-300 transition-colors shadow"
            title="Restart BABA TTS Server"
          >
            <RotateCcw className="w-3.5 h-3.5 text-red-400" />
            <span>Restart</span>
          </button>
        </div>
      </header>

      {/* Main Body Content based on Active Tab */}
      {activeTab === 'settings' ? (
        <div className="flex-1 overflow-y-auto p-6 max-w-5xl mx-auto w-full">
          <SettingsPanel />
        </div>
      ) : (
        <div className="flex-1 flex overflow-hidden">
          {/* LEFT COLUMN: Controls, Simulation & Moderation Panel */}
          <div className="w-[620px] h-full flex flex-col bg-gray-900 border-r border-gray-800 p-5 gap-4 overflow-y-auto shrink-0">
            {/* Quick Stream Action Buttons */}
            <div className="grid grid-cols-3 gap-2.5">
              <button
                onClick={handleBanCurrent}
                className="px-3 py-2.5 bg-orange-600 hover:bg-orange-500 rounded-xl text-sm font-bold transition-all shadow-md text-white flex flex-col items-center justify-center"
                title="Ban & Skip Current Speaker [Num 1]"
              >
                <span>Ban Speaker</span>
                <span className="text-[11px] text-orange-200 font-mono font-normal">[Num 1]</span>
              </button>

              <button
                onClick={handleSpeakAsBanned}
                className="px-3 py-2.5 bg-rose-600 hover:bg-rose-500 rounded-xl text-sm font-bold transition-all shadow-md text-white flex flex-col items-center justify-center"
                title="Speak apology as banned user [Num 2]"
              >
                <span>Speak Banned</span>
                <span className="text-[11px] text-rose-200 font-mono font-normal">[Num 2]</span>
              </button>

              <button
                onClick={handleSpeakAsUser}
                className="px-3 py-2.5 bg-cyan-700 hover:bg-cyan-600 rounded-xl text-sm font-bold transition-all shadow-md text-white flex flex-col items-center justify-center"
                title="Speak as BABA streamer [Num 4]"
              >
                <span>Speak BABA</span>
                <span className="text-[11px] text-cyan-200 font-mono font-normal">[Num 4]</span>
              </button>

              <button
                onClick={handleSkipCurrent}
                className="px-3 py-2.5 bg-yellow-600 hover:bg-yellow-500 rounded-xl text-sm font-bold transition-all shadow-md text-white flex flex-col items-center justify-center"
                title="Skip current message [Num 3]"
              >
                <span>Skip Current</span>
                <span className="text-[11px] text-yellow-200 font-mono font-normal">[Num 3]</span>
              </button>

              <button
                onClick={handleClearQueue}
                className="px-3 py-2.5 bg-red-700 hover:bg-red-600 rounded-xl text-sm font-bold transition-all shadow-md text-white flex flex-col items-center justify-center"
                title="Clear queue [Num 0]"
              >
                <span>Clear Queue</span>
                <span className="text-[11px] text-red-200 font-mono font-normal">[Num 0]</span>
              </button>

              <button
                onClick={simulateSpamMessage}
                className="px-3 py-2.5 bg-purple-600 hover:bg-purple-500 rounded-xl text-sm font-bold transition-all shadow-md text-white flex flex-col items-center justify-center"
                title="Test spam message filter"
              >
                <span>Simulate Spam</span>
                <span className="text-[11px] text-purple-200 font-mono font-normal">Test</span>
              </button>
            </div>

            {/* Test Simulation Toolbar */}
            <div className="w-full flex items-center gap-2 bg-gray-950 p-2 rounded-xl border border-gray-800">
              <span className="text-gray-400 text-xs font-bold uppercase tracking-wider pl-1 shrink-0">Simulate:</span>
              <button onClick={() => simulateGoodMessage('subtitle-karaoke')} className="flex-1 px-2.5 py-1 bg-gray-800 hover:bg-gray-700 rounded-lg text-white text-xs font-bold transition-colors border border-gray-700">Karaoke</button>
              <button onClick={() => simulateGoodMessage('subtitle-sweep')} className="flex-1 px-2.5 py-1 bg-gray-800 hover:bg-gray-700 rounded-lg text-white text-xs font-bold transition-colors border border-gray-700">Sweep</button>
              <button onClick={() => simulateGoodMessage('subtitle-words')} className="flex-1 px-2.5 py-1 bg-gray-800 hover:bg-gray-700 rounded-lg text-white text-xs font-bold transition-colors border border-gray-700">Words</button>
              <button onClick={() => simulateGoodMessage('pro-clean')} className="flex-1 px-2.5 py-1 bg-gray-800 hover:bg-gray-700 rounded-lg text-white text-xs font-bold transition-colors border border-cyan-500/50 text-cyan-200">Pro Clean</button>
            </div>

            {/* Moderation Columns */}
            <div className="flex-1 min-h-[300px]">
              <ModerationPanel onBanUser={banUser} onUnbanUser={unbanUser} />
            </div>
          </div>

          {/* RIGHT COLUMN: Live Chat History & Real-Time Animated Stream Preview */}
          <div className="flex-1 flex flex-col h-full bg-[#121214] p-6 overflow-hidden relative">
            <div className="flex justify-between items-center pb-3 border-b border-gray-800 mb-4 shrink-0">
              <h2 className="text-sm font-black text-gray-400 uppercase tracking-widest flex items-center gap-2">
                <span>Live Chat History & Monitor</span>
                <span className="w-2 h-2 rounded-full bg-green-500 animate-pulse" />
              </h2>
              <span className="text-xs font-mono text-gray-400">Total: {messages.length}</span>
            </div>

            {/* Scrolling Chat History */}
            <div className="flex-1 overflow-y-auto overflow-x-hidden flex flex-col pr-2 space-y-3">
              <div className="flex flex-col min-h-full justify-end space-y-3">
                {messages.length === 0 ? (
                  <div className="flex items-center justify-center h-48 text-gray-600 text-sm italic">
                    Waiting for YouTube chat messages or test simulation...
                  </div>
                ) : (
                  messages.filter(msg => msg.status !== 'error').map((msg) => (
                    <ChatMessage 
                      key={msg.messageId} 
                      message={msg} 
                      currentAudioTime={msg.status === 'speaking' ? currentAudioTime : 0} 
                      hideHistory={false}
                    />
                  ))
                )}
                <div ref={messagesEndRef} />
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

export default App;
