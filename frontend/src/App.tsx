import { useEffect, useRef, useState, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Volume2,
  ShieldAlert,
  RotateCcw,
  Trash2,
  Sparkles,
  Copy,
  Check,
  MessageSquare,
  ExternalLink,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import ChatMessage from './components/ChatMessage';
import ModerationPanel from './components/ModerationPanel';
import SettingsPanel from './components/SettingsPanel';
import HelpPanel from './components/HelpPanel';
import ChatPage from './ChatPage';
import PopupPage from './PopupPage';
import OverlayPage from './OverlayPage';
import { useStore } from './store';
import { getDeterministicColor } from '../../src/shared/colors';
import { useAppWebSocket } from './hooks/useAppWebSocket';

type DesktopTab = 'monitor' | 'moderation' | 'settings' | 'obs' | 'help';

const desktopTabs = [
  { id: 'monitor', label: 'Live monitor' },
  { id: 'moderation', label: 'Moderation' },
  { id: 'settings', label: 'Settings' },
  { id: 'obs', label: 'OBS setup' },
  { id: 'help', label: 'Help' },
] as const;

export default function App() {
  const [searchParams] = useSearchParams();
  const overlayMode = searchParams.get('overlay');

  // Support direct query param bypass for OBS Browser Sources:
  // e.g. http://127.0.0.1:7060/?overlay=popup or ?overlay=chat or ?overlay=full
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
  const navRef = useRef<HTMLElement>(null);

  const [activeTab, setActiveTab] = useState<DesktopTab>('monitor');
  const [navScrollState, setNavScrollState] = useState({ left: false, right: false });
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
  const currentTab = desktopTabs.find((tab) => tab.id === activeTab)!;

  const updateNavScrollState = useCallback(() => {
    const nav = navRef.current;
    if (!nav) return;
    const nextState = {
      left: nav.scrollLeft > 1,
      right: nav.scrollLeft + nav.clientWidth < nav.scrollWidth - 1,
    };
    setNavScrollState((previous) =>
      previous.left === nextState.left && previous.right === nextState.right ? previous : nextState,
    );
  }, []);

  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;

    const resizeObserver = new ResizeObserver(updateNavScrollState);
    resizeObserver.observe(nav);
    updateNavScrollState();
    return () => resizeObserver.disconnect();
  }, [activeTab, updateNavScrollState]);

  return (
    <div className="desktop-shell flex h-dvh w-full flex-col overflow-hidden">
      <header className="z-40 grid h-9 shrink-0 grid-cols-[minmax(0,1fr)_auto] select-none items-center border-b border-[#BDBDBD] bg-[#F3F3F3] px-1">
        <div className="relative flex h-full min-w-0 items-center">
          <nav
            ref={navRef}
            aria-label="Application sections"
            onScroll={updateNavScrollState}
            className="scrollbar-none flex h-full min-w-0 flex-1 items-end gap-0 overflow-x-auto px-1"
          >
            {desktopTabs.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  aria-current={isActive ? 'page' : undefined}
                  onClick={() => setActiveTab(tab.id)}
                  className={`relative flex h-8 shrink-0 cursor-pointer items-center border-x border-t px-2.5 text-xs transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[#555] ${
                    isActive
                      ? 'z-10 border-[#BDBDBD] border-b-[#F3F3F3] bg-[#F3F3F3] font-semibold text-[#222]'
                      : 'border-transparent border-b-[#BDBDBD] text-[#555] hover:border-[#D0D0D0] hover:bg-white hover:text-[#222]'
                  }`}
                >
                  <span>{tab.label}</span>
                </button>
              );
            })}
          </nav>
          {navScrollState.left && (
            <button
              type="button"
              onClick={() => navRef.current?.scrollBy({ left: -180 })}
              aria-label="Show previous application sections"
              title="Show previous sections"
            className="absolute inset-y-0 left-0 z-10 flex w-6 items-center justify-center border-r border-[#BDBDBD] bg-[#F3F3F3] text-[#555] hover:bg-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[#555]"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
          {navScrollState.right && (
            <button
              type="button"
              onClick={() => navRef.current?.scrollBy({ left: 180 })}
              aria-label="Show more application sections"
              title="Show more sections"
            className="absolute inset-y-0 right-0 z-10 flex w-6 items-center justify-center border-l border-[#BDBDBD] bg-[#F3F3F3] text-[#555] hover:bg-white focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[#555]"
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
        </div>

        {(activeTab === 'monitor' || activeTab === 'moderation') && (
          <div className="flex shrink-0 items-center gap-1 border-l border-[#BDBDBD] pl-1.5">
                <button
                  onClick={handleSkipCurrent}
                  disabled={!activeMessage}
                  className="flex h-6 items-center gap-1 border border-[#C8C8C8] bg-white px-1.5 text-[11px] font-medium text-[#333] transition-colors hover:bg-[#F1F1F1] active:bg-[#E7E7E7] disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#555] max-lg:px-1.5"
                  aria-label="Skip the current message"
                  title="Skip the current message"
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="max-lg:hidden">Skip</span>
                </button>

                <button
                  onClick={handleBanCurrent}
                  disabled={!activeMessage}
                  className="flex h-6 items-center gap-1 border border-[#A4262C]/30 bg-white px-1.5 text-[11px] font-medium text-[#8A1F24] transition-colors hover:bg-[#FFF8F8] active:bg-[#F9E7E7] disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#555] max-lg:px-1.5"
                  aria-label="Ban and skip the current speaker"
                  title="Ban and skip the current speaker"
                >
                  <ShieldAlert className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="max-lg:hidden">Ban &amp; skip</span>
                </button>

                <button
                  onClick={handleClearQueue}
                  disabled={queuedMessageCount === 0}
                  className="flex h-6 items-center gap-1 border border-[#C8C8C8] bg-white px-1.5 text-[11px] font-medium text-[#333] transition-colors hover:bg-[#F1F1F1] active:bg-[#E7E7E7] disabled:cursor-not-allowed disabled:opacity-45 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#555] max-lg:px-1.5"
                  aria-label="Clear the TTS queue"
                  title="Clear the TTS queue"
                >
                  <Trash2 className="h-3.5 w-3.5" aria-hidden="true" />
                  <span className="max-lg:hidden">Clear queue</span>
                </button>
          </div>
        )}
      </header>

      {/* Main Tab Views */}
      <main id="app-main-content" className="desktop-shell flex min-h-0 flex-1 flex-col overflow-hidden">
        <h1 className="sr-only">{currentTab.label}</h1>
        {/* TAB 1: LIVE MONITOR & CHAT */}
        {activeTab === 'monitor' && (
          <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-hidden p-2 lg:flex-row">
            <div className="flex max-h-[46vh] w-full shrink-0 flex-col gap-2 overflow-y-auto lg:max-h-none lg:w-[340px]">
              <fieldset className="desktop-groupbox">
                <legend className="desktop-groupbox-legend">Now speaking</legend>
                {activeMessage ? (
                  <ChatMessage message={activeMessage} currentAudioTime={currentAudioTime} hideHistory variant="inline" />
                ) : (
                  <div className="flex min-h-16 items-center gap-2 text-xs text-[#666]">
                    <Volume2 className="h-4 w-4 text-[#777]" aria-hidden="true" />
                    <span>Nothing is speaking. New messages will appear here.</span>
                  </div>
                )}
              </fieldset>

              <fieldset className="desktop-groupbox">
                <legend className="desktop-groupbox-legend">Quick speech</legend>
                <label htmlFor="manual-speech" className="sr-only">Message to speak as BABA</label>
                <div className="flex gap-1.5">
                  <input
                    id="manual-speech"
                    type="text"
                    value={manualText}
                    onChange={(event) => setManualText(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') {
                        event.preventDefault();
                        handleManualSpeakBaba();
                      }
                    }}
                    placeholder="Type a message…"
                    className="h-7 min-w-0 flex-1 border border-[#BDBDBD] bg-white px-2 text-xs text-[#222] placeholder:text-[#777] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#555]"
                  />
                  <button onClick={handleManualSpeakBaba} className="h-7 shrink-0 border border-[#333] bg-[#333] px-2.5 text-xs font-medium text-white hover:bg-[#222] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#555]">
                    <span className="flex items-center gap-1"><Volume2 className="h-3 w-3" aria-hidden="true" />Speak</span>
                  </button>
                </div>
                <details className="group mt-2 border-t border-[#E0E0E0] pt-1">
                  <summary className="flex h-7 cursor-pointer list-none items-center justify-between text-xs font-medium text-[#444] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#555] [&::-webkit-details-marker]:hidden">
                    <span className="flex items-center gap-1.5"><Sparkles className="h-3 w-3 text-[#666]" aria-hidden="true" />Soundcheck and simulation</span>
                    <ChevronDown className="h-3 w-3 transition-transform group-open:rotate-180" aria-hidden="true" />
                  </summary>
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    <button onClick={handleSpeakAsBanned} className="h-7 border border-[#C8C8C8] bg-white px-2 text-[11px] hover:bg-[#F1F1F1] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#555]">Speak as banned user</button>
                    <button onClick={simulateGoodMessage} className="h-7 border border-[#C8C8C8] bg-white px-2 text-[11px] hover:bg-[#F1F1F1] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#555]">Simulate chat</button>
                  </div>
                </details>
              </fieldset>
            </div>

            <fieldset className="desktop-groupbox flex min-h-0 flex-1 flex-col overflow-hidden">
              <legend className="desktop-groupbox-legend">Live chat · {messages.length}</legend>
              <div className="min-h-0 flex-1 overflow-y-auto">
                {messages.length === 0 ? (
                  <div className="flex h-full min-h-24 items-center justify-center gap-2 text-center text-xs text-[#666]">
                    <MessageSquare className="h-4 w-4 text-[#777]" aria-hidden="true" />
                    No chat messages yet.
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
            </fieldset>
          </div>
        )}

        {/* TAB 2: MODERATION */}
        {activeTab === 'moderation' && (
          <div className="desktop-shell flex min-h-0 flex-1 flex-col overflow-hidden p-2">
            <ModerationPanel onBanUser={handleBanUser} onUnbanUser={handleUnbanUser} />
          </div>
        )}

        {/* TAB 3: SETTINGS */}
        {activeTab === 'settings' && (
          <div className="desktop-shell flex w-full flex-1 overflow-y-auto">
            <SettingsPanel onRestart={handleRestart} serverPort={port} />
          </div>
        )}

        {/* TAB 4: OBS OVERLAYS GUIDE */}
        {activeTab === 'obs' && (
          <div className="desktop-shell flex w-full flex-1 flex-col gap-2 overflow-y-auto p-2">
            <section aria-labelledby="speaking-overlay-heading" className="desktop-groupbox space-y-1.5">
              <div>
                <h3 id="speaking-overlay-heading" className="text-xs font-semibold text-[#222]">TTS speaking overlay</h3>
                <p className="desktop-help-text">Shows the speaker and synchronized text while BABA TTS is talking.</p>
              </div>

              <div className="flex flex-col gap-1.5 sm:flex-row sm:items-center">
                <code className="min-w-0 flex-1 border border-[#D0D0D0] bg-[#F7F7F7] px-2 py-1 font-mono text-[11px] text-[#333] break-all select-all">
                  {baseUrl + '/popup'}
                </code>
                <div className="flex items-center gap-3 shrink-0">
                  <a
                    href={baseUrl + '/popup'}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label="Preview TTS speaking overlay in a browser tab"
                    className="inline-flex h-7 items-center gap-1 border border-[#C8C8C8] bg-white px-2 text-[11px] font-medium text-[#333] hover:bg-[#F1F1F1] focus-visible:ring-1 focus-visible:ring-[#555] focus-visible:outline-none"
                  >
                    <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" />
                    Preview
                  </a>
                    <button
                    onClick={() => copyToClipboard(baseUrl + '/popup', 'popup', 'Speaking overlay')}
                    className="inline-flex h-7 items-center justify-center gap-1 border border-[#C8C8C8] bg-white px-2 text-[11px] font-medium text-[#333] hover:bg-[#F1F1F1] focus-visible:ring-1 focus-visible:ring-[#555] focus-visible:outline-none"
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

            <section aria-labelledby="obs-setup-heading" className="desktop-groupbox space-y-1.5">
              <h3 id="obs-setup-heading" className="text-xs font-semibold text-[#222]">Add it to OBS</h3>
              <ol className="list-decimal space-y-1 pl-5 text-xs text-[#444]">
                <li>In the OBS Sources dock, choose <strong>+</strong> → <strong>Browser</strong>.</li>
                <li>Paste the URL. At 800 px wide, set the Browser Source height to at least <strong>900 px</strong>; use more for longer messages.</li>
              </ol>
              <div className="flex items-start gap-2 border border-[#D6C28C] bg-[#FFF9E8] px-2 py-1.5 text-xs text-[#4A3B16]">
                <Volume2 className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[#6A531E]" aria-hidden="true" />
                <p><strong>Audio setting:</strong> Leave “Control audio via OBS” unchecked. BABA TTS plays audio through the desktop app.</p>
              </div>
              <p className="text-[11px] text-[#555]">
                Optional: Enable “Shutdown source when not visible” in OBS to reduce resource use.
              </p>
            </section>

            <details className="group desktop-groupbox p-2">
              <summary className="flex h-7 cursor-pointer list-none items-center justify-between gap-3 text-xs font-medium text-[#333] focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[#555] focus-visible:outline-none">
                <span>Other overlay options</span>
                <ChevronDown className="h-3.5 w-3.5 text-[#555] transition-transform group-open:rotate-180" aria-hidden="true" />
              </summary>
              <div className="divide-y divide-[#E5E5E5] border-t border-[#D5D5D5]">
                <div className="flex flex-col gap-1.5 py-2 sm:flex-row sm:items-center">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-[#222]">Full vertical overlay</p>
                    <p className="text-[11px] text-[#555]">Speaking overlay and chat history · 1080 × 1920</p>
                  </div>
                  <code className="min-w-0 flex-1 break-all font-mono text-[11px] text-[#333] select-all">{baseUrl + '/overlay'}</code>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <a href={baseUrl + '/overlay'} target="_blank" rel="noopener noreferrer" aria-label="Preview full vertical overlay in a browser tab" className="inline-flex h-7 items-center gap-1 border border-[#C8C8C8] bg-white px-2 text-[11px] text-[#333] hover:bg-[#F1F1F1] focus-visible:ring-1 focus-visible:ring-[#555] focus-visible:outline-none">
                      <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" /> Preview
                    </a>
                    <button onClick={() => copyToClipboard(baseUrl + '/overlay', 'overlay', 'Full vertical overlay')} className="inline-flex h-7 items-center gap-1 border border-[#C8C8C8] bg-white px-2 text-[11px] text-[#333] hover:bg-[#F1F1F1] focus-visible:ring-1 focus-visible:ring-[#555] focus-visible:outline-none">
                      {copiedKey === 'overlay' ? <Check className="w-3 h-3" aria-hidden="true" /> : <Copy className="w-3 h-3" aria-hidden="true" />}
                      {copiedKey === 'overlay' ? 'Copied' : 'Copy URL'}
                    </button>
                  </div>
                </div>
                <div className="flex flex-col gap-1.5 py-2 sm:flex-row sm:items-center">
                  <div className="flex-1 min-w-0">
                    <p className="text-xs font-medium text-[#222]">Chat only</p>
                    <p className="text-[11px] text-[#555]">Transparent, auto-scrolling chat history</p>
                  </div>
                  <code className="min-w-0 flex-1 break-all font-mono text-[11px] text-[#333] select-all">{baseUrl + '/chat'}</code>
                  <div className="flex shrink-0 items-center gap-1.5">
                    <a href={baseUrl + '/chat'} target="_blank" rel="noopener noreferrer" aria-label="Preview chat-only source in a browser tab" className="inline-flex h-7 items-center gap-1 border border-[#C8C8C8] bg-white px-2 text-[11px] text-[#333] hover:bg-[#F1F1F1] focus-visible:ring-1 focus-visible:ring-[#555] focus-visible:outline-none">
                      <ExternalLink className="w-3.5 h-3.5" aria-hidden="true" /> Preview
                    </a>
                    <button onClick={() => copyToClipboard(baseUrl + '/chat', 'chat', 'Chat-only source')} className="inline-flex h-7 items-center gap-1 border border-[#C8C8C8] bg-white px-2 text-[11px] text-[#333] hover:bg-[#F1F1F1] focus-visible:ring-1 focus-visible:ring-[#555] focus-visible:outline-none">
                      {copiedKey === 'chat' ? <Check className="w-3 h-3" aria-hidden="true" /> : <Copy className="w-3 h-3" aria-hidden="true" />}
                      {copiedKey === 'chat' ? 'Copied' : 'Copy URL'}
                    </button>
                  </div>
                </div>
              </div>
            </details>
          </div>
        )}

        {activeTab === 'help' && (
          <div className="flex-1 overflow-y-auto p-2">
            <HelpPanel baseUrl={baseUrl} />
          </div>
        )}
      </main>
      <footer className="flex h-7 shrink-0 items-center justify-between gap-4 border-t border-[#D5D5D5] bg-[#F3F3F3] px-3 text-xs text-[#555]">
        <div role="status" aria-live="polite" className="flex min-w-0 items-center gap-2">
          <span className={`h-2 w-2 shrink-0 rounded-full ${isConnected ? 'bg-[#16824B]' : 'bg-[#B7791F]'}`} aria-hidden="true" />
          <span>{isConnected ? 'Connected' : 'Connecting'}</span>
          <span aria-hidden="true">·</span>
          <span>{queuedMessageCount} queued</span>
        </div>
        <span aria-live="polite" className="min-w-0 truncate text-right">{toast || ''}</span>
      </footer>
    </div>
  );
}
