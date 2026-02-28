/**
 * Tests for extension/sidebar.js (plain JS sidebar UI)
 * Loaded via JSDOM to simulate the browser environment.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { JSDOM } from 'jsdom';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const sidebarCode = readFileSync(resolve(__dirname, '..', '..', '..', 'extension', 'sidebar.js'), 'utf8');

function createEnv() {
  const dom = new JSDOM('<!DOCTYPE html><html><body><div id="mount"></div></body></html>', {
    runScripts: 'dangerously',
    url: 'https://www.youtube.com/shorts/abc123',
  });
  dom.window.eval(sidebarCode);
  const container = dom.window.document.getElementById('mount');
  dom.window.mountFactCheckSidebar(container);
  return { dom, window: dom.window, container, document: dom.window.document };
}

const MOCK_CLAIMS = [
  {
    id: 1, text: 'Microwave ovens destroy 90% of nutrients', verdict: 'refuted', confidence: 'high',
    explanation: 'Multiple studies show microwaving retains nutrients.',
    sources: [{ title: 'Harvard Health', url: 'https://example.com', snippet: 'Retains nutrients...' }],
  },
  {
    id: 2, text: 'WHO classified processed meat as carcinogen', verdict: 'supported', confidence: 'high',
    explanation: 'IARC classified processed meat as Group 1.',
    sources: [{ title: 'WHO', url: 'https://who.int', snippet: 'Group 1 carcinogen...' }],
  },
  {
    id: 3, text: 'Bananas at night cause weight gain', verdict: 'unclear', confidence: 'low',
    explanation: 'No strong evidence.',
    sources: [],
    what_to_check_next: 'Check meal timing studies',
  },
];

describe('sidebar.js — public API', () => {
  it('exposes mountFactCheckSidebar and updateFactCheckSidebar', () => {
    const { window } = createEnv();
    expect(typeof window.mountFactCheckSidebar).toBe('function');
    expect(typeof window.updateFactCheckSidebar).toBe('function');
  });
});

describe('sidebar.js — idle state', () => {
  it('renders nothing in idle state', () => {
    const { container } = createEnv();
    expect(container.children.length).toBe(0);
  });
});

describe('sidebar.js — loading state', () => {
  it('shows "Watch Out" brand and "Analyzing claims..."', () => {
    const { container, window } = createEnv();
    window.updateFactCheckSidebar({ state: 'loading' });

    expect(container.textContent).toContain('Watch Out');
    expect(container.textContent).toContain('Analyzing claims...');
  });

  it('has a close button', () => {
    const { container, window } = createEnv();
    window.updateFactCheckSidebar({ state: 'loading' });

    const closeBtn = container.querySelector('[aria-label="Close sidebar"]');
    expect(closeBtn).not.toBeNull();
  });
});

describe('sidebar.js — result state', () => {
  let env;

  beforeEach(() => {
    env = createEnv();
    env.window.updateFactCheckSidebar({
      state: 'result',
      metadata: { title: 'Test Video', channel: 'TestChan' },
      overallScore: 0.35,
      claims: MOCK_CLAIMS,
    });
  });

  it('shows metadata title and channel', () => {
    expect(env.container.textContent).toContain('Test Video');
    expect(env.container.textContent).toContain('TestChan');
  });

  it('shows verification bar with correct percentage', () => {
    expect(env.container.textContent).toContain('35%');
    expect(env.container.textContent).toContain('Weakly Supported');
  });

  it('shows claim count', () => {
    expect(env.container.textContent).toContain('3 claims analyzed');
  });

  it('renders all three claims', () => {
    expect(env.container.textContent).toContain('Microwave ovens destroy 90% of nutrients');
    expect(env.container.textContent).toContain('WHO classified processed meat');
    expect(env.container.textContent).toContain('Bananas at night cause weight gain');
  });

  it('shows verdict labels', () => {
    expect(env.container.textContent).toContain('Refuted');
    expect(env.container.textContent).toContain('Supported');
    expect(env.container.textContent).toContain('Unclear');
  });

  it('claim cards start collapsed (details div hidden)', () => {
    const btns = env.container.querySelectorAll('[role="button"]');
    expect(btns[0].getAttribute('aria-expanded')).toBe('false');
  });

  it('clicking a claim expands it to show explanation', () => {
    const btn = env.container.querySelector('[role="button"]');
    btn.click();
    expect(env.container.textContent).toContain('Multiple studies show microwaving retains');
    expect(btn.getAttribute('aria-expanded')).toBe('true');
  });

  it('clicking again collapses the claim', () => {
    const btn = env.container.querySelector('[role="button"]');
    btn.click();
    btn.click();
    expect(btn.getAttribute('aria-expanded')).toBe('false');
  });

  it('shows sources when expanded', () => {
    const btn = env.container.querySelector('[role="button"]');
    btn.click();
    expect(env.container.textContent).toContain('Harvard Health');
    const link = env.container.querySelector('a[href="https://example.com"]');
    expect(link).not.toBeNull();
    expect(link.getAttribute('target')).toBe('_blank');
  });

  it('shows what_to_check_next for unclear claims', () => {
    const btns = env.container.querySelectorAll('[role="button"]');
    btns[2].click();
    expect(env.container.textContent).toContain('Check meal timing studies');
  });
});

describe('sidebar.js — score thresholds', () => {
  const cases = [
    { score: 0.9, pct: '90%', label: 'Well Supported' },
    { score: 0.65, pct: '65%', label: 'Mostly Supported' },
    { score: 0.45, pct: '45%', label: 'Mixed Evidence' },
    { score: 0.25, pct: '25%', label: 'Weakly Supported' },
    { score: 0.1, pct: '10%', label: 'Likely Misleading' },
  ];

  cases.forEach(({ score, pct, label }) => {
    it(`score ${score} shows ${pct} and "${label}"`, () => {
      const { container, window } = createEnv();
      window.updateFactCheckSidebar({
        state: 'result', overallScore: score,
        claims: [{ id: 1, text: 'X', verdict: 'supported', confidence: 'high', explanation: 'Y', sources: [] }],
      });
      expect(container.textContent).toContain(pct);
      expect(container.textContent).toContain(label);
    });
  });
});

describe('sidebar.js — error state', () => {
  it('shows custom error message', () => {
    const { container, window } = createEnv();
    window.updateFactCheckSidebar({ state: 'error', errorMessage: 'Backend timeout' });
    expect(container.textContent).toContain('Something went wrong');
    expect(container.textContent).toContain('Backend timeout');
  });

  it('shows default error message when none provided', () => {
    const { container, window } = createEnv();
    window.updateFactCheckSidebar({ state: 'error' });
    expect(container.textContent).toContain('Failed to analyze this Short');
  });
});

describe('sidebar.js — no_transcript state', () => {
  it('shows no transcript message', () => {
    const { container, window } = createEnv();
    window.updateFactCheckSidebar({ state: 'no_transcript' });
    expect(container.textContent).toContain('No Transcript Available');
  });
});

describe('sidebar.js — no claims result', () => {
  it('shows no claims message', () => {
    const { container, window } = createEnv();
    window.updateFactCheckSidebar({ state: 'result', overallScore: null, claims: [] });
    expect(container.textContent).toContain('No verifiable factual claims found');
  });
});

describe('sidebar.js — state transitions', () => {
  it('transitions from loading to result correctly', () => {
    const { container, window } = createEnv();
    window.updateFactCheckSidebar({ state: 'loading' });
    expect(container.textContent).toContain('Analyzing claims...');

    window.updateFactCheckSidebar({
      state: 'result', overallScore: 0.5,
      claims: [{ id: 1, text: 'After transition', verdict: 'unclear', confidence: 'med', explanation: 'E', sources: [] }],
    });
    expect(container.textContent).not.toContain('Analyzing claims...');
    expect(container.textContent).toContain('After transition');
  });

  it('transitioning to idle clears all content', () => {
    const { container, window } = createEnv();
    window.updateFactCheckSidebar({ state: 'loading' });
    expect(container.children.length).toBeGreaterThan(0);

    window.updateFactCheckSidebar({ state: 'idle' });
    expect(container.children.length).toBe(0);
  });
});

describe('sidebar.js — keyboard accessibility', () => {
  it('claim buttons have role=button and tabindex=0', () => {
    const { container, window } = createEnv();
    window.updateFactCheckSidebar({
      state: 'result', overallScore: 0.5,
      claims: [{ id: 1, text: 'KB test', verdict: 'supported', confidence: 'high', explanation: 'Explain', sources: [] }],
    });
    const btn = container.querySelector('[role="button"]');
    expect(btn).not.toBeNull();
    expect(btn.getAttribute('tabindex')).toBe('0');
  });

  it('Enter key toggles expansion', () => {
    const { container, window: win } = createEnv();
    win.updateFactCheckSidebar({
      state: 'result', overallScore: 0.5,
      claims: [{ id: 1, text: 'KB test', verdict: 'supported', confidence: 'high', explanation: 'Explain KB', sources: [] }],
    });
    const btn = container.querySelector('[role="button"]');
    btn.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    expect(btn.getAttribute('aria-expanded')).toBe('true');
    expect(container.textContent).toContain('Explain KB');
  });
});

describe('sidebar.js — confidence dots', () => {
  it('shows correct confidence dots for each level', () => {
    const levels = [
      { confidence: 'low', dots: '\u25CF\u25CB\u25CB' },
      { confidence: 'med', dots: '\u25CF\u25CF\u25CB' },
      { confidence: 'high', dots: '\u25CF\u25CF\u25CF' },
    ];

    levels.forEach(({ confidence, dots }) => {
      const { container, window } = createEnv();
      window.updateFactCheckSidebar({
        state: 'result', overallScore: 0.5,
        claims: [{ id: 1, text: 'Dots', verdict: 'supported', confidence, explanation: 'E', sources: [] }],
      });
      expect(container.textContent).toContain(dots);
    });
  });
});
