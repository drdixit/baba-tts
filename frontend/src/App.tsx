import { useEffect, useRef, useState } from 'react';
import ChatMessage from './components/ChatMessage';
import ModerationPanel from './components/ModerationPanel';
import { useStore } from './store';
import { getDeterministicColor } from '../../src/shared/colors';

function App() {
  const { messages, addMessages } = useStore();
  const wsRef = useRef<WebSocket | null>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const rafRef = useRef<number | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const [currentAudioTime, setCurrentAudioTime] = useState(0);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  useEffect(() => {
    let isIntentionalClose = false;
    // Determine the WebSocket URL based on the current origin
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const wsUrl = `${protocol}//${window.location.host}/ws`;
    
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      console.log('Connected to WebSocket');
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.type === 'banned_users') {
          useStore.getState().setBannedUsers(data.users);
        } else if (data.type === 'tts_state') {
          useStore.getState().updateMessageStatus(data.messageId, data.state);
        } else if (data.type === 'tts_error') {
          useStore.getState().updateMessageStatus(data.messageId, 'error');
        } else if (data.type === 'KILL_AUDIO') {
          if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current.currentTime = 0;
          }
          if (rafRef.current !== null) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
          }
          setCurrentAudioTime(0);
          // Backend completely manages queue transition on KILL_AUDIO, do not send AUDIO_FINISHED
        } else if (data.type === 'play_audio' && data.audioData) {
          useStore.getState().updateMessage(data.messageId, {
            status: 'speaking',
            wordBoundaries: data.wordBoundaries
          });
          if (rafRef.current !== null) {
            cancelAnimationFrame(rafRef.current);
            rafRef.current = null;
          }

          if (audioRef.current) {
            audioRef.current.pause();
          }
          
          const audio = new Audio(data.audioData);
          audioRef.current = audio;

          const syncLoop = () => {
            if (audioRef.current === audio && !audio.paused) {
              setCurrentAudioTime(audio.currentTime);
              rafRef.current = requestAnimationFrame(syncLoop);
            }
          };

          audio.onplay = () => {
            rafRef.current = requestAnimationFrame(syncLoop);
          };

          audio.onpause = () => {
            if (rafRef.current !== null) {
              cancelAnimationFrame(rafRef.current);
              rafRef.current = null;
            }
          };
          
          audio.onended = () => {
            if (rafRef.current !== null) {
              cancelAnimationFrame(rafRef.current);
              rafRef.current = null;
            }
            setCurrentAudioTime(0);
            useStore.getState().updateMessageStatus(data.messageId, 'done');
            if (wsRef.current?.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({ type: 'AUDIO_FINISHED', messageId: data.messageId }));
            }
          };
          
          audio.onerror = (e) => {
            console.error("Audio play failed:", e);
            useStore.getState().updateMessageStatus(data.messageId, 'skipped');
            if (wsRef.current?.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({ type: 'AUDIO_FINISHED', messageId: data.messageId }));
            }
          };
          
          audio.play().catch(e => {
            console.error("Audio play failed (Promise rejected):", e);
            useStore.getState().updateMessageStatus(data.messageId, 'skipped');
            if (wsRef.current?.readyState === WebSocket.OPEN) {
              wsRef.current.send(JSON.stringify({ type: 'AUDIO_FINISHED', messageId: data.messageId }));
            }
          });
        } else if (data.type === 'delete' && data.messageId) {
          useStore.getState().removeMessage(data.messageId);
        } else if (Array.isArray(data)) {
          addMessages(data);
        } else {
          addMessages([data]);
        }
      } catch (err) {
        console.error('Failed to parse WebSocket message:', err);
      }
    };

    ws.onerror = (err) => {
      console.error('WebSocket error:', err);
    };

    ws.onclose = () => {
      if (isIntentionalClose) return;
      console.log('WebSocket disconnected. Attempting to reconnect in 3s...');
      setTimeout(() => {
        console.log('Reconnecting...');
        // We can't just call connectWebSocket if it's inside useEffect, so we trigger a state change or just reload.
        // Actually, the simplest bulletproof way for a dashboard that lost connection is to reload the window.
        window.location.reload();
      }, 3000);
    };

    return () => {
      isIntentionalClose = true;
      ws.close();
    };
  }, [addMessages]);


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
      'Mujhe lag raha hai aaj kuch interesting seekhne ko milega',
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
      {/* Floating UI controls (absolute top right) */}
            
      {/* ZONE B: Moderation Panel & Toolbar */}
      <div className="absolute top-0 left-0 w-[1080px] h-[480px] z-40 flex flex-col bg-gray-900 border-y border-gray-700 px-8 py-6 gap-4 shadow-2xl pointer-events-auto">
        
        {/* Full-Width Toolbar */}
        <div className="w-full flex gap-4">

          <button
            onClick={simulateSpamMessage}
            className="flex-1 px-6 py-4 bg-purple-600 hover:bg-purple-500 rounded-2xl text-xl font-bold transition-all shadow-xl text-white"
          >
            Simulate Spam
          </button>
          
          <button
            onClick={() => {
              if (wsRef.current?.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({ type: 'BAN_CURRENT_SPEAKER' }));
              }
            }}
            className="flex-1 px-6 py-4 bg-orange-600 hover:bg-orange-500 rounded-2xl text-xl font-bold transition-all shadow-xl text-white uppercase"
          >
            Ban Current Speaker
          </button>

          <button
            onClick={() => {
              if (wsRef.current?.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({ type: 'SKIP_CURRENT_MESSAGE' }));
              }
            }}
            className="flex-1 px-6 py-4 bg-yellow-600 hover:bg-yellow-500 rounded-2xl text-xl font-bold transition-all shadow-xl text-white uppercase"
          >
            Skip Current
          </button>

          <button
            onClick={() => {
              if (wsRef.current?.readyState === WebSocket.OPEN) {
                wsRef.current.send(JSON.stringify({ type: 'CLEAR_TTS_QUEUE' }));
              }
              if (audioRef.current) {
                audioRef.current.pause();
                audioRef.current.currentTime = 0;
              }
              if (rafRef.current !== null) {
                cancelAnimationFrame(rafRef.current);
                rafRef.current = null;
              }
              setCurrentAudioTime(0);
              useStore.getState().skipAllActiveMessages();
            }}
            className="flex-1 px-6 py-4 bg-red-600 hover:bg-red-500 rounded-2xl text-xl font-bold transition-all shadow-xl text-white uppercase"
          >
            Clear TTS Queue
          </button>
        </div>

        {/* Temporary Theme Testing Toolbar */}
        <div className="w-full flex gap-4 border-b border-gray-700 pb-4">
          <span className="text-gray-400 text-lg font-bold self-center px-4 uppercase tracking-wider">Test Styles:</span>
          <button onClick={() => simulateGoodMessage('subtitle-sweep')} className="flex-1 px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-xl text-white text-lg font-bold transition-colors border border-gray-600">Sweep</button>
          <button onClick={() => simulateGoodMessage('subtitle-karaoke')} className="flex-1 px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-xl text-white text-lg font-bold transition-colors border border-gray-600">Karaoke</button>
          <button onClick={() => simulateGoodMessage('subtitle-words')} className="flex-1 px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-xl text-white text-lg font-bold transition-colors border border-gray-600">Words</button>
          <button onClick={() => simulateGoodMessage('pro-clean')} className="flex-1 px-4 py-2 bg-gray-800 hover:bg-gray-700 rounded-xl text-white text-lg font-bold transition-colors border border-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.2)]">Pro Clean</button>
        </div>

        {/* The Moderation Panel Columns */}
        <ModerationPanel onBanUser={banUser} onUnbanUser={unbanUser} />
      </div>

      {/* ZONE E: SCROLLING CHAT BOX (Strictly bottom 640px) */}
      <main className="absolute bottom-0 left-[49px] right-[51px] h-[640px] overflow-hidden flex flex-col justify-end p-6 bg-black/70 backdrop-blur-md rounded-t-3xl border-t border-white/10 z-50 pointer-events-none">
        <div className="flex flex-col justify-end min-h-full space-y-2">
          {messages.filter(msg => msg.status !== 'error').map((msg) => (
            <ChatMessage 
              key={msg.messageId} 
              message={msg} 
              currentAudioTime={msg.status === 'speaking' ? currentAudioTime : 0} 
            />
          ))}
          <div ref={messagesEndRef} />
        </div>
      </main>
    </div>
  );
}

export default App;
