const LOG_PREFIX = '[FactCheck]';
function log(...args) { console.log(LOG_PREFIX, ...args); }
function warn(...args) { console.warn(LOG_PREFIX, ...args); }

let currentVideoId = null;
let sidebarVisible = false;
let sidebarContainer = null;
let triggerButton = null;
let injectRetryCount = 0;
const MAX_INJECT_RETRIES = 20;
const NAVIGATION_DEBOUNCE_MS = 220;
const REQUEST_COOLDOWN_MS = 1000;
const LOADING_TIMEOUT_MS = 30000;

// Local result cache — analysis starts on navigation, results stored here
// so the sidebar can display instantly when opened.
let cachedResults = {};
let pendingVideoIds = new Set();
let loadingWatchdogs = new Map();
let extensionContextInvalidated = false;
let navigationDebounceTimer = null;
let lastRequestedVideoId = null;
let lastRequestedAtMs = 0;
const SUPPORTED_MODELS = new Set([
  'gemini-2.5-flash',
  'gemini-2.5-flash-lite',
  'gemini-2.5-pro',
  'gemini-3-flash-preview',
]);

log('Content script loaded on', window.location.href);

// ----- VIDEO ID DETECTION -----

function getVideoIdFromUrl() {
  const match = window.location.pathname.match(/\/shorts\/([a-zA-Z0-9_-]{11})/);
  return match ? match[1] : null;
}

function isOnShortsPage() {
  return /\/shorts\//.test(window.location.pathname);
}

// Strategy 1: YouTube SPA navigation event
document.addEventListener('yt-navigate-finish', () => {
  log('yt-navigate-finish fired');
  scheduleNavigationChange();
});

// Strategy 2: MutationObserver on the shorts container
const reelObserver = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    if (mutation.type === 'childList' || mutation.type === 'attributes') {
      scheduleNavigationChange();
      break;
    }
  }
});

let observerAttached = false;
function startReelObserver() {
  if (observerAttached) return true;
  const shortsContainer = document.querySelector('ytd-shorts');
  if (shortsContainer) {
    reelObserver.observe(shortsContainer, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: ['is-active', 'active', 'selected']
    });
    observerAttached = true;
    log('MutationObserver attached to ytd-shorts');
    return true;
  }
  return false;
}

// Strategy 3: Polling fallback
let lastPolledVideoId = null;
setInterval(() => {
  if (!isOnShortsPage()) {
    if (sidebarVisible) closeSidebar();
    if (triggerButton) removeTriggerButton();
    currentVideoId = null;
    return;
  }

  const id = getVideoIdFromUrl();
  if (id && id !== lastPolledVideoId) {
    lastPolledVideoId = id;
    log('Polling detected new videoId:', id);
    scheduleNavigationChange();
  }

  startReelObserver();
}, 1000);

// ----- NAVIGATION HANDLER -----

function scheduleNavigationChange() {
  if (extensionContextInvalidated) return;
  if (navigationDebounceTimer) clearTimeout(navigationDebounceTimer);
  navigationDebounceTimer = setTimeout(() => {
    navigationDebounceTimer = null;
    handleNavigationChange();
  }, NAVIGATION_DEBOUNCE_MS);
}

function handleNavigationChange() {
  if (extensionContextInvalidated) return;
  if (!isOnShortsPage()) return;

  const videoId = getVideoIdFromUrl();
  if (!videoId || videoId === currentVideoId) return;

  log('New Short detected:', videoId);
  currentVideoId = videoId;
  injectRetryCount = 0;

  injectTriggerButton();
  triggerBackendAnalysis(videoId);

  // If sidebar is already open, show loading or cached result for the new video
  if (sidebarVisible) {
    showCurrentState();
  }
}

// ----- ANALYSIS (decoupled from sidebar) -----

function onExtensionContextInvalidated(error) {
  if (extensionContextInvalidated) return;
  extensionContextInvalidated = true;
  warn('Extension context invalidated. Reload this YouTube tab to reconnect.', error);
  pendingVideoIds.clear();
  if (navigationDebounceTimer) {
    clearTimeout(navigationDebounceTimer);
    navigationDebounceTimer = null;
  }
  for (const timer of loadingWatchdogs.values()) clearTimeout(timer);
  loadingWatchdogs.clear();

  if (sidebarVisible && window.updateFactCheckSidebar) {
    window.updateFactCheckSidebar({
      state: 'error',
      loadingMessage: null,
      errorMessage: 'Extension reloaded or updated. Refresh this YouTube tab, then try again.',
      contextInvalidated: true,
    });
  }
}

