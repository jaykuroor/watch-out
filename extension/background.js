const LOG_PREFIX = '[FactCheck SW]';
function log(...args) { console.log(LOG_PREFIX, ...args); }
function warn(...args) { console.warn(LOG_PREFIX, ...args); }

const API_BASE = 'http://localhost:3000';
const memoryCache = new Map();
const inFlight = new Map();

log('Service worker started. API_BASE:', API_BASE);

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== 'ANALYZE_SHORT') return;

  const { videoId, priority } = msg;
  const tabId = sender.tab?.id;
  log('ANALYZE_SHORT received:', videoId, 'priority:', priority, 'tabId:', tabId);

  if (!tabId) {
    warn('No tabId found, ignoring message');
    return;
  }

  // 1. Check in-memory cache (instant)
  if (memoryCache.has(videoId)) {
    log('Memory cache hit for', videoId);
    chrome.tabs.sendMessage(tabId, {
      type: 'ANALYSIS_RESULT',
      videoId,
      data: memoryCache.get(videoId)
    });
    return;
  }

  // 2. Check chrome.storage.local (persists across service worker restarts)
  chrome.storage.local.get(videoId, (stored) => {
    if (stored[videoId]) {
      log('Storage cache hit for', videoId);
      const data = stored[videoId];
      memoryCache.set(videoId, data);
      chrome.tabs.sendMessage(tabId, {
        type: 'ANALYSIS_RESULT',
        videoId,
        data
      });
      return;
    }

    // 3. Don't duplicate in-flight requests for the same videoId
    if (inFlight.has(videoId)) {
      log('Request already in-flight for', videoId);
      return;
    }
    inFlight.set(videoId, true);

    // 4. Tell content script we're loading
    log('Sending ANALYSIS_LOADING for', videoId);
    chrome.tabs.sendMessage(tabId, { type: 'ANALYSIS_LOADING', videoId });

    // 5. Call the backend
    log('Fetching from backend:', `${API_BASE}/api/analyze`);
    fetch(`${API_BASE}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ videoId, priority })
    })
      .then(res => {
        log('Backend response status:', res.status);
        if (!res.ok) throw new Error(`Backend returned ${res.status}`);
        return res.json();
      })
      .then(data => {
        log('Backend success for', videoId, '- status:', data.status, 'claims:', data.claims?.length);
        memoryCache.set(videoId, data);
        chrome.storage.local.set({ [videoId]: data });
        inFlight.delete(videoId);

        chrome.tabs.sendMessage(tabId, {
          type: 'ANALYSIS_RESULT',
          videoId,
          data
        });
      })
      .catch(err => {
        warn('Backend error for', videoId, ':', err.message);
        inFlight.delete(videoId);
        chrome.tabs.sendMessage(tabId, {
          type: 'ANALYSIS_ERROR',
          videoId,
          error: err.message
        });
      });
  });
});

// Prune chrome.storage.local to avoid unbounded growth (max 50 entries)
function pruneStorage() {
  chrome.storage.local.get(null, (all) => {
    const keys = Object.keys(all);
    if (keys.length > 50) {
      const toRemove = keys.slice(0, keys.length - 50);
      chrome.storage.local.remove(toRemove);
      log('Pruned', toRemove.length, 'entries from storage');
    }
  });
}
setInterval(pruneStorage, 60000);
