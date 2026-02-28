let currentVideoId = null;
let sidebarVisible = false;
let sidebarContainer = null;
let triggerButton = null;

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
  handleNavigationChange();
});

// Strategy 2: MutationObserver on reel renderers (most reliable for scroll)
// The is-active attribute changes when user scrolls to a new Short
const reelObserver = new MutationObserver((mutations) => {
  for (const mutation of mutations) {
    if (mutation.type === 'attributes' && mutation.attributeName === 'is-active') {
      handleNavigationChange();
    }
  }
});

function startReelObserver() {
  const shortsContainer = document.querySelector('ytd-shorts');
  if (shortsContainer) {
    reelObserver.observe(shortsContainer, {
      attributes: true,
      attributeFilter: ['is-active'],
      subtree: true
    });
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
    handleNavigationChange();
  }

  if (!document.querySelector('ytd-shorts')) return;
  startReelObserver();
}, 1000);

// ----- NAVIGATION HANDLER -----

function handleNavigationChange() {
  if (!isOnShortsPage()) return;

  const videoId = getVideoIdFromUrl();
  if (!videoId || videoId === currentVideoId) return;

  currentVideoId = videoId;

  injectTriggerButton();

  if (sidebarVisible) {
    requestAnalysis(videoId);
  }
}

// ----- TRIGGER BUTTON (injected into YT Shorts action bar) -----

function injectTriggerButton() {
  removeTriggerButton();

  const activeRenderer = document.querySelector('ytd-reel-video-renderer[is-active]');
  if (!activeRenderer) {
    setTimeout(injectTriggerButton, 500);
    return;
  }

  const actionsContainer =
    activeRenderer.querySelector('#actions') ||
    activeRenderer.querySelector('ytd-reel-player-overlay-renderer #actions') ||
    activeRenderer.querySelector('[id="actions"]');

  if (!actionsContainer) {
    setTimeout(injectTriggerButton, 500);
    return;
  }

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
    ">Fact Check</span>
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
    toggleSidebar();
  });

  actionsContainer.insertBefore(triggerButton, actionsContainer.firstChild);
}

function removeTriggerButton() {
  const existing = document.getElementById('yt-factcheck-trigger');
  if (existing) existing.remove();
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
    display: 'none'
  });
  document.body.appendChild(sidebarContainer);

  if (window.mountFactCheckSidebar) {
    window.mountFactCheckSidebar(sidebarContainer);
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

  if (currentVideoId) {
    requestAnalysis(currentVideoId);
  }
}

function closeSidebar() {
  if (sidebarContainer) {
    sidebarContainer.style.display = 'none';
  }
  sidebarVisible = false;

  if (window.updateFactCheckSidebar) {
    window.updateFactCheckSidebar({ state: 'idle' });
  }
}

// Listen for close events dispatched by the React sidebar's close button
window.addEventListener('factcheck-close-sidebar', () => closeSidebar());

// ----- ANALYSIS REQUEST -----

function requestAnalysis(videoId) {
  if (window.updateFactCheckSidebar) {
    window.updateFactCheckSidebar({ state: 'loading' });
  }

  chrome.runtime.sendMessage({
    type: 'ANALYZE_SHORT',
    videoId: videoId,
    priority: 'high'
  });
}

// ----- LISTEN FOR RESULTS FROM SERVICE WORKER -----

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === 'ANALYSIS_RESULT' && msg.videoId === currentVideoId) {
    if (window.updateFactCheckSidebar) {
      const data = msg.data;
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
    if (window.updateFactCheckSidebar) {
      window.updateFactCheckSidebar({
        state: 'error',
        errorMessage: msg.error
      });
    }
  }
});

// ----- INIT -----
if (isOnShortsPage()) {
  handleNavigationChange();
}