function sendAnalyzeMessage(payload) {
  try {
    if (extensionContextInvalidated || !chrome?.runtime?.id) {
      throw new Error('Extension context invalidated');
    }
    chrome.runtime.sendMessage(payload, () => {
      const lastErr = chrome.runtime?.lastError;
      if (lastErr) {
        warn('runtime.sendMessage lastError:', lastErr.message);
        if (lastErr.message && /Extension context invalidated/i.test(lastErr.message)) {
          onExtensionContextInvalidated(lastErr);
        }
      }
    });
    return true;
  } catch (error) {
    onExtensionContextInvalidated(error);
    return false;
  }
}

function triggerBackendAnalysis(videoId) {
  if (extensionContextInvalidated) return;
  if (cachedResults[videoId] || pendingVideoIds.has(videoId)) {
    log('Skipping analysis — already cached or in-flight:', videoId);
    return;
  }
  const now = Date.now();
  if (videoId === lastRequestedVideoId && now - lastRequestedAtMs < REQUEST_COOLDOWN_MS) {
    log('Skipping duplicate request within cooldown for', videoId);
    return;
  }
  const model = getModelOverride();
  log('Auto-triggering analysis for', videoId, model ? `(model=${model})` : '');
  pendingVideoIds.add(videoId);
  const payload = {
    type: 'ANALYZE_SHORT',
    videoId: videoId,
    priority: sidebarVisible ? 'high' : 'low',
    ...(model && { model }),
  };
  const sent = sendAnalyzeMessage(payload);
  if (!sent) {
    pendingVideoIds.delete(videoId);
  } else {
    lastRequestedVideoId = videoId;
    lastRequestedAtMs = now;
  }
}

function regenerateCurrentVideo() {
  if (extensionContextInvalidated) {
    onExtensionContextInvalidated(new Error('Extension context invalidated'));
    return;
  }
  if (!currentVideoId) {
    warn('Regenerate ignored: no active Shorts video ID');
    return;
  }
  const model = getModelOverride();
  log('Regenerating analysis for', currentVideoId, model ? `(model=${model})` : '');
  delete cachedResults[currentVideoId];
  pendingVideoIds.delete(currentVideoId);
  pendingVideoIds.add(currentVideoId);

  if (sidebarVisible && window.updateFactCheckSidebar) {
    window.updateFactCheckSidebar({
      state: 'loading',
      loadingMessage: 'Regenerating with fresh data...',
      contextInvalidated: false,
    });
  }

  const sent = sendAnalyzeMessage({
    type: 'ANALYZE_SHORT',
    videoId: currentVideoId,
    priority: 'high',
    forceRefresh: true,
    ...(model && { model }),
  });
  if (!sent) {
    pendingVideoIds.delete(currentVideoId);
  } else {
    lastRequestedVideoId = currentVideoId;
    lastRequestedAtMs = Date.now();
  }
}

function getModelOverride() {
  const candidates = ['factcheck_model', 'watchout_model', 'factcheckModel', 'watchoutModel'];
  try {
    for (const key of candidates) {
      const value = window.localStorage.getItem(key);
      if (value && SUPPORTED_MODELS.has(value)) return value;
    }
  } catch (error) {
    warn('Could not read model override from localStorage:', error);
  }
  return null;
}

function displayResult(videoId, data) {
  if (!window.updateFactCheckSidebar) return;
  log('Displaying result for', videoId, '— status:', data.status, 'claims:', data.claims?.length);

  if (data.status === 'error') {
    window.updateFactCheckSidebar({
      state: 'error',
      errorMessage: data.error || 'Analysis failed for this video.',
      contextInvalidated: false,
    });
  } else if (data.status === 'no_transcript') {
    window.updateFactCheckSidebar({
      state: 'no_transcript',
      metadata: data.metadata,
      contextInvalidated: false,
    });
  } else {
    window.updateFactCheckSidebar({
      state: 'result',
      metadata: data.metadata,
      overallScore: data.overallScore,
      claims: data.claims,
      transcriptPreview: data.transcript_preview,
      loadingMessage: null,
      contextInvalidated: false,
    });
  }
}

function showCurrentState() {
  if (!window.updateFactCheckSidebar) return;
  if (extensionContextInvalidated) {
    window.updateFactCheckSidebar({
      state: 'error',
      loadingMessage: null,
      errorMessage: 'Extension context invalidated. Refresh this YouTube tab to continue.',
      contextInvalidated: true,
    });
    return;
  }
  if (currentVideoId && cachedResults[currentVideoId]) {
    displayResult(currentVideoId, cachedResults[currentVideoId]);
  } else {
    window.updateFactCheckSidebar({
      state: 'loading',
      loadingMessage: 'Starting analysis...',
      contextInvalidated: false,
    });
  }
}

function clearLoadingWatchdog(videoId) {
  const timer = loadingWatchdogs.get(videoId);
  if (timer) {
    clearTimeout(timer);
    loadingWatchdogs.delete(videoId);
  }
}

