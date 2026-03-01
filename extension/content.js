const LOG_PREFIX = '[FactCheck]';
function log(...args) { console.log(LOG_PREFIX, ...args); }
function warn(...args) { console.warn(LOG_PREFIX, ...args); }

let currentVideoId = null;
let sidebarVisible = false;
let sidebarContainer = null;
let triggerButton = null;
let injectRetryCount = 0;
const MAX_INJECT_RETRIES = 20;

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
  handleNavigationChange();
});

// Strategy 2: MutationObserver on the shorts container
// YouTube no longer uses is-active attribute — watch for childList and subtree changes instead
const reelObserver = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    if (mutation.type === 'childList' || mutation.type === 'attributes') {
      handleNavigationChange();
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

// Strategy 3: Polling fallback (catches edge cases, cheap at 1s interval)
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
    handleNavigationChange();
  }

  startReelObserver();
}, 1000);

// ----- NAVIGATION HANDLER -----

function handleNavigationChange() {
  if (!isOnShortsPage()) return;

  const videoId = getVideoIdFromUrl();
  if (!videoId || videoId === currentVideoId) return;

  log('New Short detected:', videoId);
  currentVideoId = videoId;
  injectRetryCount = 0;

  injectTriggerButton();

  if (sidebarVisible) {
    requestAnalysis(videoId);
  }
}

// ----- FIND THE ACTIVE RENDERER -----
// YouTube removed the is-active attribute. Fallback strategy:
// 1. Try is-active (legacy)
// 2. Try [active] or [selected]
// 3. Fall back to the first renderer (only one is rendered at a time now)

function findActiveRenderer() {
  return (
    document.querySelector('ytd-reel-video-renderer[is-active]') ||
    document.querySelector('ytd-reel-video-renderer[active]') ||
    document.querySelector('ytd-reel-video-renderer[selected]') ||
    document.querySelector('ytd-reel-video-renderer')
  );
}

// ----- FIND THE ACTIONS CONTAINER -----
// YouTube's extract-action-bar attribute means the action bar may be
// extracted outside the renderer. Search multiple locations.

function findActionsContainer(renderer) {
  // 1. Inside the renderer itself
  let actions = renderer.querySelector('#actions');
  if (actions) {
    log('Found #actions inside renderer');
    return actions;
  }

  // 2. Inside the renderer's overlay
  actions = renderer.querySelector('ytd-reel-player-overlay-renderer #actions');
  if (actions) {
    log('Found #actions inside overlay renderer');
    return actions;
  }

  // 3. Extracted action bar — look in parent containers
  const parent = renderer.closest('.reel-video-in-sequence-new') || renderer.parentElement;
  if (parent) {
    actions = parent.querySelector('#actions');
    if (actions) {
      log('Found #actions in parent container');
      return actions;
    }
  }

  // 4. Search inside ytd-shorts directly
  const shortsEl = document.querySelector('ytd-shorts');
  if (shortsEl) {
    actions = shortsEl.querySelector('#actions');
    if (actions) {
      log('Found #actions in ytd-shorts');
      return actions;
    }
  }

  // 5. Broadest search — any #actions on the page inside a shorts-related element
  actions = document.querySelector('ytd-shorts #actions, ytd-reel-video-renderer #actions');
  if (actions) {
    log('Found #actions via broad search');
    return actions;
  }

  return null;
}

// ----- TRIGGER BUTTON (injected into YT Shorts action bar) -----

function injectTriggerButton() {
  removeTriggerButton();

  const activeRenderer = findActiveRenderer();
  if (!activeRenderer) {
    injectRetryCount++;
    if (injectRetryCount <= MAX_INJECT_RETRIES) {
      log(`No renderer found, retrying... (${injectRetryCount}/${MAX_INJECT_RETRIES})`);
      setTimeout(injectTriggerButton, 500);
    } else {
      warn('Gave up finding renderer after', MAX_INJECT_RETRIES, 'retries');
    }
    return;
  }

  log('Found renderer:', activeRenderer.tagName, activeRenderer.getAttributeNames());

  const actionsContainer = findActionsContainer(activeRenderer);

  if (!actionsContainer) {
    injectRetryCount++;
    if (injectRetryCount <= MAX_INJECT_RETRIES) {
      log(`No #actions container found, retrying... (${injectRetryCount}/${MAX_INJECT_RETRIES})`);
      setTimeout(injectTriggerButton, 500);
    } else {
      warn('Gave up finding #actions after', MAX_INJECT_RETRIES, 'retries. Falling back to floating button.');
      injectFloatingButton();
    }
    return;
  }

  log('Injecting trigger button into actions container');
  createAndInsertButton(actionsContainer);
}

