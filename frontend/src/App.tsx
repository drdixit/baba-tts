import { useEffect, useRef, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Volume2,
  LayoutDashboard,
  ShieldAlert,
  Sliders,
  Tv,
  RotateCcw,
  Trash2,
  RefreshCw,
  Send,
  Sparkles,
  Copy,
  Check,
  MessageSquare,
  AlertTriangle,
  ExternalLink,
} from 'lucide-react';
import ChatMessage from './components/ChatMessage';
import ModerationPanel from './components/ModerationPanel';
import SettingsPanel from './components/SettingsPanel';
import ChatPage from './ChatPage';
import PopupPage from './PopupPage';
import OverlayPage from './OverlayPage';
import { useStore } from './store';
import { getDeterministicColor } from '../../src/shared/colors';
import { useAppWebSocket } from './hooks/useAppWebSocket';

export default function App() {
  const [searchParams] = useSearchParams();
  const overlayMode = searchParams.get('overlay');

  // Support direct query param bypass for OBS Browser Sources:
  // e.g. http://localhost:7060/?overlay=popup or ?overlay=chat or ?overlay=full
  if (overlayMode === 'popup') {
    return <PopupPage />;
  }
  if (overlayMode === 'chat') {
    return <ChatPage />;
  }
  if (overlayMode === 'full' || overlayMode === 'overlay') {
    return <OverlayPage />;
  }

  return <DesktopApp />;
}

