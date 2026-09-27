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

  it('should call generateSpeech and reply with play_audio on TEST_AZURE_TTS message', async () => {
    const mockAudioData = 'data:audio/wav;base64,AQIDBA==';
    const generateSpeechSpy = vi.spyOn(tts, 'generateSpeech').mockResolvedValue(mockAudioData);

    const client = await createClient();

    const receivedMessages: any[] = [];
    client.on('message', (data) => {
      receivedMessages.push(JSON.parse(data.toString()));
    });

    client.send(JSON.stringify({ type: 'TEST_AZURE_TTS' }));

    await vi.waitFor(
      () => {
        expect(generateSpeechSpy).toHaveBeenCalledWith('Hi, this is a test from Azure.', 'hi-IN-AnanyaNeural');
        expect(receivedMessages).toContainEqual({
          type: 'play_audio',
          audioData: mockAudioData,
        });
      },
      { timeout: 1000 }
    );
  });

  it('should not send play_audio if generateSpeech returns null', async () => {
    const generateSpeechSpy = vi.spyOn(tts, 'generateSpeech').mockResolvedValue(null);

    const client = await createClient();

    const receivedMessages: any[] = [];
    client.on('message', (data) => {
      receivedMessages.push(JSON.parse(data.toString()));
    });

    client.send(JSON.stringify({ type: 'TEST_AZURE_TTS' }));

    await vi.waitFor(
      () => {
        expect(generateSpeechSpy).toHaveBeenCalledWith('Hi, this is a test from Azure.', 'hi-IN-AnanyaNeural');
      },
      { timeout: 1000 }
    );

    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(receivedMessages.some((msg) => msg.type === 'play_audio')).toBe(false);
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

  it('should not throw or send if client disconnects while generating speech', async () => {
    const mockAudioData = 'data:audio/wav;base64,AQIDBA==';
    let resolveSpeech: (val: string) => void;
    vi.spyOn(tts, 'generateSpeech').mockImplementation(
      () =>
        new Promise((resolve) => {
          resolveSpeech = resolve;
        })
    );

    const client = await createClient();
    client.send(JSON.stringify({ type: 'TEST_AZURE_TTS' }));

    // Wait until generateSpeech is called
    await vi.waitFor(() => {
      expect(tts.generateSpeech).toHaveBeenCalled();
    });

    // Close client before speech finishes
    client.terminate();

    // Now resolve speech
    resolveSpeech!(mockAudioData);

    // Ensure no unhandled rejection or errors
    await new Promise((resolve) => setTimeout(resolve, 50));
  });
});

