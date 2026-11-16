import { ChevronDown } from 'lucide-react';

interface HelpPanelProps {
  baseUrl: string;
}

const shortcuts = [
  { key: 'Numpad 1', action: 'Ban and skip', detail: 'Ban the current speaker and stop their message via /api/skip-ban-current.' },
  { key: 'Numpad 2', action: 'Speak as banned user', detail: 'Open quick input; Enter sends the text to /api/speak-as-banned.' },
  { key: 'Numpad 3', action: 'Skip current', detail: 'Stop the current message directly through the TTS queue.' },
  { key: 'Numpad 4', action: 'Speak as BABA', detail: 'Open quick input; Enter sends the text to /api/baba-say.' },
  { key: 'Numpad 0', action: 'Clear queue', detail: 'Remove pending messages directly through the TTS queue.' },
];

const restEndpoints = [
  { method: 'GET', path: '/api/info', description: 'Local server port, app URL, OBS URLs, and banned-user count.' },
  { method: 'GET', path: '/api/last-banned', description: 'Return the most recently banned user.' },
  { method: 'GET, POST', path: '/api/settings', description: 'Read or save settings. GET reports whether the Speech key is saved without returning it; POST can replace it or set clearAzureSpeechKey. Voice rotation uses azureSpeechVoices and azureSpeechVoiceRotation.' },
  { method: 'GET', path: '/api/voices', description: 'Load the voices available in the configured Azure Speech region using the saved key.' },
  { method: 'POST', path: '/api/restart', description: 'Restart the local server.' },
  { method: 'POST', path: '/api/skip-current', description: 'Stop the current TTS message.' },
  { method: 'POST', path: '/api/skip-ban-current', description: 'Ban the current speaker and stop their message.' },
  { method: 'POST', path: '/api/baba-say', description: 'Queue a streamer announcement. JSON body: {"text":"Hello chat"}.' },
  { method: 'POST', path: '/api/speak-as-banned', description: 'Speak as the last banned user. Accepts an optional {"text":"…"} body.' },
];

const websocketCommands = [
  'SIMULATE_MESSAGE (payload: ChatMessage)',
  'AUDIO_FINISHED (messageId)',
  'CLEAR_TTS_QUEUE',
  'SKIP_CURRENT_MESSAGE',
  'BAN_CURRENT_SPEAKER',
  'BAN_USER (payload: authorId, displayName, profileImageUrl)',
  'UNBAN_USER (payload: authorId)',
];

export default function HelpPanel({ baseUrl }: HelpPanelProps) {
  const websocketUrl = baseUrl.replace(/^http/, 'ws') + '/ws';

  return (
    <div className="grid w-full grid-cols-1 gap-2 2xl:grid-cols-[minmax(260px,0.7fr)_minmax(0,1.3fr)]">
      <fieldset aria-labelledby="shortcuts-heading" className="desktop-groupbox min-w-0">
        <legend id="shortcuts-heading" className="desktop-groupbox-legend">Numpad shortcuts</legend>
        <p className="desktop-help-text mb-1">Global shortcuts while BABA TTS is running.</p>
        <div className="divide-y divide-[#E5E5E5]">
          {shortcuts.map((shortcut) => (
            <div key={shortcut.key} className="grid grid-cols-[86px_minmax(0,1fr)] items-center gap-x-2 gap-y-0.5 py-1.5 sm:grid-cols-[88px_150px_minmax(0,1fr)]">
              <kbd className="w-fit border border-[#D0D0D0] bg-[#F3F3F3] px-1.5 py-0.5 font-mono text-[11px] text-[#333]">{shortcut.key}</kbd>
              <span className="text-xs font-medium text-[#222]">{shortcut.action}</span>
              <span className="col-span-2 text-[11px] text-[#555] sm:col-span-1">{shortcut.detail}</span>
            </div>
          ))}
        </div>
        <p className="border-t border-[#E5E5E5] pt-2 text-[11px] text-[#555]">
          Quick input submits with <kbd className="border border-[#D0D0D0] bg-[#F3F3F3] px-1 py-0.5 font-mono">Enter</kbd> and closes with <kbd className="border border-[#D0D0D0] bg-[#F3F3F3] px-1 py-0.5 font-mono">Esc</kbd>.
        </p>
      </fieldset>

      <fieldset aria-labelledby="api-heading" className="desktop-groupbox min-w-0 overflow-hidden">
        <legend id="api-heading" className="desktop-groupbox-legend">Local API</legend>
        <p className="desktop-help-text mb-1">HTTP endpoints served by this app.</p>
        <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
          <span className="desktop-setting-label">Base address</span>
          <code className="min-w-0 select-all break-all border border-[#D0D0D0] bg-[#F7F7F7] px-2 py-1 font-mono text-[11px] text-[#333]">{baseUrl}</code>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[580px] border-collapse text-left">
            <thead className="bg-[#F1F1F1] text-[11px] font-semibold text-[#444]">
              <tr>
                <th scope="col" className="w-20 border-y border-[#D5D5D5] px-2 py-1">Method</th>
                <th scope="col" className="w-48 border-y border-[#D5D5D5] px-2 py-1">Endpoint</th>
                <th scope="col" className="border-y border-[#D5D5D5] px-2 py-1">Purpose</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#E5E5E5]">
              {restEndpoints.map((endpoint) => (
                <tr key={endpoint.path}>
                  <td className="px-2 py-1 align-top font-mono text-[11px] text-[#555]">{endpoint.method}</td>
                  <td className="px-2 py-1 align-top font-mono text-[11px] text-[#222]">{endpoint.path}</td>
                  <td className="px-2 py-1 align-top text-[11px] text-[#444]">{endpoint.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <details className="group mt-2 border-t border-[#D5D5D5]">
          <summary className="flex min-h-7 cursor-pointer list-none items-center justify-between gap-3 text-xs font-medium text-[#444] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[#555] [&::-webkit-details-marker]:hidden">
            <span>WebSocket reference · <code className="font-mono">{websocketUrl}</code></span>
            <ChevronDown className="h-3.5 w-3.5 text-[#555] transition-transform group-open:rotate-180" aria-hidden="true" />
          </summary>
          <div className="border-t border-[#E5E5E5] py-2">
            <p className="text-xs text-[#444]">Client commands</p>
            <ul className="mt-1 flex flex-wrap gap-1">
              {websocketCommands.map((command) => (
                <li key={command} className="border border-[#D5D5D5] bg-[#F7F7F7] px-1.5 py-0.5 font-mono text-[10px] text-[#444]">{command}</li>
              ))}
            </ul>
            <p className="mt-2 text-[11px] text-[#555]">Server events: message lists, banned_users, tts_state, play_audio, and KILL_AUDIO.</p>
          </div>
        </details>
        <p className="border-t border-[#E5E5E5] pt-2 text-[11px] text-[#555]">
          OBS browser sources: <a className="font-mono text-[#222] underline" href={baseUrl + '/popup'} target="_blank" rel="noreferrer">/popup</a>, <a className="font-mono text-[#222] underline" href={baseUrl + '/overlay'} target="_blank" rel="noreferrer">/overlay</a>, and <a className="font-mono text-[#222] underline" href={baseUrl + '/chat'} target="_blank" rel="noreferrer">/chat</a>. See OBS setup for dimensions and audio guidance.
        </p>
      </fieldset>
    </div>
  );
}
