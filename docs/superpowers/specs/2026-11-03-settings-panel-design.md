# Settings Panel Design

## Intent

The user wants a settings panel in the app where they can configure Azure TTS
credentials, YouTube channel info, and control the server — without editing
`.env` files or code. The Rust backend already has settings persistence (SQLite)
and a settings REST API (`GET /POST /api/settings`). The frontend has no
settings UI.

## Why

First-time setup and ongoing configuration should be visual, not file-editing.
A streamer who downloads baba-tts should be able to paste their Azure key,
enter their YouTube channel, and start streaming TTS — all from the browser
dashboard they already open.

## Goals

- Settings page in the existing React frontend where the user configures:
  - Azure Speech Key (password-masked input)
  - Azure Speech Region
  - Azure Speech Voice (dropdown or text input)
  - YouTube Channel ID
  - YouTube Live ID (optional)
  - Enable YouTube toggle
- Settings are saved via the existing `POST /api/settings` endpoint
- Settings are loaded via the existing `GET /api/settings` on page mount
- Navigation between the dashboard (`/`) and settings in the same app
- Visual feedback: save confirmation, validation errors

## Non-Goals

- No Tauri or Electron — the Rust binary with system tray is already the
  native app
- No start/stop/restart server from the UI — the system tray already handles
  exit, and the server auto-starts when you launch the `.exe`. Server restart
  after settings change is handled by the existing `update_settings` mechanism
  which hot-reloads TTS settings in the running TtsActor
- No new backend routes — the API already exists
- No changes to the OBS overlay route (`/chat`) — it stays untouched

## Anti-Goals

- Don't expose settings on the `/chat` route — that's the OBS overlay
- Don't require a server restart to apply settings changes

## Constraints

- Must work with the existing Rust backend embedded frontend (rust-embed from
  `frontend/dist/`)
- Must use the existing tech stack: React 19, Tailwind CSS v4, Zustand,
  react-router-dom
- The Azure Speech Key is sensitive — mask it in the UI
- The existing two routes must continue to work exactly as they do

## Approaches

### A. Settings as a new route `/settings` (chosen)

Add a third React route at `/settings` with a dedicated settings page. The
dashboard at `/` gets a small gear icon link to `/settings`. The settings page
has a back button to `/`.

**Why chosen:** Clean separation. The dashboard is for live moderation during
a stream. Settings are pre-stream configuration. They serve different moments
and different attention states.

### B. Settings as a slide-out panel on the dashboard

Add a gear icon to the dashboard that opens a slide-out drawer with settings
fields.

**Why not:** The dashboard at `/` is already dense with moderation controls,
test buttons, and the chat view. Adding a drawer would compete with the
moderation workflow.

### C. Settings as a tab within the existing moderation panel

Replace or extend the moderation panel to include a settings tab.

**Why not:** The moderation panel is a live-stream tool. Settings are a
pre-stream tool. Mixing them creates confusion about what's safe to change
while streaming.

## The Parts

### Settings Page Component

A full-page form at `/settings` with:
- A header with "Settings" title and back arrow to `/`
- Grouped sections: "Azure Speech" and "YouTube"
- Azure Speech: Key (password input with show/hide toggle), Region (text),
  Voice (text with placeholder showing default)
- YouTube: Channel ID (text), Live ID (text, marked optional),
  Enable YouTube (toggle switch)
- A Save button that POSTs to `/api/settings`
- Toast/banner for success/error feedback
- Loading state while fetching current settings

### Navigation

- The dashboard (`/`) gets a small gear icon (top-right corner area) linking
  to `/settings`
- The settings page has a back arrow linking to `/`
- The `/chat` OBS overlay route is unchanged — no navigation elements

### Styling

- Same dark theme as the rest of the app (gray-900 backgrounds)
- Consistent with the existing Tailwind patterns used in the moderation panel
- Responsive enough for the streamer's monitor, but doesn't need to be
  mobile-perfect

### Backend Changes

- The Rust `static_handler` needs to treat `/settings` as an SPA route
  (return `index.html`), same as it already does for `/chat`
- That's it. The settings API already exists.

## What's Left to the Builder

- Exact input field sizes and spacing
- Whether to use a dropdown for voice selection or keep it as a text field
  (text is simpler and more flexible for custom voice names)
- Toast/notification component implementation details
- Exact icon choice from lucide-react (already a dependency)
