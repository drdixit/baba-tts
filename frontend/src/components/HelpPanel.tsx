import { ChevronDown, Code2, Keyboard } from 'lucide-react';

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
  { method: 'GET, POST', path: '/api/settings', description: 'Read or save the app settings as JSON.' },
  { method: 'GET, POST', path: '/api/restart', description: 'Restart the local server. Requests must come from localhost.' },
  { method: 'GET, POST', path: '/api/skip-current', description: 'Stop the current TTS message.' },
  { method: 'GET, POST', path: '/api/skip-ban-current', description: 'Ban the current speaker and stop their message.' },
  { method: 'POST', path: '/api/baba-say', description: 'Queue a streamer announcement. JSON body: {"text":"Hello chat"}.' },
  { method: 'GET, POST', path: '/api/speak-as-banned', description: 'Speak as the last banned user. POST accepts an optional {"text":"…"} body.' },
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
    <div className="w-full max-w-5xl mx-auto space-y-4">
      <section aria-labelledby="shortcuts-heading" className="desktop-panel overflow-hidden">
        <div className="desktop-panel-header flex items-center gap-3 px-4 py-3">
          <Keyboard className="h-4 w-4 text-slate-600" aria-hidden="true" />
          <div>
            <h2 id="shortcuts-heading" className="text-sm font-semibold text-slate-900">Numpad shortcuts</h2>
            <p className="mt-0.5 text-xs text-slate-600">Global shortcuts while BABA TTS is running.</p>
          </div>
        </div>
        <div className="divide-y divide-black/[0.06]">
          {shortcuts.map((shortcut) => (
            <div key={shortcut.key} className="grid grid-cols-[104px_minmax(0,1fr)] items-center gap-x-4 gap-y-0.5 px-4 py-2.5 sm:grid-cols-[116px_170px_minmax(0,1fr)]">
              <kbd className="w-fit rounded border border-black/[0.12] bg-[#F3F3F3] px-2 py-1 font-mono text-xs text-slate-800">{shortcut.key}</kbd>
              <span className="text-xs font-medium text-slate-900">{shortcut.action}</span>
              <span className="col-span-2 text-xs text-slate-600 sm:col-span-1">{shortcut.detail}</span>
            </div>
          ))}
        </div>
        <p className="border-t border-black/[0.08] px-4 py-2.5 text-xs text-slate-600">
          Quick input windows submit with <kbd className="rounded border border-black/[0.12] bg-[#F3F3F3] px-1.5 py-0.5 font-mono text-xs">Enter</kbd> and close with <kbd className="rounded border border-black/[0.12] bg-[#F3F3F3] px-1.5 py-0.5 font-mono text-xs">Esc</kbd>.
        </p>
      </section>

      <section aria-labelledby="api-heading" className="desktop-panel overflow-hidden">
        <div className="desktop-panel-header flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          <div className="flex items-center gap-3">
            <Code2 className="h-4 w-4 text-slate-600" aria-hidden="true" />
            <div>
              <h2 id="api-heading" className="text-sm font-semibold text-slate-900">Local API</h2>
              <p className="mt-0.5 text-xs text-slate-600">HTTP endpoints served by this app.</p>
            </div>
          </div>
          <code className="select-all break-all rounded border border-black/[0.08] bg-[#F7F7F7] px-2.5 py-1.5 font-mono text-xs text-slate-700">{baseUrl}</code>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] border-collapse text-left">
            <thead className="bg-[#F7F7F7] text-xs font-semibold uppercase tracking-wide text-slate-600">
              <tr>
                <th scope="col" className="w-28 px-4 py-2">Method</th>
                <th scope="col" className="w-56 px-4 py-2">Endpoint</th>
                <th scope="col" className="px-4 py-2">Purpose</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-black/[0.06]">
              {restEndpoints.map((endpoint) => (
                <tr key={endpoint.path}>
                  <td className="px-4 py-2.5 align-top font-mono text-xs text-slate-600">{endpoint.method}</td>
                  <td className="px-4 py-2.5 align-top font-mono text-xs text-slate-900">{endpoint.path}</td>
                  <td className="px-4 py-2.5 align-top text-xs leading-relaxed text-slate-700">{endpoint.description}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <details className="group border-t border-black/[0.08]">
          <summary className="flex min-h-10 cursor-pointer list-none items-center justify-between gap-3 px-4 text-xs font-medium text-slate-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#64748B] [&::-webkit-details-marker]:hidden">
            <span>WebSocket reference · <code className="font-mono">{websocketUrl}</code></span>
            <ChevronDown className="h-4 w-4 text-slate-500 transition-transform group-open:rotate-180" aria-hidden="true" />
          </summary>
          <div className="border-t border-black/[0.06] px-4 py-3">
            <p className="text-xs text-slate-700">Client commands</p>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {websocketCommands.map((command) => (
                <li key={command} className="rounded border border-black/[0.10] bg-[#F7F7F7] px-2 py-1 font-mono text-xs text-slate-700">{command}</li>
              ))}
            </ul>
            <p className="mt-3 text-xs text-slate-600">Server events: message lists, banned_users, tts_state, play_audio, and KILL_AUDIO.</p>
          </div>
        </details>
        <p className="px-4 py-2.5 text-xs text-slate-600">
          OBS browser sources: <a className="font-mono text-slate-800 underline decoration-slate-400 underline-offset-2" href={baseUrl + '/popup'} target="_blank" rel="noreferrer">/popup</a>, <a className="font-mono text-slate-800 underline decoration-slate-400 underline-offset-2" href={baseUrl + '/overlay'} target="_blank" rel="noreferrer">/overlay</a>, and <a className="font-mono text-slate-800 underline decoration-slate-400 underline-offset-2" href={baseUrl + '/chat'} target="_blank" rel="noreferrer">/chat</a>. See OBS setup for dimensions and audio guidance.
        </p>
      </section>
    </div>
  );
}