function DesktopApp() {
  const { messages, bannedUsers } = useStore();
  const { wsRef, currentAudioTime, isConnected } = useAppWebSocket(true);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [activeTab, setActiveTab] = useState<'monitor' | 'moderation' | 'settings' | 'obs'>('monitor');
  const [toast, setToast] = useState<string | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);
  const [manualText, setManualText] = useState('');
  const [serverPort, setServerPort] = useState<number>(() => {
    return parseInt(window.location.port, 10) || 7060;
  });

  const activeMessage = messages.find(
    (m) => m.status === 'speaking' || m.status === 'processing'
  );

  const activeQueueCount = messages.filter(
    (m) => m.status === 'queued' || m.status === 'processing'
  ).length;

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 3500);
  }, []);

  const copyToClipboard = useCallback((text: string, key: string, label?: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedKey(key);
      showToast(`Copied ${label || key} URL to clipboard!`);
      setTimeout(() => setCopiedKey(null), 2000);
    }).catch(() => {
      showToast('Failed to copy to clipboard');
    });
  }, [showToast]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    if (activeTab === 'monitor') {
      scrollToBottom();
    }
  }, [messages, activeTab]);

  // Fetch active port info
  useEffect(() => {
    fetch('/api/info')
      .then((res) => res.json())
      .then((data) => {
        if (data.port) {
          setServerPort(data.port);
        }
      })
      .catch(() => {});
  }, []);

  const handleSkipCurrent = useCallback(() => {
    fetch('/api/skip-current', { method: 'POST' })
      .then(() => showToast('Skipped current TTS message'))
      .catch((e) => showToast(`Skip failed: ${e.message}`));
  }, [showToast]);

  const handleBanCurrent = useCallback(() => {
    fetch('/api/skip-ban-current', { method: 'POST' })
      .then(async (r) => {
        const txt = await r.text();
        showToast(txt || 'Banned & skipped current speaker');
      })
      .catch((e) => showToast(`Ban failed: ${e.message}`));
  }, [showToast]);

  const handleClearQueue = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'CLEAR_TTS_QUEUE' }));
      showToast('Cleared TTS queue');
    } else {
      showToast('WebSocket not connected');
    }
  }, [wsRef, showToast]);

  const handleRestart = useCallback(() => {
    fetch('/api/restart', { method: 'POST' })
      .then(() => showToast('Server restart initiated...'))
      .catch((e) => showToast(`Restart failed: ${e.message}`));
  }, [showToast]);

  const handleManualSpeakBaba = useCallback(() => {
    const textToSend = manualText.trim() || 'Namaste dosto, BABA TTS chal raha hai!';
    fetch('/api/baba-say', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: textToSend }),
    })
      .then((r) => {
        if (r.ok) {
          showToast(`Queued BABA speech: "${textToSend.slice(0, 30)}..."`);
          setManualText('');
        } else {
          showToast('Failed to queue speech');
        }
      })
      .catch((e) => showToast(`Error: ${e.message}`));
  }, [manualText, showToast]);

  const handleSpeakAsBanned = useCallback(() => {
    const textToSend = manualText.trim() || 'Sorry bhai, aage se spam nahi karunga!';
    fetch('/api/speak-as-banned', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: textToSend }),
    })
      .then((r) => {
        if (r.ok) {
          showToast(`Queued banned speech: "${textToSend.slice(0, 30)}..."`);
          setManualText('');
        } else {
          showToast('Failed to queue speech');
        }
      })
      .catch((e) => showToast(`Error: ${e.message}`));
  }, [manualText, showToast]);

  const simulateGoodMessage = useCallback(() => {
    const id = `test-${Date.now()}`;
    const usernames = [
      'Rahul_Gaming', 'Priya123', 'CoderBhai', 'AmanOP', 'Neha_Sharma',
      'RohanXD', 'DevNinja', 'TechGuru', 'Sneha_Codes', 'Vikram_YT',
    ];
    const randomUser = usernames[Math.floor(Math.random() * usernames.length)];
    const phrases = [
      'Kya dosto 😄', 'Hello bhai stream mast chal rahi hai! 🔥',
      'Aaj ka setup sach mein bohot clean lag raha hai!',
      'Kya dosto chai pi li sabne? ☕', 'Maza aa raha hai stream dekhne mein 😄',
      'Bhai ye feature toh bohot zabardast hai!',
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
      theme: 'subtitle-karaoke' as const,
    };

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'SIMULATE_MESSAGE', payload: msg }));
      showToast(`Simulated message from "${randomUser}"`);
    } else {
      showToast('WebSocket not connected');
    }
  }, [wsRef, showToast]);

  const handleBanUser = useCallback((authorId: string, displayName: string, profileImageUrl?: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'BAN_USER',
          payload: { authorId, displayName, profileImageUrl },
        })
      );
      showToast(`Banned "${displayName}"`);
    }
  }, [wsRef, showToast]);

  const handleUnbanUser = useCallback((authorId: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(
        JSON.stringify({
          type: 'UNBAN_USER',
          payload: { authorId },
        })
      );
      showToast('Unbanned user');
    }
  }, [wsRef, showToast]);

  const port = serverPort || 7060;
  const protocol = window.location.protocol === 'file:' ? 'http:' : window.location.protocol;
  const hostname = window.location.hostname || 'localhost';
  const baseUrl = `${protocol}//${hostname}:${port}`;

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-slate-50 text-slate-800 select-none">
      {/* Toast Notification (Windows 11 InfoBar Style) */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-white/95 border border-black/10 text-slate-800 px-3.5 py-2 rounded-md shadow-[0_4px_16px_rgba(0,0,0,0.12)] backdrop-blur-md flex items-center gap-2.5 animate-fade-in text-xs font-medium">
          <Check className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>{toast}</span>
        </div>
      )}

      {/* Windows 11 Desktop Command Bar & Navigation Strip */}
      <header className="w-full min-h-10 md:h-10 bg-[#FAFBFD] border-b border-black/[0.08] px-3 py-1.5 md:py-0 flex flex-wrap md:flex-nowrap items-center justify-between gap-2 md:gap-3 shrink-0 z-40 select-none shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
        {/* Left Section: App Title & Status Indicators */}
        <div className="flex items-center gap-2 sm:gap-3">
          <div className="flex items-center gap-1.5">
            <Volume2 className="w-4 h-4 text-[#0067C0] shrink-0" />
            <span className="text-xs font-semibold text-slate-800 tracking-tight">BABA TTS</span>
            <span className="text-[10px] text-slate-500 font-medium px-1.5 py-0.5 rounded-[3px] bg-black/[0.04] border border-black/[0.06] hidden sm:inline-block">
              Desktop
            </span>
          </div>

          <div className="h-3.5 w-px bg-slate-300 mx-0.5 hidden sm:block" />

          {/* Micro Telemetry Badges */}
          <div className="flex items-center gap-1.5 text-[11px]">
            {/* Port Status */}
            <div
              className={`flex items-center gap-1.5 px-2 py-0.5 rounded-[3px] border transition-colors ${
                isConnected
                  ? 'bg-emerald-50/70 border-emerald-500/20 text-emerald-800'
                  : 'bg-amber-50/70 border-amber-500/20 text-amber-800'
              }`}
              title={isConnected ? `Server active on port ${port}` : `Attempting connection to port ${port}...`}
            >
              <span className={`w-1.5 h-1.5 rounded-full ${isConnected ? 'bg-emerald-500 shadow-[0_0_6px_rgba(16,185,129,0.8)]' : 'bg-amber-500 animate-pulse'}`} />
              <span className="font-mono text-[10.5px] font-medium">:{port}</span>
            </div>

            {/* Queue Counter */}
            <div
              className="flex items-center gap-1 px-1.5 py-0.5 rounded-[3px] bg-black/[0.03] border border-black/[0.06] text-slate-700"
              title={`${activeQueueCount} item(s) in queue`}
            >
              <span className="text-slate-400 font-normal">Q:</span>
              <span className={`font-semibold font-mono text-[10.5px] ${activeQueueCount > 0 ? 'text-[#0067C0]' : 'text-slate-600'}`}>
                {activeQueueCount}
              </span>
            </div>

            {/* Banned Counter */}
            {bannedUsers.length > 0 && (
              <div
                className="flex items-center gap-1 px-1.5 py-0.5 rounded-[3px] bg-rose-50/80 border border-rose-300/40 text-rose-800"
                title={`${bannedUsers.length} user(s) banned`}
              >
                <span className="text-rose-400 font-normal">B:</span>
                <span className="font-semibold font-mono text-[10.5px]">
                  {bannedUsers.length}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Center Section: Windows 11 Native TabStrip */}
        <nav
          role="tablist"
          aria-label="Application sections"
          className="h-full flex items-center gap-0.5 order-last md:order-none w-full md:w-auto justify-center border-t md:border-t-0 border-slate-200/60 pt-1 md:pt-0"
        >
          {[
            { id: 'monitor' as const, label: 'Live monitor', icon: LayoutDashboard },
            { id: 'moderation' as const, label: 'Moderation', icon: ShieldAlert },
            { id: 'settings' as const, label: 'Settings', icon: Sliders },
            { id: 'obs' as const, label: 'OBS overlays', icon: Tv },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveTab(tab.id)}
                className={`relative h-8 md:h-full px-2.5 sm:px-3 flex items-center gap-1.5 text-xs font-medium transition-colors cursor-pointer rounded-t-[4px] md:rounded-none focus-visible:ring-2 focus-visible:ring-[#0067C0] focus-visible:outline-none ${
                  isActive
                    ? 'text-slate-900 bg-black/[0.03] font-semibold'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-black/[0.04]'
                }`}
                title={tab.label}
              >
                <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-[#0067C0]' : 'text-slate-500'}`} />
                <span>{tab.label}</span>
                {/* Active Indicator Accent Line (Windows 11 Fluent) */}
                {isActive && (
                  <span className="absolute bottom-0 left-2 right-2 h-[2.5px] bg-[#0067C0] rounded-t-full" />
                )}
              </button>
            );
          })}
        </nav>

        {/* Right Section: Windows 11 Fluent Desktop Action Toolbar */}
        <div className="flex items-center gap-1 shrink-0">
          <button
            onClick={handleSkipCurrent}
            className="h-7 px-2 flex items-center gap-1.5 rounded-[4px] bg-white hover:bg-slate-50 active:bg-slate-100 border border-slate-200/90 text-xs font-medium text-amber-800 shadow-[0_1px_1px_rgba(0,0,0,0.02)] transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-[#0067C0] focus-visible:outline-none"
            title="Skip currently playing TTS message"
          >
            <RotateCcw className="w-3 h-3 text-amber-600" />
            <span className="hidden sm:inline">Skip</span>
          </button>

          <button
            onClick={handleBanCurrent}
            className="h-7 px-2 flex items-center gap-1.5 rounded-[4px] bg-white hover:bg-slate-50 active:bg-slate-100 border border-slate-200/90 text-xs font-medium text-rose-800 shadow-[0_1px_1px_rgba(0,0,0,0.02)] transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-[#0067C0] focus-visible:outline-none"
            title="Ban & skip currently speaking user"
          >
            <ShieldAlert className="w-3 h-3 text-rose-600" />
            <span className="hidden sm:inline">Ban speaker</span>
          </button>

          <button
            onClick={handleClearQueue}
            className="h-7 px-2 flex items-center gap-1.5 rounded-[4px] bg-white hover:bg-slate-50 active:bg-slate-100 border border-slate-200/90 text-xs font-medium text-slate-700 shadow-[0_1px_1px_rgba(0,0,0,0.02)] transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-[#0067C0] focus-visible:outline-none"
            title="Purge pending TTS queue"
          >
            <Trash2 className="w-3 h-3 text-slate-500" />
            <span className="hidden md:inline">Clear queue</span>
          </button>

          <button
            onClick={handleRestart}
            className="h-7 px-2 flex items-center gap-1.5 rounded-[4px] bg-white hover:bg-slate-50 active:bg-slate-100 border border-slate-200/90 text-xs font-medium text-slate-700 shadow-[0_1px_1px_rgba(0,0,0,0.02)] transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-[#0067C0] focus-visible:outline-none"
            title="Restart BABA TTS daemon"
          >
            <RefreshCw className="w-3 h-3 text-slate-500" />
            <span className="hidden lg:inline">Restart</span>
          </button>
        </div>
      </header>

      {/* Main Tab Views */}
      <main className="flex-1 overflow-hidden flex flex-col min-h-0 bg-slate-50">
        {/* TAB 1: LIVE MONITOR & CHAT */}
        {activeTab === 'monitor' && (
          <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden">
            {/* Left Column: Currently Speaking Spotlight & Manual Speech Controls */}
            <div className="w-full md:w-[360px] lg:w-[400px] xl:w-[440px] max-h-[46vh] md:max-h-none flex flex-col gap-3.5 p-4 sm:p-5 border-b md:border-b-0 md:border-r border-slate-200 bg-white overflow-y-auto shrink-0">
              {/* CURRENTLY SPEAKING CARD */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                    <Volume2 className="w-3.5 h-3.5 text-[#0067C0]" />
                    Currently speaking
                  </span>
                  {activeMessage && (
                    <span className="text-[10px] font-medium font-mono px-2 py-0.5 rounded-[3px] bg-emerald-50 text-emerald-800 border border-emerald-300/60 animate-pulse uppercase">
                      {activeMessage.status}
                    </span>
                  )}
                </div>

                {activeMessage ? (
                  <div className="relative">
                    <ChatMessage
                      message={activeMessage}
                      currentAudioTime={currentAudioTime}
                      hideHistory={true}
                      hideCard={false}
                      variant="inline"
                    />
                  </div>
                ) : (
                  <div className="p-4 rounded-lg bg-[#FAFAFA] border border-black/[0.08] flex flex-col items-center justify-center text-center gap-2.5 text-slate-500 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
                    <div className="w-9 h-9 rounded-md bg-black/[0.04] border border-black/[0.06] flex items-center justify-center text-slate-500">
                      <Volume2 className="w-4 h-4 text-slate-400 animate-pulse" />
                    </div>
                    <div>
                      <div className="font-semibold text-slate-800 text-xs">TTS engine idle</div>
                      <div className="text-[11px] text-slate-500 mt-0.5">
                        Ready for YouTube live chat or manual speech.
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {/* MANUAL INPUT & TEST BAR */}
              <div className="flex flex-col gap-2.5 p-3 rounded-lg bg-white border border-black/[0.08] shadow-[0_1px_2px_rgba(0,0,0,0.02)] mt-auto">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                    <Send className="w-3.5 h-3.5 text-[#0067C0]" />
                    Quick manual speech
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono hidden sm:inline">Num 2 / Num 4</span>
                </div>

                <div className="flex flex-col gap-2">
                  <div className="flex gap-1.5">
                    <input
                      type="text"
                      value={manualText}
                      onChange={(e) => setManualText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleManualSpeakBaba();
                        }
                      }}
                      placeholder="Type words to speak aloud..."
                      className="flex-1 min-w-0 h-8 px-2.5 rounded-[4px] bg-white border border-black/[0.15] border-b-black/[0.3] focus:border-[#0067C0] focus-visible:ring-2 focus-visible:ring-[#0067C0] focus-visible:outline-none text-xs text-slate-900 placeholder-slate-400 transition-colors shadow-2xs"
                    />
                    <button
                      onClick={handleManualSpeakBaba}
                      className="h-8 px-3 rounded-[4px] bg-[#0067C0] hover:bg-[#1879CD] text-white text-xs font-medium transition-colors shadow-2xs shrink-0 flex items-center gap-1 cursor-pointer focus-visible:ring-2 focus-visible:ring-[#0067C0] focus-visible:outline-none"
                      title="Speak as BABA"
                    >
                      <Volume2 className="w-3.5 h-3.5" />
                      <span>Speak</span>
                    </button>
                  </div>

                  <div className="flex items-center gap-1.5">
                    <button
                      onClick={handleSpeakAsBanned}
                      className="flex-1 h-7 flex items-center justify-center gap-1 px-2 rounded-[4px] bg-[#FBFBFB] hover:bg-[#F0F0F0] active:bg-[#E5E5E5] border border-black/[0.08] text-slate-700 text-xs font-normal transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-[#0067C0] focus-visible:outline-none"
                      title="Test speech with banned filter persona"
                    >
                      <span>Speak banned</span>
                    </button>

                    <button
                      onClick={simulateGoodMessage}
                      className="flex-1 h-7 flex items-center justify-center gap-1 px-2 rounded-[4px] bg-[#FBFBFB] hover:bg-[#F0F0F0] active:bg-[#E5E5E5] border border-black/[0.08] text-slate-700 text-xs font-normal transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-[#0067C0] focus-visible:outline-none"
                      title="Simulate a chat message from viewer"
                    >
                      <Sparkles className="w-3.5 h-3.5 text-amber-500" />
                      <span className="truncate">Simulate chat</span>
                    </button>
                  </div>
                </div>
              </div>
            </div>

            {/* Right Column: Live Chat History Feed */}
            <div className="flex-1 flex flex-col p-4 sm:p-5 overflow-hidden min-h-0 bg-slate-50">
              <div className="flex items-center justify-between pb-2.5 border-b border-black/[0.08] mb-3">
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-[#0067C0]" />
                  <span className="text-xs font-semibold text-slate-800">
                    Live chat stream
                  </span>
                  <span className="text-[11px] font-mono px-1.5 py-0.2 rounded-[3px] bg-black/[0.04] border border-black/[0.08] text-slate-700 font-medium">
                    {messages.length}
                  </span>
                </div>
                <div className="text-[11px] text-slate-500">
                  Auto-syncing with audio engine
                </div>
              </div>

              {/* Chat Messages Feed */}
              <div className="flex-1 overflow-y-auto space-y-1.5 pr-2 custom-scrollbar min-h-0">
                {messages.length === 0 ? (
                  <div className="h-full flex flex-col items-center justify-center text-slate-400 gap-2 p-8 text-center">
                    <MessageSquare className="w-8 h-8 text-slate-300 stroke-[1.5]" />
                    <div className="font-semibold text-slate-600 text-xs">No Chat Messages Yet</div>
                    <div className="text-[11px] text-slate-500 max-w-sm">
                      Messages from your YouTube live chat or test simulation buttons will appear here in real-time.
                    </div>
                  </div>
                ) : (
                  <>
                    {messages
                      .filter((msg) => msg.status !== 'error')
                      .map((msg) => (
                        <ChatMessage
                          key={msg.messageId}
                          message={msg}
                          currentAudioTime={0}
                          hideCard={true}
                          hideHistory={false}
                          variant="inline"
                        />
                      ))}
                    <div ref={messagesEndRef} />
                  </>
                )}
              </div>
            </div>
          </div>
        )}

        {/* TAB 2: MODERATION */}
        {activeTab === 'moderation' && (
          <div className="flex-1 p-6 overflow-hidden flex flex-col min-h-0 bg-slate-50">
            <ModerationPanel onBanUser={handleBanUser} onUnbanUser={handleUnbanUser} />
          </div>
        )}

        {/* TAB 3: SETTINGS */}
        {activeTab === 'settings' && (
          <div className="flex-1 p-6 overflow-y-auto max-w-4xl mx-auto w-full bg-slate-50">
            <SettingsPanel />
          </div>
        )}

        {/* TAB 4: OBS OVERLAYS GUIDE */}
        {activeTab === 'obs' && (
          <div className="flex-1 p-6 overflow-y-auto max-w-4xl mx-auto w-full space-y-4 bg-slate-50">
            <div>
              <div className="flex items-center gap-2.5">
                <div className="p-2 rounded-md bg-black/[0.04] border border-black/[0.08] text-[#0067C0]">
                  <Tv className="w-5 h-5" />
                </div>
                <div>
                  <h2 className="text-base font-semibold text-slate-900">
                    OBS Studio browser sources
                  </h2>
                  <p className="text-xs text-slate-500 mt-0.5">
                    Add these transparent URLs to OBS Studio as Browser Sources to display live TTS popups and chat history on stream.
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3">
              {/* Card 1: 9:16 Full Broadcast Overlay (/overlay) */}
              <div className="p-4 rounded-lg bg-white border border-black/[0.08] hover:border-[#0067C0]/40 transition-colors shadow-[0_1px_2px_rgba(0,0,0,0.02)] flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="space-y-1.5 flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-slate-900 text-xs">9:16 full broadcast overlay</span>
                    <span className="px-1.5 py-0.5 rounded-[3px] bg-[#0067C0]/10 text-[#0067C0] border border-[#0067C0]/20 text-[10px] font-mono">
                      1080 × 1920
                    </span>
                    <span className="px-1.5 py-0.5 rounded-[3px] bg-black/[0.04] text-slate-700 border border-black/[0.08] text-[10px] font-normal">
                      All-in-one layout
                    </span>
                  </div>
                  <p className="text-xs text-slate-600">
                    Complete vertical broadcast scene (1080×1920) combining speaking spotlight popup card above dynamic scrolling chat history in a single transparent browser source.
                  </p>
                  <code className="text-xs font-mono text-[#0067C0] block bg-[#F8F9FA] px-2.5 py-1.5 rounded-[4px] border border-black/[0.06] break-all select-all">
                    {`${baseUrl}/overlay`}
                  </code>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <a
                    href={`${baseUrl}/overlay`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1.5 h-7.5 w-7.5 rounded-[4px] bg-[#FBFBFB] hover:bg-[#F0F0F0] text-slate-700 border border-black/[0.08] flex items-center justify-center transition-colors focus-visible:ring-2 focus-visible:ring-[#0067C0] focus-visible:outline-none"
                    title="Preview in browser tab"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>

                  <button
                    onClick={() => copyToClipboard(`${baseUrl}/overlay`, 'overlay', 'Full broadcast overlay')}
                    className={`flex items-center gap-1.5 h-7.5 px-3 rounded-[4px] text-xs font-medium transition-colors shadow-2xs cursor-pointer focus-visible:ring-2 focus-visible:ring-[#0067C0] focus-visible:outline-none ${
                      copiedKey === 'overlay'
                        ? 'bg-emerald-600 text-white'
                        : 'bg-[#0067C0] hover:bg-[#1879CD] text-white'
                    }`}
                  >
                    {copiedKey === 'overlay' ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-200" />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy URL</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Card 2: Speaking Spotlight Only (/popup) */}
              <div className="p-4 rounded-lg bg-white border border-black/[0.08] hover:border-[#0067C0]/40 transition-colors shadow-[0_1px_2px_rgba(0,0,0,0.02)] flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="space-y-1.5 flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-slate-900 text-xs">Speaking spotlight only</span>
                    <span className="px-1.5 py-0.5 rounded-[3px] bg-emerald-50 text-emerald-700 border border-emerald-200 text-[10px] font-mono">
                      Transparent popup
                    </span>
                    <span className="px-1.5 py-0.5 rounded-[3px] bg-black/[0.04] text-slate-700 border border-black/[0.08] text-[10px] font-normal">
                      Karaoke sync
                    </span>
                  </div>
                  <p className="text-xs text-slate-600">
                    Transparent popup card that appears dynamically only while someone is speaking, with pulsing avatar border and word-by-word highlighted karaoke text.
                  </p>
                  <code className="text-xs font-mono text-[#0067C0] block bg-[#F8F9FA] px-2.5 py-1.5 rounded-[4px] border border-black/[0.06] break-all select-all">
                    {`${baseUrl}/popup`}
                  </code>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <a
                    href={`${baseUrl}/popup`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1.5 h-7.5 w-7.5 rounded-[4px] bg-[#FBFBFB] hover:bg-[#F0F0F0] text-slate-700 border border-black/[0.08] flex items-center justify-center transition-colors focus-visible:ring-2 focus-visible:ring-[#0067C0] focus-visible:outline-none"
                    title="Preview in browser tab"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>

                  <button
                    onClick={() => copyToClipboard(`${baseUrl}/popup`, 'popup', 'Speaking spotlight')}
                    className={`flex items-center gap-1.5 h-7.5 px-3 rounded-[4px] text-xs font-medium transition-colors shadow-2xs cursor-pointer focus-visible:ring-2 focus-visible:ring-[#0067C0] focus-visible:outline-none ${
                      copiedKey === 'popup'
                        ? 'bg-emerald-600 text-white'
                        : 'bg-[#0067C0] hover:bg-[#1879CD] text-white'
                    }`}
                  >
                    {copiedKey === 'popup' ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-200" />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy URL</span>
                      </>
                    )}
                  </button>
                </div>
              </div>

              {/* Card 3: Live Chat Stream Only (/chat) */}
              <div className="p-4 rounded-lg bg-white border border-black/[0.08] hover:border-[#0067C0]/40 transition-colors shadow-[0_1px_2px_rgba(0,0,0,0.02)] flex flex-col md:flex-row md:items-center justify-between gap-4">
                <div className="space-y-1.5 flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="font-semibold text-slate-900 text-xs">Live chat stream only</span>
                    <span className="px-1.5 py-0.5 rounded-[3px] bg-black/[0.04] text-slate-700 border border-black/[0.08] text-[10px] font-mono">
                      Transparent chat
                    </span>
                    <span className="px-1.5 py-0.5 rounded-[3px] bg-black/[0.04] text-slate-700 border border-black/[0.08] text-[10px] font-normal">
                      Auto-scrolling
                    </span>
                  </div>
                  <p className="text-xs text-slate-600">
                    Transparent scrolling chat history feed. Automatically resizes to fit any width/height container and auto-scrolls down when new messages arrive.
                  </p>
                  <code className="text-xs font-mono text-[#0067C0] block bg-[#F8F9FA] px-2.5 py-1.5 rounded-[4px] border border-black/[0.06] break-all select-all">
                    {`${baseUrl}/chat`}
                  </code>
                </div>

                <div className="flex items-center gap-1.5 shrink-0">
                  <a
                    href={`${baseUrl}/chat`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="p-1.5 h-7.5 w-7.5 rounded-[4px] bg-[#FBFBFB] hover:bg-[#F0F0F0] text-slate-700 border border-black/[0.08] flex items-center justify-center transition-colors focus-visible:ring-2 focus-visible:ring-[#0067C0] focus-visible:outline-none"
                    title="Preview in browser tab"
                  >
                    <ExternalLink className="w-3.5 h-3.5" />
                  </a>

                  <button
                    onClick={() => copyToClipboard(`${baseUrl}/chat`, 'chat', 'Live chat stream')}
                    className={`flex items-center gap-1.5 h-7.5 px-3 rounded-[4px] text-xs font-medium transition-colors shadow-2xs cursor-pointer focus-visible:ring-2 focus-visible:ring-[#0067C0] focus-visible:outline-none ${
                      copiedKey === 'chat'
                        ? 'bg-emerald-600 text-white'
                        : 'bg-[#0067C0] hover:bg-[#1879CD] text-white'
                    }`}
                  >
                    {copiedKey === 'chat' ? (
                      <>
                        <Check className="w-3.5 h-3.5 text-emerald-200" />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" />
                        <span>Copy URL</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </div>

            {/* OBS Browser Source Configuration Setup Guide */}
            <div className="p-4 rounded-lg bg-white border border-black/[0.08] text-xs text-slate-600 space-y-2.5 shadow-[0_1px_2px_rgba(0,0,0,0.02)]">
              <div className="font-semibold text-slate-900 text-xs flex items-center gap-1.5">
                <AlertTriangle className="w-4 h-4 text-amber-500" />
                OBS Studio browser source setup guide
              </div>
              <ol className="list-decimal pl-5 space-y-1 text-slate-700 text-xs">
                <li>In OBS Studio, click the <strong className="text-slate-900">+</strong> button in the <strong>Sources</strong> dock and choose <strong>Browser</strong>.</li>
                <li>Give the source a clear name (e.g. <span className="text-[#0067C0] font-mono">BABA Vertical Overlay</span>) and click OK.</li>
                <li>Paste the copied URL into the <strong>URL</strong> field.</li>
                <li>Set the recommended canvas resolution (e.g., <strong>Width: 1080</strong>, <strong>Height: 1920</strong> for Full broadcast overlay).</li>
                <li>Check <strong className="text-slate-900">"Shutdown source when not visible"</strong> to minimize stream GPU/CPU overhead.</li>
                <li>Leave <strong className="text-slate-900">"Control audio via OBS" unchecked</strong> — BABA TTS Desktop App plays audio natively via Windows audio output to eliminate latency and avoid double-audio echo.</li>
              </ol>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
