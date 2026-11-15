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
  Send,
  Sparkles,
  Copy,
  Check,
  MessageSquare,
  ExternalLink,
  ChevronDown,
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
  const { messages } = useStore();
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

  const queuedMessageCount = messages.filter((m) => m.status === 'queued').length;

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

      {/* App header */}
      <header className="w-full min-h-14 bg-[#FAFBFD] border-b border-black/[0.08] px-3 sm:px-4 py-2 flex flex-wrap items-center gap-x-4 gap-y-2 shrink-0 z-40 select-none">
        <div className="flex items-center gap-3 shrink-0">
          <div className="flex items-center gap-1.5">
            <Volume2 className="w-4 h-4 text-[#0067C0] shrink-0" aria-hidden="true" />
            <span className="text-sm font-semibold text-slate-900 tracking-tight">BABA TTS</span>
          </div>
          <div
            role="status"
            aria-live="polite"
            className={`flex items-center gap-1.5 text-xs ${isConnected ? 'text-emerald-700' : 'text-amber-700'}`}
            title={isConnected ? 'Connected to the local BABA TTS server' : 'Connecting to the local BABA TTS server'}
          >
            <span className={`w-2 h-2 rounded-full ${isConnected ? 'bg-emerald-500' : 'bg-amber-500 animate-pulse'}`} />
            <span>{isConnected ? 'Connected' : 'Connecting'}</span>
          </div>
          {queuedMessageCount > 0 && (
            <span
              className="px-2 py-1 rounded-full bg-[#E8F2FC] text-[#005A9E] text-xs font-medium"
              aria-label={`${queuedMessageCount} messages in the queue`}
            >
              {queuedMessageCount} queued
            </span>
          )}
        </div>

        <nav
          role="tablist"
          aria-label="Application sections"
          className="flex items-center gap-1 order-last w-full lg:order-none lg:w-auto lg:flex-1 lg:justify-center border-t border-slate-200/70 pt-1 lg:border-0 lg:pt-0"
        >
          {[
            { id: 'monitor' as const, label: 'Live monitor', icon: LayoutDashboard },
            { id: 'moderation' as const, label: 'Moderation', icon: ShieldAlert },
            { id: 'settings' as const, label: 'Settings', icon: Sliders },
            { id: 'obs' as const, label: 'OBS setup', icon: Tv },
          ].map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                role="tab"
                aria-selected={isActive}
                onClick={() => setActiveTab(tab.id)}
                className={`relative min-h-9 px-2.5 sm:px-3 flex items-center gap-1.5 text-xs font-medium transition-colors cursor-pointer rounded-md focus-visible:ring-2 focus-visible:ring-[#0067C0] focus-visible:outline-none ${
                  isActive
                    ? 'text-slate-900 bg-[#E8F2FC] font-semibold'
                    : 'text-slate-600 hover:text-slate-900 hover:bg-black/[0.04]'
                }`}
                title={tab.label}
              >
                <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-[#0067C0]' : 'text-slate-500'}`} aria-hidden="true" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </nav>

        {(activeTab === 'monitor' || activeTab === 'moderation') && (
          <div className="flex items-center gap-1.5 shrink-0 border-l border-slate-200 pl-3 ml-auto">
            <button
              onClick={handleSkipCurrent}
              disabled={!activeMessage}
              className="min-h-9 px-3 flex items-center gap-1.5 rounded-md bg-white hover:bg-amber-50 active:bg-amber-100 border border-amber-200 text-xs font-medium text-amber-800 transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-45 focus-visible:ring-2 focus-visible:ring-[#0067C0] focus-visible:outline-none"
              aria-label="Skip the current message"
            >
              <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Skip</span>
            </button>

            <button
              onClick={handleBanCurrent}
              disabled={!activeMessage}
              className="min-h-9 px-3 flex items-center gap-1.5 rounded-md bg-white hover:bg-rose-50 active:bg-rose-100 border border-rose-200 text-xs font-medium text-rose-800 transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-45 focus-visible:ring-2 focus-visible:ring-[#0067C0] focus-visible:outline-none"
              aria-label="Ban and skip the current speaker"
            >
              <ShieldAlert className="w-3.5 h-3.5" aria-hidden="true" />
              <span>Ban &amp; skip</span>
            </button>

            <button
              onClick={handleClearQueue}
              disabled={queuedMessageCount === 0}
              className="min-h-9 px-3 flex items-center gap-1.5 rounded-md bg-white hover:bg-slate-100 active:bg-slate-200 border border-slate-200 text-xs font-medium text-slate-700 transition-colors cursor-pointer disabled:cursor-not-allowed disabled:opacity-45 focus-visible:ring-2 focus-visible:ring-[#0067C0] focus-visible:outline-none"
              aria-label="Clear the TTS queue"
            >
              <Trash2 className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
              <span>Clear queue</span>
            </button>
          </div>
        )}
      </header>

      {/* Main Tab Views */}
      <main className="flex-1 overflow-hidden flex flex-col min-h-0 bg-slate-50">
        {/* TAB 1: LIVE MONITOR & CHAT */}
        {activeTab === 'monitor' && (
          <div className="flex-1 flex flex-col md:flex-row min-h-0 overflow-hidden">
            {/* Left Column: Currently Speaking Spotlight & Manual Speech Controls */}
            <div className="w-full md:w-[360px] lg:w-[400px] max-h-[46vh] md:max-h-none flex flex-col gap-4 p-4 border-b md:border-b-0 md:border-r border-slate-200 bg-white overflow-y-auto shrink-0">
              {/* CURRENTLY SPEAKING CARD */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-semibold text-slate-800 flex items-center gap-1.5">
                    <Volume2 className="w-3.5 h-3.5 text-[#0067C0]" />
                    Now speaking
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
                  <div className="min-h-24 px-4 py-5 rounded-lg bg-white border border-dashed border-slate-300 flex flex-col items-center justify-center text-center gap-1.5 text-slate-500">
                    <Volume2 className="w-4 h-4 text-slate-400" aria-hidden="true" />
                    <div className="text-xs font-medium text-slate-700">Nothing is speaking</div>
                    <div className="text-[11px] text-slate-500">New messages will appear here.</div>
                  </div>
                )}
              </div>

              {/* Manual speech and pre-stream tools */}
              <div className="flex flex-col gap-3 pt-4 border-t border-slate-200 mt-auto">
                <div className="flex items-center justify-between">
                  <label htmlFor="manual-speech" className="text-sm font-semibold text-slate-800 flex items-center gap-1.5">
                    <Send className="w-4 h-4 text-[#0067C0]" aria-hidden="true" />
                    Speak a message
                  </label>
                </div>

                <div className="flex flex-col gap-2">
                  <div className="flex gap-1.5">
                    <input
                      id="manual-speech"
                      type="text"
                      value={manualText}
                      onChange={(e) => setManualText(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') {
                          e.preventDefault();
                          handleManualSpeakBaba();
                        }
                      }}
                      placeholder="Type a message..."
                      className="flex-1 min-w-0 min-h-10 px-3 rounded-md bg-white border border-slate-300 focus:border-[#0067C0] focus-visible:ring-2 focus-visible:ring-[#0067C0] focus-visible:outline-none text-sm text-slate-900 placeholder-slate-400 transition-colors"
                    />
                    <button
                      onClick={handleManualSpeakBaba}
                      className="min-h-10 px-3 rounded-md bg-[#0067C0] hover:bg-[#1879CD] text-white text-sm font-medium transition-colors shrink-0 flex items-center gap-1.5 cursor-pointer focus-visible:ring-2 focus-visible:ring-[#0067C0] focus-visible:outline-none"
                    >
                      <Volume2 className="w-3.5 h-3.5" />
                      <span>Speak</span>
                    </button>
                  </div>

                </div>

                <details className="group rounded-md border border-slate-200 bg-slate-50 px-3 py-2">
                  <summary className="flex min-h-8 cursor-pointer list-none items-center justify-between gap-3 text-xs font-medium text-slate-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#0067C0] [&::-webkit-details-marker]:hidden">
                    <span className="flex items-center gap-2">
                      <Sparkles className="w-3.5 h-3.5 text-slate-500" aria-hidden="true" />
                      Soundcheck &amp; simulation
                    </span>
                    <ChevronDown className="w-3.5 h-3.5 transition-transform group-open:rotate-180" aria-hidden="true" />
                  </summary>
                  <div className="flex flex-wrap gap-2 pt-2">
                    <button
                      onClick={handleSpeakAsBanned}
                      className="min-h-9 px-3 rounded-md border border-slate-300 bg-white hover:bg-slate-100 text-xs font-medium text-slate-700 transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-[#0067C0] focus-visible:outline-none"
                    >
                      Speak as banned user
                    </button>
                    <button
                      onClick={simulateGoodMessage}
                      className="min-h-9 px-3 rounded-md border border-slate-300 bg-white hover:bg-slate-100 text-xs font-medium text-slate-700 transition-colors cursor-pointer focus-visible:ring-2 focus-visible:ring-[#0067C0] focus-visible:outline-none"
                    >
                      Simulate chat
                    </button>
                  </div>
                </details>
              </div>
            </div>

            {/* Right Column: Live Chat History Feed */}
            <div className="flex-1 flex flex-col p-4 sm:p-5 overflow-hidden min-h-0 bg-slate-50">
              <div className="flex items-center justify-between pb-2.5 border-b border-black/[0.08] mb-3">
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-[#0067C0]" />
                  <span className="text-sm font-semibold text-slate-800">Live chat</span>
                  <span className="text-xs text-slate-500">{messages.length}</span>
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
            <SettingsPanel onRestart={handleRestart} serverPort={port} />
          </div>
        )}

        {/* TAB 4: OBS OVERLAYS GUIDE */}
        {activeTab === 'obs' && (
          <div className="flex-1 p-6 overflow-y-auto max-w-4xl mx-auto w-full space-y-4 bg-slate-50">
            <div className="flex items-center gap-2.5">
              <div className="p-2 rounded-md bg-black/[0.04] border border-black/[0.08] text-[#0067C0]">
                <Tv className="w-5 h-5" aria-hidden="true" />
              </div>
              <div>
                <h2 className="text-base font-semibold text-slate-900">OBS browser source</h2>
                <p className="text-xs text-slate-600 mt-0.5">Add the speaking overlay to your stream.</p>
              </div>
            </div>

            <section aria-labelledby="speaking-overlay-heading" className="p-4 rounded-lg bg-white border border-[#0067C0]/25 shadow-[0_1px_2px_rgba(0,0,0,0.02)] space-y-3">
              <div>
                <h3 id="speaking-overlay-heading" className="text-sm font-semibold text-slate-900">TTS speaking overlay</h3>
                <p className="text-xs text-slate-600 mt-1">Shows the speaker and synchronized text while BABA TTS is talking.</p>
              </div>

              <div className="flex flex-col sm:flex-row sm:items-center gap-2">
                <code className="min-w-0 flex-1 text-xs font-mono text-[#0067C0] bg-[#F8F9FA] px-2.5 py-2 rounded-[4px] border border-black/[0.06] break-all select-all">
                  {baseUrl + '/popup'}
                </code>
                <div className="flex items-center gap-3 shrink-0">
                  <a
                    href={baseUrl + '/popup'}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Preview TTS speaking overlay in a browser tab"
                    className="inline-flex items-center gap-1 text-xs font-medium text-slate-700 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-[#0067C0] focus-visible:outline-none rounded"
                  >
                    <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                    Preview
                  </a>
                  <button
                    onClick={() => copyToClipboard(baseUrl + '/popup', 'popup', 'Speaking overlay')}
                    className={copiedKey === 'popup' ? 'inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-[4px] text-xs font-medium transition-colors shadow-2xs cursor-pointer focus-visible:ring-2 focus-visible:ring-[#0067C0] focus-visible:outline-none bg-emerald-600 text-white' : 'inline-flex items-center justify-center gap-1.5 h-8 px-3 rounded-[4px] text-xs font-medium transition-colors shadow-2xs cursor-pointer focus-visible:ring-2 focus-visible:ring-[#0067C0] focus-visible:outline-none bg-[#0067C0] hover:bg-[#1879CD] text-white'}
                  >
                    {copiedKey === 'popup' ? (
                      <>
                        <Check className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Copied</span>
                      </>
                    ) : (
                      <>
                        <Copy className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>Copy URL</span>
                      </>
                    )}
                  </button>
                </div>
              </div>
            </section>

            <section aria-labelledby="obs-setup-heading" className="p-4 rounded-lg bg-white border border-black/[0.08] space-y-3">
              <h3 id="obs-setup-heading" className="text-sm font-semibold text-slate-900">Add it to OBS</h3>
              <ol className="list-decimal pl-5 space-y-1.5 text-xs text-slate-700">
                <li>In the OBS Sources dock, choose <strong>+</strong> → <strong>Browser</strong>.</li>
                <li>Paste the URL. At 800 px wide, set the Browser Source height to at least <strong>900 px</strong>; use more for longer messages.</li>
              </ol>
              <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2.5 text-xs text-amber-950">
                <Volume2 className="w-4 h-4 mt-0.5 shrink-0 text-amber-700" aria-hidden="true" />
                <p><strong>Audio setting:</strong> Leave “Control audio via OBS” unchecked. BABA TTS plays audio through the desktop app.</p>
              </div>
              <p className="text-[11px] text-slate-600">
                Optional: Enable “Shutdown source when not visible” in OBS to reduce resource use.
              </p>
            </section>

            <details className="group rounded-lg border border-black/[0.08] bg-white">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-xs font-medium text-slate-800 rounded-lg focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#0067C0] focus-visible:outline-none">
                <span>Other sources</span>
                <ChevronDown className="w-4 h-4 text-slate-500 transition-transform group-open:rotate-180" aria-hidden="true" />
              </summary>
              <div className="divide-y divide-black/[0.06] border-t border-black/[0.06] px-4">
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-slate-800">Full vertical overlay</p>
                    <p className="text-[11px] text-slate-600">Speaking overlay and chat history · 1080 × 1920</p>
                  </div>
                  <code className="min-w-0 flex-1 text-[11px] font-mono text-slate-700 break-all select-all">{baseUrl + '/overlay'}</code>
                  <div className="flex items-center gap-3 shrink-0">
                    <a href={baseUrl + '/overlay'} target="_blank" rel="noopener noreferrer" aria-label="Preview full vertical overlay in a browser tab" className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-700 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-[#0067C0] focus-visible:outline-none rounded">
                      <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" /> Preview
                    </a>
                    <button onClick={() => copyToClipboard(baseUrl + '/overlay', 'overlay', 'Full vertical overlay')} className="inline-flex items-center gap-1 h-7 px-2.5 rounded-[4px] border border-black/[0.12] bg-white hover:bg-slate-50 text-[11px] font-medium text-slate-700 cursor-pointer focus-visible:ring-2 focus-visible:ring-[#0067C0] focus-visible:outline-none">
                      {copiedKey === 'overlay' ? <Check className="w-3 h-3" aria-hidden="true" /> : <Copy className="w-3 h-3" aria-hidden="true" />}
                      {copiedKey === 'overlay' ? 'Copied' : 'Copy URL'}
                    </button>
                  </div>
                </div>
                <div className="flex flex-col sm:flex-row sm:items-center gap-2 py-3">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-slate-800">Chat only</p>
                    <p className="text-[11px] text-slate-600">Transparent, auto-scrolling chat history</p>
                  </div>
                  <code className="min-w-0 flex-1 text-[11px] font-mono text-slate-700 break-all select-all">{baseUrl + '/chat'}</code>
                  <div className="flex items-center gap-3 shrink-0">
                    <a href={baseUrl + '/chat'} target="_blank" rel="noopener noreferrer" aria-label="Preview chat-only source in a browser tab" className="inline-flex items-center gap-1 text-[11px] font-medium text-slate-700 hover:text-slate-900 focus-visible:ring-2 focus-visible:ring-[#0067C0] focus-visible:outline-none rounded">
                      <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" /> Preview
                    </a>
                    <button onClick={() => copyToClipboard(baseUrl + '/chat', 'chat', 'Chat-only source')} className="inline-flex items-center gap-1 h-7 px-2.5 rounded-[4px] border border-black/[0.12] bg-white hover:bg-slate-50 text-[11px] font-medium text-slate-700 cursor-pointer focus-visible:ring-2 focus-visible:ring-[#0067C0] focus-visible:outline-none">
                      {copiedKey === 'chat' ? <Check className="w-3 h-3" aria-hidden="true" /> : <Copy className="w-3 h-3" aria-hidden="true" />}
                      {copiedKey === 'chat' ? 'Copied' : 'Copy URL'}
                    </button>
                  </div>
                </div>
              </div>
            </details>
          </div>
        )}
      </main>
    </div>
  );
}
