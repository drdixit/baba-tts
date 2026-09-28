import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { WebSocket } from 'ws';
import * as tts from './tts.js';
import { initWebSocketServer } from './ws.js';

describe('WebSocket Server', () => {
  let server: http.Server;
  let port: number;
  let clients: WebSocket[] = [];

  function createClient(): Promise<WebSocket> {
    return new Promise((resolve, reject) => {
      const client = new WebSocket(`ws://localhost:${port}`);
      clients.push(client);
      client.on('open', () => resolve(client));
      client.on('error', reject);
    });
  }

  beforeEach(async () => {
    vi.restoreAllMocks();
    clients = [];
    server = http.createServer();
    initWebSocketServer(server);
    await new Promise<void>((resolve) => {
      server.listen(0, () => {
        port = (server.address() as AddressInfo).port;
        resolve();
      });
    });
  });

  afterEach(async () => {
    for (const client of clients) {
      try {
        client.terminate();
      } catch {
        // ignore
      }
    }
    clients = [];
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('should initialize successfully', () => {
    expect(server).toBeDefined();
  });

  it('should safely handle non-JSON or invalid incoming messages', async () => {
    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

    const client = await createClient();

    client.send('invalid-json');

    await vi.waitFor(
      () => {
        expect(consoleSpy).toHaveBeenCalledWith('Failed to process incoming WebSocket message:', expect.any(Error));
      },
      { timeout: 1000 }
    );
  });

  it('should ignore incoming messages with unrecognized type', async () => {
    const generateSpeechSpy = vi.spyOn(tts, 'generateSpeech');

    const client = await createClient();

    client.send(JSON.stringify({ type: 'UNKNOWN_TYPE' }));

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(generateSpeechSpy).not.toHaveBeenCalled();
  });
});

