const LOG_PREFIX = '[FactCheck SW]';
function log(...args) { console.log(LOG_PREFIX, ...args); }
function warn(...args) { console.warn(LOG_PREFIX, ...args); }

const API_BASE = 'http://localhost:3000';
const memoryCache = new Map();
const inFlight = new Map();
const requestVersion = new Map();

log('Service worker started. API_BASE:', API_BASE);

function hasEvidenceIntegrityIssue(data) {
  if (!data || data.status !== 'success' || !Array.isArray(data.claims)) return false;
  const claims = data.claims;
  if (claims.length === 0) return false;

  const nonUnclearClaims = claims.filter((c) => c && (c.verdict === 'supported' || c.verdict === 'refuted'));
  if (nonUnclearClaims.some((c) => !Array.isArray(c.sources) || c.sources.length === 0)) {
    return true;
  }

  const totalSourceCount = claims.reduce((sum, c) => {
    const src = Array.isArray(c?.sources) ? c.sources.length : 0;
    return sum + src;
  }, 0);
  return totalSourceCount === 0;
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type !== 'ANALYZE_SHORT') return;

  const { videoId, priority, forceRefresh, model } = msg;
  const tabId = sender.tab?.id;
  log(
    'ANALYZE_SHORT received:',
    videoId,
    'priority:',
    priority,
    'tabId:',
    tabId,
    forceRefresh ? '(forceRefresh)' : '',
    model ? `(model=${model})` : ''
  );

  if (!tabId) {
    warn('No tabId found, ignoring message');
    return;
  }

  if (forceRefresh) {
    memoryCache.delete(videoId);
    inFlight.delete(videoId);
    chrome.storage.local.remove(videoId);
  }

  // 1. Check in-memory cache (instant)
  if (!forceRefresh && memoryCache.has(videoId)) {
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
    if (!forceRefresh && stored[videoId]) {
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
    const version = (requestVersion.get(videoId) || 0) + 1;
    requestVersion.set(videoId, version);
    inFlight.set(videoId, version);
    const progressTimers = [];
    let watchdogTimer = null;
    let settled = false;
    const clearProgressTimers = () => {
      while (progressTimers.length > 0) {
        const timer = progressTimers.pop();
        if (timer) clearTimeout(timer);
      }
    };
    const clearAllTimers = () => {
      clearProgressTimers();
      if (watchdogTimer) {
        clearTimeout(watchdogTimer);
        watchdogTimer = null;
      }
    };
    const sendLoading = (message) => {
      if (settled) return;
      const activeVersion = requestVersion.get(videoId);
      if (activeVersion !== version) return;
      chrome.tabs.sendMessage(tabId, { type: 'ANALYSIS_LOADING', videoId, message });
    };

    // 4. Tell content script we're loading
    log('Sending ANALYSIS_LOADING for', videoId);
    sendLoading('Fetching transcript and metadata...');
    progressTimers.push(setTimeout(() => sendLoading('Extracting factual claims...'), 1800));
    progressTimers.push(setTimeout(() => sendLoading('Searching trusted web sources...'), 4200));
    progressTimers.push(setTimeout(() => sendLoading('Verifying claims against evidence...'), 6800));
    progressTimers.push(setTimeout(() => sendLoading('Finalizing report...'), 9800));
    const requestWatchdogMs = priority === 'low' ? 40000 : 38000;
    watchdogTimer = setTimeout(() => {
      if (settled) return;
      const activeVersion = requestVersion.get(videoId);
      if (activeVersion !== version) return;
      settled = true;
      clearAllTimers();
      inFlight.delete(videoId);
      warn('Request watchdog timeout for', videoId, `(${requestWatchdogMs}ms)`);
      chrome.tabs.sendMessage(tabId, {
        type: 'ANALYSIS_ERROR',
        videoId,
        error: 'Analysis timed out while processing this Short.',
      });
    }, requestWatchdogMs);

    // 5. Call the backend
    log('Fetching from backend:', `${API_BASE}/api/analyze`);
    fetch(`${API_BASE}/api/analyze`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        videoId,
        priority,
        ...(forceRefresh && { forceRefresh: true }),
        ...(model && { model }),
      })
    })
      .then(res => {
        log('Backend response status:', res.status);
        if (!res.ok) throw new Error(`Backend returned ${res.status}`);
        return res.json();
      })
      .then(data => {
        const activeVersion = requestVersion.get(videoId);
        if (activeVersion !== version) {
          clearAllTimers();
          log('Ignoring stale backend result for', videoId, `version=${version}`, `active=${activeVersion}`);
          return;
        }
        settled = true;
        clearAllTimers();
        log('Backend success for', videoId, '- status:', data.status, 'claims:', data.claims?.length);
        const searchDiag = data?.benchmark?.diagnostics?.search;
        if (searchDiag) {
          log(
            'Search diagnostics:',
            `queries=${searchDiag.queryCount}`,
            `results=${searchDiag.totalResults}`,
            `timeouts=${searchDiag.timedOutQueries}`,
            `failed=${searchDiag.failedQueries}`
          );
        }

        if (hasEvidenceIntegrityIssue(data)) {
          warn('Evidence integrity check failed for', videoId, '- not rendering this result');
          inFlight.delete(videoId);
          chrome.tabs.sendMessage(tabId, {
            type: 'ANALYSIS_ERROR',
            videoId,
            error: 'Verification evidence was incomplete. Please regenerate and try again.',
          });
          return;
        }

        // Only cache good results — don't persist transient errors so retries get a fresh shot
        if (data.status !== 'error') {
          memoryCache.set(videoId, data);
          chrome.storage.local.set({ [videoId]: data });
        } else {
          log('Not caching error result for', videoId, ':', data.error);
        }
        inFlight.delete(videoId);

        chrome.tabs.sendMessage(tabId, {
          type: 'ANALYSIS_RESULT',
          videoId,
          data
        });
      })
      .catch(err => {
        const activeVersion = requestVersion.get(videoId);
        if (activeVersion !== version) {
          clearAllTimers();
          log('Ignoring stale backend error for', videoId, `version=${version}`, `active=${activeVersion}`);
          return;
        }
        settled = true;
        clearAllTimers();
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
