import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as sdk from 'microsoft-cognitiveservices-speech-sdk';

const speakTextAsync = vi.fn();
const close = vi.fn();
const synthesizer = {
    speakTextAsync,
    close,
    wordBoundary: () => {}
};

vi.mock('microsoft-cognitiveservices-speech-sdk', () => {
    return {
        SpeechConfig: {
            fromSubscription: vi.fn().mockReturnValue({
                setSpeechSynthesisOutputFormat: vi.fn()
            })
        },
        AudioConfig: {
            fromDefaultSpeakerOutput: vi.fn().mockReturnValue({})
        },
        SpeechSynthesizer: vi.fn().mockImplementation(function() {
            return synthesizer;
        }),
        ResultReason: {
            SynthesizingAudioCompleted: 1,
            Canceled: 2
        },
        SpeechSynthesisOutputFormat: {
            Riff48000Hz16BitMonoPcm: 1
        }
    };
});

import { generateSpeech } from './tts.js';

describe('generateSpeech', () => {
    const originalEnv = process.env;

    beforeEach(() => {
        vi.resetModules();
        process.env = { ...originalEnv };
        speakTextAsync.mockReset();
        close.mockReset();
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

    it('should return null and error if Azure SDK fails', async () => {
        process.env.AZURE_SPEECH_KEY = 'test-key';
        process.env.AZURE_SPEECH_REGION = 'eastus';

        const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
        speakTextAsync.mockImplementation((text: string, cb: any) => {
            cb({ reason: 2 });
        });

        const result = await generateSpeech('Hello', 'en-US-JennyNeural');

        expect(result).toBeNull();
        expect(consoleSpy).toHaveBeenCalled();
        expect(close).toHaveBeenCalled();
    });

    it('should return audioData and wordBoundaries on success', async () => {
        process.env.AZURE_SPEECH_KEY = 'test-key';
        process.env.AZURE_SPEECH_REGION = 'eastus';

        speakTextAsync.mockImplementation((text: string, cb: any) => {
            const mockBuffer = new ArrayBuffer(4);
            new Uint8Array(mockBuffer).set([1, 2, 3, 4]);
            cb({
                reason: 1,
                audioData: mockBuffer
            });
        });

        const result = await generateSpeech('Hello', 'en-US-JennyNeural');

        expect(result).toBeDefined();
        expect(result?.audioData).toBe('data:audio/wav;base64,AQIDBA==');
        expect(result?.wordBoundaries).toBeDefined();
        expect(close).toHaveBeenCalled();
    });
});