function startLoadingWatchdog(videoId) {
  clearLoadingWatchdog(videoId);
  const timer = setTimeout(() => {
    loadingWatchdogs.delete(videoId);
    pendingVideoIds.delete(videoId);
    if (sidebarVisible && videoId === currentVideoId && window.updateFactCheckSidebar) {
      window.updateFactCheckSidebar({
        state: 'error',
        loadingMessage: null,
        errorMessage: 'Analysis timed out while scrolling. Try regenerate or pause briefly on this Short.',
        contextInvalidated: false,
      });
    }
  }, LOADING_TIMEOUT_MS);
  loadingWatchdogs.set(videoId, timer);
}

// ----- FIND THE ACTIVE RENDERER -----

function findActiveRenderer() {
  return (
    document.querySelector('ytd-reel-video-renderer[is-active]') ||
    document.querySelector('ytd-reel-video-renderer[active]') ||
    document.querySelector('ytd-reel-video-renderer[selected]') ||
    document.querySelector('ytd-reel-video-renderer')
  );
}

// ----- FIND THE ACTIONS CONTAINER -----

function findActionsContainer(renderer) {
  let actions = renderer.querySelector('#actions');
  if (actions) return actions;

  actions = renderer.querySelector('ytd-reel-player-overlay-renderer #actions');
  if (actions) return actions;

  const parent = renderer.closest('.reel-video-in-sequence-new') || renderer.parentElement;
  if (parent) {
    actions = parent.querySelector('#actions');
    if (actions) return actions;
  }

  const shortsEl = document.querySelector('ytd-shorts');
  if (shortsEl) {
    actions = shortsEl.querySelector('#actions');
    if (actions) return actions;
  }

  actions = document.querySelector('ytd-shorts #actions, ytd-reel-video-renderer #actions');
  if (actions) return actions;

  return null;
}

// ----- TRIGGER BUTTON -----

function injectTriggerButton() {
  removeTriggerButton();

  const activeRenderer = findActiveRenderer();
  if (!activeRenderer) {
    injectRetryCount++;
    if (injectRetryCount <= MAX_INJECT_RETRIES) {
      setTimeout(injectTriggerButton, 500);
    } else {
      warn('Gave up finding renderer after', MAX_INJECT_RETRIES, 'retries');
    }
    return;
  }

  const actionsContainer = findActionsContainer(activeRenderer);

  if (!actionsContainer) {
    injectRetryCount++;
    if (injectRetryCount <= MAX_INJECT_RETRIES) {
      setTimeout(injectTriggerButton, 500);
    } else {
      warn('Gave up finding #actions — falling back to floating button');
      injectFloatingButton();
    }
    return;
  }

  createAndInsertButton(actionsContainer);
}

function injectFloatingButton() {
  const wrapper = document.createElement('div');
  wrapper.id = 'yt-factcheck-trigger-wrapper';
  Object.assign(wrapper.style, {
    position: 'fixed',
    right: '24px',
    bottom: '120px',
    zIndex: '2147483646',
  });
  createAndInsertButton(wrapper);
  document.body.appendChild(wrapper);
}

function createAndInsertButton(container) {
  if (!document.getElementById('watchout-rubik-font')) {
    const fontLink = document.createElement('link');
    fontLink.id = 'watchout-rubik-font';
    fontLink.rel = 'stylesheet';
    fontLink.href = 'https://fonts.googleapis.com/css2?family=Rubik:wght@400;500;600;700&display=swap';
    document.head.appendChild(fontLink);
  }

  triggerButton = document.createElement('button');
  triggerButton.id = 'yt-factcheck-trigger';
  triggerButton.innerHTML = `
    <div style="
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: linear-gradient(145deg, #3a3a3a, #2c2c2c);
      border: 1px solid rgba(255, 255, 255, 0.16);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all 0.2s ease;
      box-shadow: 0 2px 10px rgba(0, 0, 0, 0.35);
      margin-bottom: 8px;
    ">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7"/>
        <circle cx="12" cy="12" r="3"/>
      </svg>
    </div>
    <span style="
      color: #abb2bf;
      font-size: 10px;
      text-align: center;
      display: block;
      margin-top: -4px;
      margin-bottom: 12px;
      font-family: 'Rubik', Arial, sans-serif;
    ">Verify</span>
  `;
  triggerButton.style.cssText = `
    background: none;
    border: none;
    padding: 0;
    cursor: pointer;
    display: flex;
    flex-direction: column;
    align-items: center;
    outline: none;
  `;

  const circle = triggerButton.querySelector('div');
  triggerButton.addEventListener('mouseenter', () => {
    circle.style.background = 'linear-gradient(145deg, #454545, #343434)';
    circle.style.borderColor = 'rgba(255, 255, 255, 0.26)';
  });
  triggerButton.addEventListener('mouseleave', () => {
    circle.style.background = 'linear-gradient(145deg, #3a3a3a, #2c2c2c)';
    circle.style.borderColor = 'rgba(255, 255, 255, 0.16)';
  });

  triggerButton.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    toggleSidebar();
  });

  container.insertBefore(triggerButton, container.firstChild);
}

