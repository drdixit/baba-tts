import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { pollLiveChat, stopYouTubePoller, _testSetActivePoller } from './youtube.js';
import * as ws from './ws.js';

describe('pollLiveChat', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.spyOn(ws, 'broadcastMessages').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.restoreAllMocks();
    stopYouTubePoller();
  });

  it('should broadcast messages and schedule next poll with new token', async () => {
    _testSetActivePoller('test-account');

    const youtubeMock = {
      liveChatMessages: {
        list: vi.fn().mockResolvedValue({
          data: {
            nextPageToken: 'next-token-123',
            pollingIntervalMillis: 3000,
            items: [
              { id: '1', authorDetails: { displayName: 'John' }, snippet: { displayMessage: 'Hello' } }
            ]
          }
        })
      }
    };

    await pollLiveChat('test-account', youtubeMock, 'chat-123', 'old-token');

    expect(youtubeMock.liveChatMessages.list).toHaveBeenCalledWith({
      liveChatId: 'chat-123',
      part: ['snippet', 'authorDetails'],
      pageToken: 'old-token'
    });

    expect(ws.broadcastMessages).toHaveBeenCalledWith([
      { messageId: '1', authorName: 'John', text: 'Hello', status: 'default' }
    ]);

    expect(vi.getTimerCount()).toBe(1);
    vi.advanceTimersByTime(3000);
    
    // Poller should be scheduled with new token
    // Wait, the next poll runs asynchronously so it will call liveChatMessages.list again
    expect(youtubeMock.liveChatMessages.list).toHaveBeenCalledTimes(2);
    // The second call should have the new page token
    expect(youtubeMock.liveChatMessages.list).toHaveBeenLastCalledWith({
      liveChatId: 'chat-123',
      part: ['snippet', 'authorDetails'],
      pageToken: 'next-token-123'
    });
  });

  it('should abort polling on fatal errors (e.g. 403, 404)', async () => {
    _testSetActivePoller('fatal-account');

    const youtubeMock = {
      liveChatMessages: {
        list: vi.fn().mockRejectedValue({ status: 403 })
      }
    };

    await pollLiveChat('fatal-account', youtubeMock, 'chat-123', 'token-1');

    // Timer count should be 0 because the poller aborted
    expect(vi.getTimerCount()).toBe(0);
    expect(youtubeMock.liveChatMessages.list).toHaveBeenCalledTimes(1);
  });

  it('should wait 10 seconds and retry with same token on 429 error', async () => {
    _testSetActivePoller('rate-limit-account');

    const youtubeMock = {
      liveChatMessages: {
        list: vi.fn().mockRejectedValue({ status: 429 })
      }
    };

    await pollLiveChat('rate-limit-account', youtubeMock, 'chat-123', 'token-retry');

    // Should schedule a retry
    expect(vi.getTimerCount()).toBe(1);
    
    vi.advanceTimersByTime(5000);
    // Wait 5 seconds, shouldn't have fired yet since it waits 10s for 429
    expect(youtubeMock.liveChatMessages.list).toHaveBeenCalledTimes(1);
    
    vi.advanceTimersByTime(5000);
    // Now it should have fired
    expect(youtubeMock.liveChatMessages.list).toHaveBeenCalledTimes(2);
    expect(youtubeMock.liveChatMessages.list).toHaveBeenLastCalledWith({
      liveChatId: 'chat-123',
      part: ['snippet', 'authorDetails'],
      pageToken: 'token-retry'
    });
  });

  it('should escape HTML in incoming messages', async () => {
    _testSetActivePoller('xss-account');

    const youtubeMock = {
      liveChatMessages: {
        list: vi.fn().mockResolvedValue({
          data: {
            nextPageToken: 'token',
            pollingIntervalMillis: 3000,
            items: [
              { id: '1', authorDetails: { displayName: '<script>' }, snippet: { displayMessage: '<img src=x onerror=alert(1)>' } }
            ]
          }
        })
      }
    };

    await pollLiveChat('xss-account', youtubeMock, 'chat-123', '');

    expect(ws.broadcastMessages).toHaveBeenCalledWith([
      { messageId: '1', authorName: '&lt;script&gt;', text: '&lt;img src=x onerror=alert(1)&gt;', status: 'default' }
    ]);
  });
});
