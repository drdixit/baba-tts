import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateSpeech } from './tts.js';

describe('generateSpeech', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    vi.resetModules();
    process.env = { ...originalEnv };
  });

  afterEach(() => {
    process.env = originalEnv;
    vi.restoreAllMocks();
  });

  it('should return null and warn if AZURE_SPEECH_KEY is missing', async () => {
    process.env.AZURE_SPEECH_REGION = 'eastus';
    delete process.env.AZURE_SPEECH_KEY;

    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await generateSpeech('Hello', 'en-US-JennyNeural');

    expect(result).toBeNull();
    expect(consoleSpy).toHaveBeenCalledWith('AZURE_SPEECH_KEY or AZURE_SPEECH_REGION is missing');
  });

  it('should return null and warn if AZURE_SPEECH_REGION is missing', async () => {
    process.env.AZURE_SPEECH_KEY = 'test-key';
    delete process.env.AZURE_SPEECH_REGION;

    const consoleSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const result = await generateSpeech('Hello', 'en-US-JennyNeural');

    expect(result).toBeNull();
    expect(consoleSpy).toHaveBeenCalledWith('AZURE_SPEECH_KEY or AZURE_SPEECH_REGION is missing');
  });

  it('should return null and error if Azure returns non-200', async () => {
    process.env.AZURE_SPEECH_KEY = 'test-key';
    process.env.AZURE_SPEECH_REGION = 'eastus';

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 401
    });

    const result = await generateSpeech('Hello', 'en-US-JennyNeural');

    expect(result).toBeNull();
    expect(consoleSpy).toHaveBeenCalledWith('Error from Azure: 401');
    
    // Check if fetch was called with correct URL and headers
    expect(global.fetch).toHaveBeenCalledWith(
      'https://eastus.tts.speech.microsoft.com/cognitiveservices/v1',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'Ocp-Apim-Subscription-Key': 'test-key',
          'Content-Type': 'application/ssml+xml',
          'X-Microsoft-OutputFormat': 'riff-48khz-16bit-mono-pcm',
          'User-Agent': 'BabaTTS'
        },
        body: expect.stringContaining('Hello')
      })
    );
  });

  it('should return base64 string on success', async () => {
    process.env.AZURE_SPEECH_KEY = 'test-key';
    process.env.AZURE_SPEECH_REGION = 'eastus';

    const mockBuffer = new ArrayBuffer(4);
    new Uint8Array(mockBuffer).set([1, 2, 3, 4]);

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => mockBuffer
    });

    const result = await generateSpeech('Hello', 'en-US-JennyNeural');

    expect(result).toBe('data:audio/wav;base64,AQIDBA==');
  });

  it('should return null and error on fetch exception', async () => {
    process.env.AZURE_SPEECH_KEY = 'test-key';
    process.env.AZURE_SPEECH_REGION = 'eastus';

    const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
    global.fetch = vi.fn().mockRejectedValue(new Error('Network error'));

    const result = await generateSpeech('Hello', 'en-US-JennyNeural');

    expect(result).toBeNull();
    expect(consoleSpy).toHaveBeenCalledWith('Failed to generate speech:', expect.any(Error));
  });
  it('should escape XML characters in text and use dynamic xml:lang', async () => {
    process.env.AZURE_SPEECH_KEY = 'test-key';
    process.env.AZURE_SPEECH_REGION = 'eastus';

    const mockBuffer = new ArrayBuffer(4);
    new Uint8Array(mockBuffer).set([1, 2, 3, 4]);

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      arrayBuffer: async () => mockBuffer
    });

    const result = await generateSpeech('Tom & Jerry <3 "cats" & \'dogs\'', 'hi-IN-SwaraNeural');
    expect(result).toBe('data:audio/wav;base64,AQIDBA==');

    expect(global.fetch).toHaveBeenCalledWith(
      'https://eastus.tts.speech.microsoft.com/cognitiveservices/v1',
      expect.objectContaining({
        body: expect.stringMatching(/xml:lang="hi-IN"/)
      })
    );
    expect(global.fetch).toHaveBeenCalledWith(
      'https://eastus.tts.speech.microsoft.com/cognitiveservices/v1',
      expect.objectContaining({
        body: expect.stringMatching(/Tom &amp; Jerry &lt;3 &quot;cats&quot; &amp; &apos;dogs&apos;/)
      })
    );
  });
});