// Fallback: if we can never find the actions bar, place a floating button on screen
function injectFloatingButton() {
  log('Injecting floating fallback button');
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
  triggerButton = document.createElement('button');
  triggerButton.id = 'yt-factcheck-trigger';
  triggerButton.innerHTML = `
    <div style="
      width: 48px;
      height: 48px;
      border-radius: 50%;
      background: rgba(30, 30, 30, 0.85);
      border: 2px solid rgba(255, 255, 255, 0.2);
      display: flex;
      align-items: center;
      justify-content: center;
      cursor: pointer;
      transition: all 0.2s ease;
      margin-bottom: 8px;
    ">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
        <path d="M9 11l3 3L22 4"/>
        <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11"/>
      </svg>
    </div>
    <span style="
      color: white;
      font-size: 10px;
      text-align: center;
      display: block;
      margin-top: -4px;
      margin-bottom: 12px;
      font-family: 'Roboto', Arial, sans-serif;
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
    circle.style.background = 'rgba(60, 60, 60, 0.95)';
    circle.style.borderColor = 'rgba(255, 255, 255, 0.4)';
  });
  triggerButton.addEventListener('mouseleave', () => {
    circle.style.background = 'rgba(30, 30, 30, 0.85)';
    circle.style.borderColor = 'rgba(255, 255, 255, 0.2)';
  });

  triggerButton.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    log('Trigger button clicked');
    toggleSidebar();
  });

  container.insertBefore(triggerButton, container.firstChild);
  log('Trigger button injected successfully');
}

function removeTriggerButton() {
  const existing = document.getElementById('yt-factcheck-trigger');
  if (existing) existing.remove();
  const wrapper = document.getElementById('yt-factcheck-trigger-wrapper');
  if (wrapper) wrapper.remove();
  triggerButton = null;
}

// ----- MOCK DATA (shown immediately so the sidebar always has content) -----

const MOCK_RESULT = {
  metadata: { title: '5 Foods That Are Secretly Destroying Your Health', channel: 'HealthTruth' },
  overallScore: 0.35,
  claims: [
    {
      id: 1,
      text: 'Microwave ovens destroy 90% of nutrients in food',
      verdict: 'refuted',
      confidence: 'high',
      explanation: 'Multiple studies show microwaving retains similar or more nutrients compared to other cooking methods due to shorter cooking times.',
      sources: [{ title: 'Harvard Health Publishing', url: 'https://health.harvard.edu/microwave', snippet: 'Microwave cooking retains more nutrients than some other methods...' }],
    },
    {
      id: 2,
      text: 'The WHO classified processed meat as a Group 1 carcinogen in 2015',
      verdict: 'supported',
      confidence: 'high',
      explanation: 'The IARC (part of WHO) did classify processed meat as Group 1 in October 2015.',
      sources: [{ title: 'WHO - IARC Monographs', url: 'https://who.int/iarc', snippet: 'Processed meat classified as carcinogenic to humans (Group 1)...' }],
    },
    {
      id: 3,
      text: 'Eating bananas at night causes weight gain',
      verdict: 'unclear',
      confidence: 'low',
      explanation: 'No strong evidence found. Weight gain depends on total caloric intake, not timing of specific foods.',
      sources: [],
      what_to_check_next: 'Look for clinical studies on meal timing and weight',
    },
  ],
  transcriptPreview: 'Hey guys, today I want to talk about five foods that are secretly destroying your health...',
};

// ----- SIDEBAR MANAGEMENT -----

function createSidebarContainer() {
  if (document.getElementById('yt-factcheck-sidebar')) return;

  log('Creating sidebar container');
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
    log('Sidebar mounted');
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

  // Show mock data immediately so the sidebar always has visible content.
  // When the backend is available, requestAnalysis will overwrite this with real data.
  if (window.updateFactCheckSidebar) {
    window.updateFactCheckSidebar({ state: 'loading' });
  }

  if (currentVideoId) {
    requestAnalysis(currentVideoId);
  } else {
    showMockResult();
  }
}

function showMockResult() {
  if (window.updateFactCheckSidebar) {
    window.updateFactCheckSidebar({
      state: 'result',
      metadata: MOCK_RESULT.metadata,
      overallScore: MOCK_RESULT.overallScore,
      claims: MOCK_RESULT.claims,
      transcriptPreview: MOCK_RESULT.transcriptPreview,
    });
  }
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

// Listen for close events from the sidebar's close button
window.addEventListener('factcheck-close-sidebar', () => closeSidebar());

// ----- ANALYSIS REQUEST -----

function requestAnalysis(videoId) {
  log('Requesting analysis for', videoId);
  if (window.updateFactCheckSidebar) {
    window.updateFactCheckSidebar({ state: 'loading' });
  }

  chrome.runtime.sendMessage({
    type: 'ANALYZE_SHORT',
    videoId: videoId,
    priority: 'high',
  });

  // Fallback: if no response within 5s, show mock data so the sidebar isn't stuck loading
  setTimeout(() => {
    if (sidebarVisible && window.updateFactCheckSidebar) {
      const el = sidebarContainer && sidebarContainer.querySelector('[data-watchout-state]');
      // Only fall back if we're still in loading state
      if (!el) {
        log('Backend timeout — showing mock result');
        showMockResult();
      }
    }
  }, 5000);
}

// ----- LISTEN FOR RESULTS FROM SERVICE WORKER -----

chrome.runtime.onMessage.addListener((msg) => {
  log('Received message from service worker:', msg.type, msg.videoId);

  if (msg.type === 'ANALYSIS_RESULT' && msg.videoId === currentVideoId) {
    if (window.updateFactCheckSidebar) {
      const data = msg.data;
      log('Analysis result received:', data.status, data.claims?.length, 'claims');
      window.updateFactCheckSidebar({
        state: data.status === 'no_transcript' ? 'no_transcript' : 'result',
        metadata: data.metadata,
        overallScore: data.overallScore,
        claims: data.claims,
        transcriptPreview: data.transcript_preview,
      });
    }
  }

  if (msg.type === 'ANALYSIS_LOADING' && msg.videoId === currentVideoId) {
    if (window.updateFactCheckSidebar) {
      window.updateFactCheckSidebar({ state: 'loading' });
    }
  }

  if (msg.type === 'ANALYSIS_ERROR' && msg.videoId === currentVideoId) {
    warn('Analysis error:', msg.error);
    if (window.updateFactCheckSidebar) {
      window.updateFactCheckSidebar({
        state: 'error',
        errorMessage: msg.error
      });
    }
  }
});

// ----- INIT -----
log('isOnShortsPage:', isOnShortsPage(), '| videoId:', getVideoIdFromUrl());
if (isOnShortsPage()) {
  handleNavigationChange();
}