function removeTriggerButton() {
  const existing = document.getElementById('yt-factcheck-trigger');
  if (existing) existing.remove();
  const wrapper = document.getElementById('yt-factcheck-trigger-wrapper');
  if (wrapper) wrapper.remove();
  triggerButton = null;
}

// ----- SIDEBAR MANAGEMENT -----

function createSidebarContainer() {
  if (document.getElementById('yt-factcheck-sidebar')) return;

  sidebarContainer = document.createElement('div');
  sidebarContainer.id = 'yt-factcheck-sidebar';
  Object.assign(sidebarContainer.style, {
    position: 'fixed',
    right: '12px',
    top: '12px',
    height: 'calc(100vh - 24px)',
    width: '380px',
    zIndex: '2147483647',
    display: 'none',
  });
  document.body.appendChild(sidebarContainer);

  if (window.mountFactCheckSidebar) {
    window.mountFactCheckSidebar(sidebarContainer);
  } else {
    warn('mountFactCheckSidebar not found — sidebar.js may not be loaded');
  }
}

function toggleSidebar() {
  if (!sidebarContainer) createSidebarContainer();

  if (sidebarVisible) {
    closeSidebar();
  } else {
    openSidebar();
  }
}

function openSidebar() {
  if (!sidebarContainer) createSidebarContainer();

  sidebarContainer.style.display = 'block';
  sidebarVisible = true;
  log('Sidebar opened');

  showCurrentState();
}

function closeSidebar() {
  if (sidebarContainer) {
    sidebarContainer.style.display = 'none';
  }
  sidebarVisible = false;
  log('Sidebar closed');

  if (window.updateFactCheckSidebar) {
    window.updateFactCheckSidebar({ state: 'idle' });
  }
}

window.addEventListener('factcheck-close-sidebar', () => closeSidebar());
window.addEventListener('factcheck-regenerate-current', () => regenerateCurrentVideo());
window.addEventListener('error', (event) => {
  const message = String(event?.error?.message || event?.message || '');
  if (/Extension context invalidated/i.test(message)) {
    event.preventDefault();
    onExtensionContextInvalidated(event.error || new Error(message));
  }
});

// ----- LISTEN FOR RESULTS FROM SERVICE WORKER -----

if (chrome?.runtime?.onMessage?.addListener) {
  chrome.runtime.onMessage.addListener((msg) => {
    log('Received message:', msg.type, msg.videoId);

    if (msg.type === 'ANALYSIS_RESULT' && msg.videoId) {
      clearLoadingWatchdog(msg.videoId);
      cachedResults[msg.videoId] = msg.data;
      pendingVideoIds.delete(msg.videoId);

      if (msg.videoId !== currentVideoId) {
        log('Received stale ANALYSIS_RESULT for non-current video:', msg.videoId, 'current:', currentVideoId);
      }

      if (sidebarVisible && msg.videoId === currentVideoId) {
        displayResult(msg.videoId, msg.data);
      }
    }

    if (msg.type === 'ANALYSIS_LOADING' && msg.videoId === currentVideoId) {
      pendingVideoIds.add(msg.videoId);
      startLoadingWatchdog(msg.videoId);
      if (sidebarVisible && window.updateFactCheckSidebar) {
        window.updateFactCheckSidebar({
          state: 'loading',
          loadingMessage: msg.message || 'Analyzing claims...',
          contextInvalidated: false,
        });
      }
    }

    if (msg.type === 'ANALYSIS_ERROR' && msg.videoId) {
      clearLoadingWatchdog(msg.videoId);
      pendingVideoIds.delete(msg.videoId);
      cachedResults[msg.videoId] = {
        status: 'error',
        error: msg.error || 'Unknown error from backend',
      };

      if (sidebarVisible && msg.videoId === currentVideoId) {
        if (window.updateFactCheckSidebar) {
          window.updateFactCheckSidebar({
            state: 'error',
            errorMessage: msg.error || 'Analysis failed. Is the backend running on localhost:3000?',
            loadingMessage: null,
            contextInvalidated: false,
          });
        }
      }
    }
  });
}

// ----- INIT -----
log('isOnShortsPage:', isOnShortsPage(), '| videoId:', getVideoIdFromUrl());
if (isOnShortsPage()) {
  scheduleNavigationChange();
}
