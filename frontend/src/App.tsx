import { useEffect, useRef, useState, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { Settings, Copy, Check, ShieldAlert, Mic, Volume2 } from 'lucide-react';
import ChatMessage from './components/ChatMessage';
import ModerationPanel from './components/ModerationPanel';
import { useStore } from './store';
import { getDeterministicColor } from '../../src/shared/colors';
import { useAppWebSocket } from './hooks/useAppWebSocket';

function App() {
  const { messages, bannedUsers } = useStore();
  const { wsRef, currentAudioTime } = useAppWebSocket(true); // true means play audio
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [copiedUrl, setCopiedUrl] = useState<string | null>(null);

  const baseUrl = window.location.origin;
  const obsChatUrl = `${baseUrl}/chat`;
  const obsDockUrl = `${baseUrl}/`;

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const copyToClipboard = (text: string, label: string) => {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedUrl(label);
      setToast(`${label} copied to clipboard!`);
      setTimeout(() => setCopiedUrl(null), 2000);
      setTimeout(() => setToast(null), 3000);
    }).catch(() => {
      setToast('Failed to copy to clipboard');
      setTimeout(() => setToast(null), 3000);
    });
  };

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
    fetch('/api/speak-as-banned', { method: 'POST' })
      .then(async (r) => {
        if (r.ok) {
          const data = await r.json();
          setToast(`Speaking as banned user: ${data.user || 'User'}`);
        } else {
          setToast('No banned users found to impersonate');
        }
        setTimeout(() => setToast(null), 3000);
      })
      .catch(console.error);
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

  // Numpad keyboard shortcuts
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
      } else if (e.code === 'Numpad0' || (e.key === '0' && e.location === 3)) {
        e.preventDefault();
        handleClearQueue();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleBanCurrent, handleSpeakAsBanned, handleSkipCurrent, handleClearQueue]);

  const simulateGoodMessage = (theme: 'subtitle-sweep' | 'subtitle-karaoke' | 'subtitle-words' | 'pro-clean' = 'subtitle-karaoke') => {
    const id = `test-${Date.now()}`;
    
    const usernames = [
      'Rahul_Gaming', 'Priya123', 'CoderBhai', 'AmanOP', 'Neha_Sharma', 
      'RohanXD', 'DevNinja', 'TechGuru', 'Sneha_Codes', 'Vikram_YT',
      'DesiGamer', 'CodingWaleBhaiya', 'Anita_Designs', 'Karan_Op', 'Simran_1999',
      'NoobMaster', 'ProPlayer_99', 'IndianTechie', 'ChaiLover', 'Mumbaikar_Dev'
    ];
    const randomUser = usernames[Math.floor(Math.random() * usernames.length)];

    const phrases = [
      'Kya dosto 😄', 'क्या दोस्तों 😄', 'Hello bhai!', 'नमस्ते दोस्तों!',
      'Kya haal hai sabka?', 'दोस्तों क्या हाल है?', 'Aaj kya scene hai?',
      'आज क्या चल रहा है?', 'Nice bhai 🔥', 'बहुत बढ़िया भाई!',
      'Kahan se dekh rahe ho sab?', 'आप लोग कहाँ से देख रहे हो?',
      'Hello everyone 👋', 'सभी को नमस्ते 🙏', 'Aaj stream mast lag rahi hai',
      'आज की स्ट्रीम मज़ेदार लग रही है', 'Bhai ye kaise kiya?', 'भाई ये कैसे किया?',
      'This looks awesome!', 'यह काफी बढ़िया लग रहा है!', 'Kya dosto, sab badhiya? 😄',
      'क्या दोस्तों, सब बढ़िया? 😄', 'Main abhi join hua hu', 'मैं अभी जुड़ा हूँ',
      'Aaj ka topic interesting hai', 'आज का टॉपिक काफी दिलचस्प है',
      'Ye setup kaafi clean lag raha hai', 'ये सेटअप काफी साफ और बढ़िया लग रहा है',
      'Bro this is actually cool 😂', 'भाई ये तो गजब है 😂',
      'Chat kaafi active hai aaj 🔥', 'आज चैट काफी एक्टिव है 🔥',
      'What are we building today?', 'आज हम क्या बना रहे हैं?',
      'Bhai ek baar phir dikhao', 'भाई एक बार फिर दिखाओ',
      'Can you explain this part?', 'क्या आप ये हिस्सा समझा सकते हो?',
      'Acha ab samajh gaya', 'अच्छा अब समझ गया', 'Yeh kaafi useful hai',
      'यह काफी उपयोगी है', 'I just learned something new today',
      'मैंने आज कुछ नया सीखा', 'Kya mast workflow hai 🔥',
      'क्या शानदार तरीका है 🔥', 'Ye mujhe bhi try karna hai',
      'मुझे भी ये आज़माना है', 'This is actually much simpler than I expected',
      'यह तो उम्मीद से काफी आसान है', 'Bhai aaj full coding hone wali hai kya? 😄',
      'भाई आज पूरी कोडिंग होने वाली है क्या? 😄', 'आज कितने लोग लाइव हैं?',
      'How many people are watching right now?', 'Main chai ke saath stream dekh raha hu ☕',
      'मैं चाय के साथ स्ट्रीम देख रहा हूँ ☕', 'Aaj ka stream kaafi productive lag raha hai',
      'आज की स्ट्रीम काफी उपयोगी लग रही है', 'Hello chat, kya haal hai sabka? 👋',
      'हेलो चैट, क्या हाल है सबका? 👋', 'This is exactly the kind of thing I wanted to learn',
      'यही चीज़ मैं काफी समय से सीखना चाहता था', 'Bhai ye idea sach mein mast hai',
      'भाई ये आइडिया सच में शानदार है', 'मुझे ये तरीका काफी पसंद आया',
      'I really like this approach', 'Ye error mujhe bhi last time aaya tha 😂',
      'ये एरर मुझे भी पिछली बार आया था 😂', 'Bhai thoda slow explain karna please 😅',
      'भाई थोड़ा धीरे समझाना प्लीज़ 😅', 'Could you show that part one more time?',
      'क्या आप उस हिस्से को एक बार फिर दिखा सकते हो?', 'Aaj first time tumhari stream dekh raha hu',
      'आज पहली बार आपकी स्ट्रीम देख रहा हूँ', 'Welcome everyone, hope you are doing great!',
      'आप सभी का स्वागत है, उम्मीद है सब बढ़िया होंगे!', 'Kya zabardast stream chal rahi hai 🔥',
      'क्या ज़बरदस्त स्ट्रीम चल रही है 🔥', 'Chat mein koi aur developer bhi hai? 😂',
      'चैट में कोई और डेवलपर भी है? 😂', 'I am working on my own project while watching this stream',
      'मैं अपना प्रोजेक्ट बनाते हुए आपकी स्ट्रीम भी देख रहा हूँ',
      'Bhai ye feature kab actually use karne wale ho?',
      'भाई ये फीचर वास्तव में कब इस्तेमाल करने वाले हो?',
      'यह फीचर काफी काम का लग रहा है',
      'This feature looks really useful for real projects',
      'Kya dosto, chai pi li sabne? ☕😂',
      'दोस्तों, चाय पी ली सबने? ☕😂',
      'आज तो माहौल बन गया है 😄🔥',
      'Aaj toh stream dekhne mein maza aa raha hai 😄',
      'This stream is honestly much better than I expected',
      'यह स्ट्रीम मेरी उम्मीद से भी ज्यादा अच्छी लग रही है',
      'Bhai pura process beginning se end tak dikhao please',
      'भाई पूरा प्रोसेस शुरुआत से अंत तक दिखाओ प्लीज़',
      'Mujhe lag raha aaj kuch interesting seekhne ko milega',
      'मुझे लग रहा है आज कुछ अच्छा सीखने को मिलेगा',
      'I joined a little late, but this already looks very interesting',
      'मैं थोड़ा लेट आया हूँ, लेकिन अभी तक जो देखा काफी दिलचस्प लग रहा है',
      'Bhai agar tum isko thoda aur detail mein samjha do, toh beginners ko bhi easily samajh aa jayega 👍',
      'भाई ये पूरा workflow काफी साफ लग रहा है, खासकर जिस तरह तुम एक-एक step करके समझा रहे हो, उससे चीज़ें काफी आसानी से समझ आ रही हैं 🔥'
    ];
    const randomText = phrases[Math.floor(Math.random() * phrases.length)];

    const authorColor = getDeterministicColor(randomUser);

    const msg = {
      messageId: id,
      authorName: randomUser,
      authorId: `sim-user-${randomUser}`,
      authorProfileImageUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=${randomUser}`,
      authorColor: authorColor,
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

    const msg2 = {
      messageId: `spam-${Date.now()}-2`,
      authorName: 'SpamBot9001',
      authorId: 'sim-bot-9001',
      authorColor: getDeterministicColor('SpamBot9001'),
      authorProfileImageUrl: `https://api.dicebear.com/7.x/avataaars/svg?seed=spambot2`,
      text: spamText,
      status: 'queued' as const
    };
    
    // Send both through WS to test backend deduplication
    if (wsRef.current?.readyState === 1) {
      wsRef.current.send(JSON.stringify({ type: 'SIMULATE_MESSAGE', payload: msg1 }));
      // Send second one immediately after
      setTimeout(() => {
        if (wsRef.current?.readyState === 1) {
          wsRef.current.send(JSON.stringify({ type: 'SIMULATE_MESSAGE', payload: msg2 }));
        }
      }, 50);
    }
  };

  return (
    <div className="h-screen w-screen flex flex-col overflow-hidden bg-transparent relative">
      {/* Toast Notification */}
      {toast && (
        <div className="fixed top-4 right-4 z-50 bg-gray-900/95 border border-cyan-500/50 text-cyan-200 px-5 py-3 rounded-2xl shadow-2xl backdrop-blur-md flex items-center gap-3 animate-fade-in text-base font-semibold">
          <Check className="w-5 h-5 text-cyan-400" />
          <span>{toast}</span>
        </div>
      )}

      {/* ZONE B: Moderation Panel & Toolbar */}
      <div className="absolute top-0 left-0 w-[1080px] h-[520px] z-40 flex flex-col bg-gray-900 border-y border-gray-700 px-8 py-5 gap-3 shadow-2xl pointer-events-auto">
        
        {/* Top Header: Title, Banned Counter, OBS URLs, Settings */}
        <div className="w-full flex items-center justify-between gap-3 pb-2 border-b border-gray-800">
          <div className="flex items-center gap-3">
            <span className="text-xl font-black text-white tracking-wider flex items-center gap-2">
              <Volume2 className="w-6 h-6 text-cyan-400" />
              BABA TTS
            </span>

            {/* Banned Users Count Badge */}
            <div 
              className="flex items-center gap-2 px-3 py-1 bg-red-950/80 border border-red-700/60 rounded-xl text-red-200 shadow-sm"
              title="Total users banned from TTS"
            >
              <ShieldAlert className="w-4 h-4 text-red-400" />
              <span className="font-bold text-xs uppercase tracking-wide">Banned:</span>
              <span className="px-2 py-0.5 bg-red-800 text-white font-extrabold rounded-full text-xs">
                {bannedUsers.length}
              </span>
            </div>
          </div>

          {/* OBS URLs with 1-click Copy */}
          <div className="flex items-center gap-2">
            <button
              onClick={() => copyToClipboard(obsChatUrl, 'OBS Chat Overlay URL')}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-cyan-500/40 rounded-xl text-xs font-semibold text-cyan-300 transition-colors shadow"
              title={`Click to copy: ${obsChatUrl}`}
            >
              {copiedUrl === 'OBS Chat Overlay URL' ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>OBS Chat Overlay</span>
            </button>

            <button
              onClick={() => copyToClipboard(obsDockUrl, 'OBS Moderation Dock URL')}
              className="flex items-center gap-1.5 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 border border-purple-500/40 rounded-xl text-xs font-semibold text-purple-300 transition-colors shadow"
              title={`Click to copy: ${obsDockUrl}`}
            >
              {copiedUrl === 'OBS Moderation Dock URL' ? <Check className="w-3.5 h-3.5 text-green-400" /> : <Copy className="w-3.5 h-3.5" />}
              <span>OBS Dock</span>
            </button>

            <Link
              to="/settings"
              title="Open Settings"
              className="p-1.5 bg-gray-800 hover:bg-gray-700 border border-gray-600 rounded-xl text-gray-300 hover:text-white transition-colors"
            >
              <Settings className="w-5 h-5" />
            </Link>
          </div>
        </div>

        {/* Primary Action Buttons Row (with Numpad hotkey hints) */}
        <div className="w-full flex gap-3">
          <button
            onClick={handleBanCurrent}
            className="flex-1 px-4 py-3 bg-orange-600 hover:bg-orange-500 rounded-2xl text-lg font-bold transition-all shadow-xl text-white flex flex-col items-center justify-center leading-tight"
            title="Ban speaking user and purge their queue [Numpad 1]"
          >
            <span>Ban Current</span>
            <span className="text-xs text-orange-200 font-mono font-normal mt-0.5">[Num 1]</span>
          </button>

          <button
            onClick={handleSpeakAsBanned}
            className="flex-1 px-4 py-3 bg-rose-700 hover:bg-rose-600 rounded-2xl text-lg font-bold transition-all shadow-xl text-white flex flex-col items-center justify-center leading-tight"
            title="Impersonate last banned user with apology [Numpad 2]"
          >
            <span className="flex items-center gap-1">
              <Mic className="w-4 h-4" />
              Speak as Banned
            </span>
            <span className="text-xs text-rose-200 font-mono font-normal mt-0.5">[Num 2]</span>
          </button>

          <button
            onClick={handleSkipCurrent}
            className="flex-1 px-4 py-3 bg-yellow-600 hover:bg-yellow-500 rounded-2xl text-lg font-bold transition-all shadow-xl text-white flex flex-col items-center justify-center leading-tight"
            title="Skip currently playing TTS message [Numpad 3]"
          >
            <span>Skip Current</span>
            <span className="text-xs text-yellow-200 font-mono font-normal mt-0.5">[Num 3]</span>
          </button>

          <button
            onClick={handleClearQueue}
            className="flex-1 px-4 py-3 bg-red-600 hover:bg-red-500 rounded-2xl text-lg font-bold transition-all shadow-xl text-white flex flex-col items-center justify-center leading-tight"
            title="Clear all queued TTS messages [Numpad 0]"
          >
            <span>Clear Queue</span>
            <span className="text-xs text-red-200 font-mono font-normal mt-0.5">[Num 0]</span>
          </button>

          <button
            onClick={simulateSpamMessage}
            className="px-4 py-3 bg-purple-600 hover:bg-purple-500 rounded-2xl text-base font-bold transition-all shadow-xl text-white flex flex-col items-center justify-center leading-tight shrink-0"
          >
            <span>Simulate Spam</span>
            <span className="text-xs text-purple-200 font-mono font-normal mt-0.5">Test</span>
          </button>
        </div>

        {/* Temporary Theme Testing Toolbar */}
        <div className="w-full flex gap-3 border-b border-gray-800 pb-2">
          <span className="text-gray-400 text-sm font-bold self-center px-2 uppercase tracking-wider">Test Styles:</span>
          <button onClick={() => simulateGoodMessage('subtitle-sweep')} className="flex-1 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-xl text-white text-sm font-bold transition-colors border border-gray-600">Sweep</button>
          <button onClick={() => simulateGoodMessage('subtitle-karaoke')} className="flex-1 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-xl text-white text-sm font-bold transition-colors border border-gray-600">Karaoke</button>
          <button onClick={() => simulateGoodMessage('subtitle-words')} className="flex-1 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-xl text-white text-sm font-bold transition-colors border border-gray-600">Words</button>
          <button onClick={() => simulateGoodMessage('pro-clean')} className="flex-1 px-3 py-1.5 bg-gray-800 hover:bg-gray-700 rounded-xl text-white text-sm font-bold transition-colors border border-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.2)]">Pro Clean</button>
        </div>

        {/* The Moderation Panel Columns */}
        <ModerationPanel onBanUser={banUser} onUnbanUser={unbanUser} />
      </div>

      {/* Background layer for Chat History */}
      <div 
        className="hidden absolute bottom-0 left-[49px] right-[51px] h-[600px] backdrop-blur-2xl rounded-t-[40px] z-40 pointer-events-none border-t border-white/10"
        style={{
          background: 'rgba(28, 28, 30, 0.7)'
        }}
      >
      </div>

      {/* ZONE E: SCROLLING CHAT BOX (Strictly bottom 600px) */}
      <main className="absolute bottom-0 left-[49px] right-[51px] h-[600px] overflow-hidden flex flex-col justify-end p-6 bg-transparent z-50 pointer-events-none">
        <div className="flex flex-col justify-end min-h-full space-y-2">
          {messages.filter(msg => msg.status !== 'error').map((msg) => (
            <ChatMessage 
              key={msg.messageId} 
              message={msg} 
              currentAudioTime={msg.status === 'speaking' ? currentAudioTime : 0} 
              hideHistory={true}
            />
          ))}
          <div ref={messagesEndRef} />
        </div>
      </main>
    </div>
  );
}

export default App;
