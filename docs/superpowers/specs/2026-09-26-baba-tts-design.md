# BABA TTS - Architecture Design Spec
**Date:** 2026-09-26

## Overview
A lightweight, completely local web application that acts as a YouTube Live Chat dashboard, moderation console, and eventually a TTS reader for a creator's own livestreams. 

The application is designed to run locally and be embedded inside an OBS Custom Browser Dock.

## 1. System Architecture

### Tech Stack
- **Frontend:** React, TypeScript, Vite, Tailwind CSS
- **State Management:** Zustand
- **Backend:** Node.js, Hono
- **Realtime:** WebSocket
- **Database:** SQLite
- **Validation:** Zod
- **External APIs:** Google OAuth 2.0, YouTube Data API v3

### High-Level Flow
1. User authenticates via Google OAuth through the local backend.
2. Backend identifies the active YouTube livestream and retrieves the `liveChatId`.
3. Backend polls the YouTube API (`liveChatMessages.list`) and pushes new messages to the React frontend via WebSocket.
4. React frontend displays the chat in an OBS-friendly dark-themed UI.
5. User moderates chat via the UI; frontend calls backend HTTP API, backend securely calls YouTube API.

## 2. Backend Design (Node.js + Hono)

### Database Schema (SQLite)
Minimal schema to store persistent data:
- `oauth_accounts`: Google account info and refresh tokens.
- `sessions`: Local auth sessions.
- `moderation_actions`: Audit log of bans, timeouts, and deletes.

### Endpoints
- `GET /auth/google` - Initiates OAuth flow.
- `GET /auth/google/callback` - OAuth callback, saves refresh token, sets local session cookie.
- `GET /api/me` - Returns logged-in channel info.
- `POST /api/moderate` - Accepts Zod-validated payload (`messageId`, `action`).
- `WS /ws` - WebSocket endpoint for broadcasting chat messages and state updates.

### YouTube API Integration
- Backend maintains a polling loop honoring YouTube's `pollingIntervalMillis`.
- Secrets (`client_secret_*.json`) and refresh tokens remain strictly on the backend.

## 3. Frontend Design (React + Vite)

### App Shell
- Single Page Application (SPA).
- Top Left: Authentication status (Login button OR Channel Name).
- UI tailored for OBS Custom Browser Docks (compact, dark theme).

### State Management (Zustand)
- Centralized store for the active chat array.
- Granular updates: WebSocket pushes status changes for specific messages, updating their visual state without re-rendering the entire list.

### Chat & Moderation UI
- **Message Component:** Displays author, text, and TTS lifecycle badge (Processing, Skipped, Speaking, Done).
- **Moderation Menu:** A 3-dot context menu on each message offering:
  - Delete Message
  - Timeout User (Temporary Ban)
  - Ban User (Permanent)

## 4. Security & Constraints
- **Local Only:** This application is strictly for local execution.
- **Strict Validation:** All incoming moderation requests to the backend are validated with Zod and require a valid local session.
- **Memory Management:** The active chat array in Zustand and the backend WebSocket buffer must be bounded (e.g., max 500 messages) to prevent memory leaks during long streams.
