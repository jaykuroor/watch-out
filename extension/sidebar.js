// ============================================================
// Plain JS sidebar UI for YouTube Shorts Fact-Checker
// Exposes: window.mountFactCheckSidebar(container)
//          window.updateFactCheckSidebar(props)
// No React, no build step — works directly in content scripts.
// ============================================================

(function () {
  'use strict';

  let _container = null;
  let _state = {
    state: 'idle',
    metadata: null,
    overallScore: null,
    claims: [],
    transcriptPreview: null,
    errorMessage: null,
  };

  // ── Color helpers ──

  function getScoreColor(s) {
    if (s >= 0.7) return '#22c55e';
    if (s >= 0.4) return '#eab308';
    return '#ef4444';
  }

  function getScoreLabel(s) {
    if (s >= 0.8) return 'Well Supported';
    if (s >= 0.6) return 'Mostly Supported';
    if (s >= 0.4) return 'Mixed Evidence';
    if (s >= 0.2) return 'Weakly Supported';
    return 'Likely Misleading';
  }

  const VERDICT_CONFIG = {
    supported: { bg: 'rgba(34,197,94,0.10)', border: 'rgba(34,197,94,0.25)', accent: '#22c55e', icon: '\u2705', label: 'Supported' },
    refuted:   { bg: 'rgba(239,68,68,0.10)',  border: 'rgba(239,68,68,0.25)',  accent: '#ef4444', icon: '\u274C', label: 'Refuted' },
    unclear:   { bg: 'rgba(234,179,8,0.10)',   border: 'rgba(234,179,8,0.25)',  accent: '#eab308', icon: '\u26A0\uFE0F', label: 'Unclear' },
  };

  const CONFIDENCE_DOTS = { low: '\u25CF\u25CB\u25CB', med: '\u25CF\u25CF\u25CB', high: '\u25CF\u25CF\u25CF' };

  // ── DOM helper ──

  function el(tag, styles, attrs) {
    const e = document.createElement(tag);
    if (styles) Object.assign(e.style, styles);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (k === 'textContent' || k === 'innerHTML' || k === 'className') {
          e[k] = v;
        } else {
          e.setAttribute(k, v);
        }
      }
    }
    return e;
  }

  // ── Inject keyframe styles once ──

  function injectStyles() {
    if (document.getElementById('watchout-sidebar-styles')) return;
    const style = document.createElement('style');
    style.id = 'watchout-sidebar-styles';
    style.textContent = `
      @keyframes watchout-shimmer {
        0% { background-position: 200% 0; }
        100% { background-position: -200% 0; }
      }
      @keyframes watchout-pulse {
        0%, 100% { opacity: 0.4; }
        50% { opacity: 1; }
      }
      @keyframes watchout-fade-in {
        from { opacity: 0; transform: translateY(6px); }
        to { opacity: 1; transform: translateY(0); }
      }
      .watchout-claim-btn:hover { background: rgba(255,255,255,0.04) !important; }
      .watchout-source-link:hover { background: rgba(255,255,255,0.06) !important; }
    `;
    document.head.appendChild(style);
  }

  // ── Build: Loading Skeleton ──

  function buildLoading() {
    const wrap = el('div', {});
    const shimmer = {
      background: 'linear-gradient(90deg, rgba(255,255,255,0.04) 25%, rgba(255,255,255,0.08) 50%, rgba(255,255,255,0.04) 75%)',
      backgroundSize: '200% 100%',
      animation: 'watchout-shimmer 1.5s infinite linear',
      borderRadius: '8px',
    };
    wrap.appendChild(el('div', { ...shimmer, height: '72px', marginBottom: '16px' }));
    for (let i = 0; i < 3; i++) {
      wrap.appendChild(el('div', { ...shimmer, height: '64px', marginBottom: '8px' }));
    }
    const txt = el('div', {
      textAlign: 'center', color: 'rgba(255,255,255,0.25)', fontSize: '12px',
      marginTop: '20px', animation: 'watchout-pulse 2s ease-in-out infinite',
    }, { textContent: 'Analyzing claims...' });
    wrap.appendChild(txt);
    return wrap;
  }

  // ── Build: Verification Bar ──

  function buildVerificationBar(score, claimCount) {
    const color = getScoreColor(score);
    const pct = Math.round(score * 100);

    const bar = el('div', {
      padding: '14px',
      background: `linear-gradient(135deg, ${color}15, ${color}08)`,
      border: `1px solid ${color}30`,
      borderRadius: '12px',
      animation: 'watchout-fade-in 0.3s ease',
    });

    const row = el('div', { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' });
    row.appendChild(el('span', { fontSize: '13px', fontWeight: '600', color: 'rgba(255,255,255,0.9)' }, { textContent: getScoreLabel(score) }));
    row.appendChild(el('span', { fontSize: '20px', fontWeight: '700', color, letterSpacing: '-0.5px' }, { textContent: pct + '%' }));
    bar.appendChild(row);

    const track = el('div', { width: '100%', height: '6px', background: 'rgba(255,255,255,0.08)', borderRadius: '3px', overflow: 'hidden' });
    track.appendChild(el('div', { width: pct + '%', height: '100%', background: `linear-gradient(90deg, ${color}cc, ${color})`, borderRadius: '3px', transition: 'width 0.6s ease-out' }));
    bar.appendChild(track);

    bar.appendChild(el('div', { fontSize: '10px', color: 'rgba(255,255,255,0.3)', marginTop: '6px' },
      { textContent: `Based on ${claimCount} verified claim${claimCount !== 1 ? 's' : ''}` }));

    return bar;
  }

  // ── Build: Claim Card ──

  function buildClaimCard(claim) {
    const cfg = VERDICT_CONFIG[claim.verdict] || VERDICT_CONFIG.unclear;

    const card = el('div', {
      marginBottom: '8px', borderRadius: '10px',
      border: `1px solid ${cfg.border}`, background: cfg.bg,
      overflow: 'hidden', transition: 'all 0.15s ease',
      animation: 'watchout-fade-in 0.3s ease',
    });

    // Collapsed header
    const header = el('div', { padding: '12px', cursor: 'pointer', userSelect: 'none' });
    header.className = 'watchout-claim-btn';

    const topRow = el('div', { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' });
    const left = el('div', { display: 'flex', alignItems: 'center', gap: '6px' });
    left.appendChild(el('span', { fontSize: '12px' }, { textContent: cfg.icon }));
    left.appendChild(el('span', { fontSize: '11px', fontWeight: '600', color: cfg.accent, textTransform: 'uppercase', letterSpacing: '0.5px' }, { textContent: cfg.label }));
    topRow.appendChild(left);

    const right = el('div', { display: 'flex', alignItems: 'center', gap: '8px' });
    right.appendChild(el('span', { fontSize: '10px', color: 'rgba(255,255,255,0.3)', letterSpacing: '2px' }, { textContent: CONFIDENCE_DOTS[claim.confidence] || CONFIDENCE_DOTS.low }));
    const chevron = el('span', { fontSize: '14px', color: 'rgba(255,255,255,0.3)', transition: 'transform 0.2s ease', display: 'inline-block' }, { textContent: '\u25BE' });
    right.appendChild(chevron);
    topRow.appendChild(right);
    header.appendChild(topRow);

    header.appendChild(el('div', { fontSize: '13px', lineHeight: '1.5', color: 'rgba(255,255,255,0.85)' }, { textContent: claim.text }));
    card.appendChild(header);

    // Expanded details (hidden initially)
    const details = el('div', {
      padding: '0 12px 12px', borderTop: '1px solid rgba(255,255,255,0.06)',
      paddingTop: '10px', display: 'none',
    });

    details.appendChild(el('div', { fontSize: '12px', lineHeight: '1.6', color: 'rgba(255,255,255,0.6)', marginBottom: '8px' }, { textContent: claim.explanation }));

    if (claim.what_to_check_next) {
      details.appendChild(el('div', {
        fontSize: '11px', color: 'rgba(234,179,8,0.7)', fontStyle: 'italic',
        marginBottom: '8px', padding: '6px 8px', background: 'rgba(234,179,8,0.05)', borderRadius: '6px',
      }, { textContent: '\uD83D\uDCA1 ' + claim.what_to_check_next }));
    }

    if (claim.sources && claim.sources.length > 0) {
      const srcWrap = el('div', {});
      srcWrap.appendChild(el('div', { fontSize: '10px', color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }, { textContent: 'Sources' }));

      claim.sources.forEach(function (src) {
        const a = document.createElement('a');
        a.href = src.url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.className = 'watchout-source-link';
        Object.assign(a.style, {
          display: 'block', padding: '6px 8px', marginBottom: '4px',
          background: 'rgba(255,255,255,0.03)', borderRadius: '6px', textDecoration: 'none',
          transition: 'background 0.1s ease',
        });
        a.addEventListener('click', function (e) { e.stopPropagation(); });
        a.appendChild(el('div', { fontSize: '11px', color: '#60a5fa', fontWeight: '500', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
          { textContent: '\uD83D\uDD17 ' + (src.title || src.url) }));
        if (src.snippet) {
          a.appendChild(el('div', { fontSize: '10px', color: 'rgba(255,255,255,0.3)', marginTop: '2px', lineHeight: '1.4', overflow: 'hidden', display: '-webkit-box', webkitLineClamp: '2', webkitBoxOrient: 'vertical' },
            { textContent: src.snippet }));
        }
        srcWrap.appendChild(a);
      });
      details.appendChild(srcWrap);
    }

    card.appendChild(details);

    // Toggle expand/collapse
    let expanded = false;
    header.addEventListener('click', function () {
      expanded = !expanded;
      details.style.display = expanded ? 'block' : 'none';
      chevron.style.transform = expanded ? 'rotate(180deg)' : 'rotate(0deg)';
      header.setAttribute('aria-expanded', String(expanded));
    });
    header.setAttribute('role', 'button');
    header.setAttribute('aria-expanded', 'false');
    header.setAttribute('tabindex', '0');
    header.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        header.click();
      }
    });

    return card;
  }

  // ── Main render ──

  function render() {
    if (!_container) return;
    _container.innerHTML = '';

    if (_state.state === 'idle') return;

    const shell = el('div', {
      width: '100%', height: '100%',
      background: 'rgba(15, 15, 15, 0.97)',
      backdropFilter: 'blur(16px)',
      borderRadius: '16px',
      border: '1px solid rgba(255,255,255,0.08)',
      color: 'white',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      overflowY: 'auto', overflowX: 'hidden',
      display: 'flex', flexDirection: 'column',
      boxSizing: 'border-box',
    });

    // ── Header ──
    const hdr = el('div', { padding: '16px 16px 12px', borderBottom: '1px solid rgba(255,255,255,0.06)', flexShrink: '0' });

    const hdrRow = el('div', { display: 'flex', justifyContent: 'space-between', alignItems: 'center' });
    const brand = el('div', { display: 'flex', alignItems: 'center', gap: '8px' });
    brand.appendChild(el('span', { fontSize: '18px' }, { textContent: '\uD83D\uDC41\uFE0F' }));
    brand.appendChild(el('span', { fontWeight: '700', fontSize: '15px', letterSpacing: '-0.3px' }, { textContent: 'Watch Out' }));
    hdrRow.appendChild(brand);

    const closeBtn = el('button', {
      background: 'rgba(255,255,255,0.06)', border: 'none', color: 'rgba(255,255,255,0.5)',
      cursor: 'pointer', fontSize: '16px', width: '28px', height: '28px', borderRadius: '6px',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
    }, { 'aria-label': 'Close sidebar', textContent: '\u2715' });
    closeBtn.addEventListener('click', function () {
      window.dispatchEvent(new CustomEvent('factcheck-close-sidebar'));
    });
    hdrRow.appendChild(closeBtn);
    hdr.appendChild(hdrRow);

    // Metadata
    const meta = _state.metadata;
    if (meta && (meta.title || meta.channel)) {
      const metaBox = el('div', { marginTop: '10px', padding: '8px 10px', background: 'rgba(255,255,255,0.04)', borderRadius: '8px' });
      if (meta.title) {
        metaBox.appendChild(el('div', { fontSize: '12px', fontWeight: '500', color: 'rgba(255,255,255,0.85)', lineHeight: '1.3', marginBottom: meta.channel ? '2px' : '0' }, { textContent: meta.title }));
      }
      if (meta.channel) {
        metaBox.appendChild(el('div', { fontSize: '11px', color: 'rgba(255,255,255,0.4)' }, { textContent: meta.channel }));
      }
      hdr.appendChild(metaBox);
    }

    shell.appendChild(hdr);

    // ── Body ──
    const body = el('div', { padding: '16px', flex: '1', overflowY: 'auto' });

    if (_state.state === 'loading') {
      body.appendChild(buildLoading());
    }

    if (_state.state === 'no_transcript') {
      const w = el('div', { padding: '32px 16px', textAlign: 'center' });
      w.appendChild(el('div', { fontSize: '32px', marginBottom: '12px' }, { textContent: '\uD83D\uDD07' }));
      w.appendChild(el('div', { fontSize: '14px', fontWeight: '500', color: 'rgba(255,255,255,0.7)', marginBottom: '6px' }, { textContent: 'No Transcript Available' }));
      w.appendChild(el('div', { fontSize: '12px', color: 'rgba(255,255,255,0.35)', lineHeight: '1.5' }, { textContent: "This Short doesn't have captions, so we can't verify its claims reliably." }));
      body.appendChild(w);
    }

    if (_state.state === 'error') {
      const w = el('div', { padding: '32px 16px', textAlign: 'center' });
      w.appendChild(el('div', { fontSize: '32px', marginBottom: '12px' }, { textContent: '\u26A0\uFE0F' }));
      w.appendChild(el('div', { fontSize: '14px', fontWeight: '500', color: '#ff6b6b', marginBottom: '6px' }, { textContent: 'Something went wrong' }));
      w.appendChild(el('div', { fontSize: '12px', color: 'rgba(255,255,255,0.35)', lineHeight: '1.5' }, { textContent: _state.errorMessage || 'Failed to analyze this Short. Please try again.' }));
      body.appendChild(w);
    }

    if (_state.state === 'result') {
      const claims = _state.claims || [];
      const score = _state.overallScore;

      if (score !== null && score !== undefined && claims.length > 0) {
        body.appendChild(buildVerificationBar(score, claims.length));
      }

      if (claims.length === 0) {
        body.appendChild(el('div', { padding: '24px 16px', textAlign: 'center', color: 'rgba(255,255,255,0.4)', fontSize: '13px' },
          { textContent: 'No verifiable factual claims found in this Short.' }));
      } else {
        const wrap = el('div', { marginTop: '12px' });
        wrap.appendChild(el('div', {
          fontSize: '10px', color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase',
          letterSpacing: '0.8px', fontWeight: '600', marginBottom: '10px',
        }, { textContent: claims.length + ' claim' + (claims.length !== 1 ? 's' : '') + ' analyzed' }));

        claims.forEach(function (claim) {
          wrap.appendChild(buildClaimCard(claim));
        });
        body.appendChild(wrap);
      }
    }

    shell.appendChild(body);
    _container.appendChild(shell);
  }

  // ── Public API (same contract as the React bundle) ──

  window.mountFactCheckSidebar = function (container) {
    injectStyles();
    _container = container;
    render();
  };

  window.updateFactCheckSidebar = function (newProps) {
    if (newProps) {
      for (var key in newProps) {
        if (newProps.hasOwnProperty(key)) {
          _state[key] = newProps[key];
        }
      }
    }
    render();
  };
})();
