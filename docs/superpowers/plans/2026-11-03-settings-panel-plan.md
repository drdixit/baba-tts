# Settings Panel Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a `/settings` route to the React frontend with a form that reads/writes app settings via the existing REST API, and wire up navigation from the dashboard.

**Architecture:** A new `SettingsPage.tsx` React component at route `/settings`, fetching settings from `GET /api/settings` on mount, saving via `POST /api/settings` on submit. A gear icon on the dashboard links to it. The Rust backend's SPA fallback already covers unknown routes by serving `index.html`.

**Tech Stack:** React 19, TypeScript, Tailwind CSS v4, react-router-dom v7, lucide-react (already installed), fetch API

**Spec:** `docs/superpowers/specs/2026-11-03-settings-panel-design.md`

## Global Constraints

- React 19, TypeScript ~6.0, Tailwind CSS v4 (`@import "tailwindcss"` syntax)
- All frontend code in `frontend/src/`
- Must build with `cd frontend && npm run build` (tsc + vite)
- The existing `/` and `/chat` routes must remain unchanged in behavior
- No new npm dependencies — lucide-react, react-router-dom, tailwindcss already installed

## Review Focus

1. **Azure key not leaked in network tab** — the GET response returns the key, which is expected since it's a local-only app on localhost:7060, but the UI must mask it in the input field.
2. **Save with empty key doesn't brick the app** — sending an empty `azure_speech_key` should be allowed (the backend already handles empty keys gracefully by skipping synthesis).
3. **SPA routing for `/settings`** — the Rust static_handler must return `index.html` for `/settings` so direct navigation and page refresh work.
4. **Settings form doesn't reset on save** — after a successful POST, the form should show the saved values, not revert to defaults.
5. **OBS overlay unaffected** — the `/chat` route must have no navigation chrome, settings links, or behavioral changes.

---

### Task 1: Settings Page Component

**Files:**
- Create: `frontend/src/SettingsPage.tsx`

**Interfaces:**
- Consumes: `GET /api/settings` → `AppSettings` JSON, `POST /api/settings` ← `AppSettings` JSON
- Produces: `<SettingsPage />` React component, default export

- [ ] **Step 1: Create `SettingsPage.tsx` with the settings form**

Component that:
- Fetches `GET /api/settings` on mount, populates form state
- Shows loading spinner while fetching
- Groups fields in two sections: "Azure Speech" (key, region, voice) and "YouTube" (channel_id, live_id, enable_youtube)
- Azure key field uses `type="password"` with a show/hide toggle (Eye/EyeOff from lucide-react)
- Enable YouTube uses a styled toggle switch
- Save button POSTs to `/api/settings` with the form state as JSON
- Shows a success/error banner after save (auto-dismisses after 3s)
- Has a back link to `/` with ArrowLeft icon
- Dark theme matching existing app (bg-gray-900, text-white, gray-800 cards)

- [ ] **Step 2: Verify the component renders without errors**

Run: `cd frontend && npx tsc --noEmit`
Expected: No type errors

---

### Task 2: Route Wiring and Navigation

**Files:**
- Modify: `frontend/src/main.tsx:11-14` (add Settings route)
- Modify: `frontend/src/App.tsx:160-165` (add gear icon link)
- Modify: `frontend/src/server.rs:164` (add `settings` to SPA routes)

**Interfaces:**
- Consumes: `SettingsPage` from Task 1
- Produces: `/settings` route accessible in browser, gear icon on dashboard

- [ ] **Step 3: Add `/settings` route to `main.tsx`**

Import `SettingsPage` and add `<Route path="/settings" element={<SettingsPage />} />` alongside existing routes.

- [ ] **Step 4: Add gear icon link to dashboard in `App.tsx`**

Add a `<Link to="/settings">` with a `Settings` icon from lucide-react in the top-right area of the dashboard, positioned absolutely so it doesn't interfere with existing moderation panel layout.

- [ ] **Step 5: Add `settings` to Rust SPA fallback in `server.rs`**

In the `static_handler` function, add `"settings"` to the path check on line 164 so that direct navigation to `/settings` returns `index.html`.

- [ ] **Step 6: Verify build succeeds**

Run: `cd frontend && npm run build`
Expected: Build completes without errors

- [ ] **Step 7: Verify Rust compiles**

Run: `cargo check`
Expected: No compilation errors

---

### Task 3: Commit

**Files:** All modified files from Tasks 1–2

- [ ] **Step 8: Commit all changes**

```bash
git add frontend/src/SettingsPage.tsx frontend/src/main.tsx frontend/src/App.tsx src/server.rs docs/superpowers/
git commit -m "feat: add settings panel for Azure TTS and YouTube configuration"
```
