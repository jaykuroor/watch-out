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

  // ── Theme tokens ──

  const DARK_THEME = {
    bg: '#000000',
    fg: '#abb2bf',
    red: '#ef596f',
    orange: '#d19a66',
    yellow: '#e5c07b',
    green: '#89ca78',
    cyan: '#2bbac5',
    blue: '#61afef',
    purple: '#d55fde',
    white: '#abb2bf',
    black: '#000000',
    gray: '#434852',
    highlight: '#e2be7d',
    comment: '#7f848e',
    none: 'NONE',
    surface: '#000000',
    surfaceRaised: '#111318',
    surfaceSoft: '#1a1f28',
    selectionBackground: '#2a2f38',
    edge: '#434852',
    ink: '#abb2bf',
    inkMuted: '#8f98a8',
    inkSubtle: '#7f848e',
    shadowDark: 'rgba(7, 9, 13, 0.58)',
    shadowLight: 'rgba(255, 255, 255, 0.035)',
    insetDark: 'rgba(4, 6, 10, 0.56)',
    insetLight: 'rgba(255, 255, 255, 0.05)',
    sourcePaper: '#161b23',
    sourceHover: '#2a2f38',
    fontDisplay: '"Rubik", "Segoe UI", "Helvetica Neue", Arial, sans-serif',
    fontBody: '"Rubik", "Segoe UI", "Helvetica Neue", Arial, sans-serif',
  };
  const LIGHT_THEME = {
    bg: '#e6e7ed',
    fg: '#343b58',
    red: '#8c4351',
    orange: '#965027',
    yellow: '#8f5e15',
    green: '#385f0d',
    cyan: '#006c86',
    blue: '#2959aa',
    purple: '#5a3e8e',
    white: '#343b58',
    black: '#343b58',
    gray: '#6c6e75',
    highlight: '#e2be7d',
    comment: '#6c6e75',
    none: 'NONE',
    surface: '#f4f4f7',
    surfaceRaised: '#ffffff',
    surfaceSoft: '#eceef3',
    selectionBackground: '#d7d9e2',
    edge: '#c7cad8',
    ink: '#343b58',
    inkMuted: '#40434f',
    inkSubtle: '#6c6e75',
    shadowDark: 'rgba(52, 59, 88, 0.18)',
    shadowLight: 'rgba(255, 255, 255, 0.85)',
    insetDark: 'rgba(52, 59, 88, 0.14)',
    insetLight: 'rgba(255, 255, 255, 0.8)',
    sourcePaper: '#f0f1f6',
    sourceHover: '#e6e8f0',
    fontDisplay: '"Rubik", "Segoe UI", "Helvetica Neue", Arial, sans-serif',
    fontBody: '"Rubik", "Segoe UI", "Helvetica Neue", Arial, sans-serif',
  };
  let THEME = DARK_THEME;

  function isYouTubeLightMode() {
    const html = document.documentElement;
    return !html.hasAttribute('dark') && !html.classList.contains('dark');
  }

  function syncTheme() {
    THEME = isYouTubeLightMode() ? LIGHT_THEME : DARK_THEME;
  }

  function getScoreColor(s) {
    if (s >= 0.7) return THEME.green;
    if (s >= 0.4) return THEME.yellow;
    return THEME.red;
  }

  function getScoreLabel(s) {
    if (s >= 0.8) return 'Well Supported';
    if (s >= 0.6) return 'Mostly Supported';
    if (s >= 0.4) return 'Mixed Evidence';
    if (s >= 0.2) return 'Weakly Supported';
    return 'Likely Misleading';
  }

  const VERDICT_CONFIG = {
    supported: {
      bg: 'linear-gradient(145deg, rgba(137,202,120,0.26), rgba(0,0,0,0.88))',
      border: 'rgba(137, 202, 120, 0.55)',
      accent: THEME.green,
      icon: '\u2713',
      label: 'Supported'
    },
    refuted: {
      bg: 'linear-gradient(145deg, rgba(239,89,111,0.24), rgba(0,0,0,0.88))',
      border: 'rgba(239, 89, 111, 0.55)',
      accent: THEME.red,
      icon: '\u2715',
      label: 'Refuted'
    },
    unclear: {
      bg: 'linear-gradient(145deg, rgba(229,192,123,0.24), rgba(0,0,0,0.88))',
      border: 'rgba(229, 192, 123, 0.55)',
      accent: THEME.yellow,
      icon: '\u2022',
      label: 'Unclear'
    },
  };

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
    syncTheme();
    if (!document.getElementById('watchout-rubik-font')) {
      const fontLink = document.createElement('link');
      fontLink.id = 'watchout-rubik-font';
      fontLink.rel = 'stylesheet';
      fontLink.href = 'https://fonts.googleapis.com/css2?family=Rubik:wght@400;500;600;700&display=swap';
      document.head.appendChild(fontLink);
    }
    const style = document.getElementById('watchout-sidebar-styles') || document.createElement('style');
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
      @keyframes watchout-unroll {
        from { opacity: 0.75; transform: translateY(-3px); }
        to { opacity: 1; transform: translateY(0); }
      }
      @keyframes watchout-feedback-burst {
        0% {
          opacity: 0;
          transform: translate(-50%, 0) scale(0.8);
        }
        10% {
          opacity: 1;
        }
        100% {
          opacity: 0;
          transform: translate(calc(-50% + var(--drift-x)), calc(-1 * var(--drift-y))) scale(1.35);
        }
      }
      .watchout-claim-btn:hover { background: rgba(255, 255, 255, 0.02) !important; }
      .watchout-source-link:hover { background: ${THEME.selectionBackground} !important; }
      .watchout-feedback-btn:hover { filter: brightness(1.08); }
    `;
    if (!style.parentNode) document.head.appendChild(style);
  }

  // ── Build: Loading Skeleton ──

  function buildLoading() {
    const wrap = el('div', {});
    const shimmer = {
      background: 'linear-gradient(90deg, rgba(255,255,255,0.04) 25%, rgba(255,255,255,0.12) 50%, rgba(255,255,255,0.04) 75%)',
      backgroundSize: '200% 100%',
      animation: 'watchout-shimmer 1.5s infinite linear',
      borderRadius: '8px',
    };
    wrap.appendChild(el('div', { ...shimmer, height: '72px', marginBottom: '16px' }));
    for (let i = 0; i < 3; i++) {
      wrap.appendChild(el('div', { ...shimmer, height: '64px', marginBottom: '8px' }));
    }
    const txt = el('div', {
      textAlign: 'center', color: THEME.inkSubtle, fontSize: '12px',
      marginTop: '20px', animation: 'watchout-pulse 2s ease-in-out infinite',
    }, { textContent: 'Analyzing claims...' });
    wrap.appendChild(txt);
    return wrap;
  }

  // ── Build: Verification Bar ──

  function buildVerificationBar(score, claimCount) {
    const color = getScoreColor(score);
    const pct = Math.round(score * 100);
    const ringSize = 116;
    const stroke = 10;
    const radius = (ringSize - stroke) / 2;
    const circumference = 2 * Math.PI * radius;
    const dashOffset = circumference * (1 - (pct / 100));

    const bar = el('div', {
      padding: '14px',
      background: `linear-gradient(165deg, ${THEME.surfaceRaised}, ${THEME.surface})`,
      border: `1px solid ${THEME.edge}`,
      borderRadius: '12px',
      boxShadow: `5px 5px 12px ${THEME.shadowDark}, -5px -5px 12px ${THEME.shadowLight}`,
      animation: 'watchout-fade-in 0.3s ease',
    });

    const row = el('div', { display: 'flex', alignItems: 'center', gap: '14px' });
    const ringWrap = el('div', { position: 'relative', width: ringSize + 'px', height: ringSize + 'px', flexShrink: '0' });

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', `0 0 ${ringSize} ${ringSize}`);
    svg.setAttribute('width', String(ringSize));
    svg.setAttribute('height', String(ringSize));

    const bgCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    bgCircle.setAttribute('cx', String(ringSize / 2));
    bgCircle.setAttribute('cy', String(ringSize / 2));
    bgCircle.setAttribute('r', String(radius));
    bgCircle.setAttribute('fill', 'none');
    bgCircle.setAttribute('stroke', THEME.black);
    bgCircle.setAttribute('stroke-width', String(stroke));
    svg.appendChild(bgCircle);

    const fgCircle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    fgCircle.setAttribute('cx', String(ringSize / 2));
    fgCircle.setAttribute('cy', String(ringSize / 2));
    fgCircle.setAttribute('r', String(radius));
    fgCircle.setAttribute('fill', 'none');
    fgCircle.setAttribute('stroke', color);
    fgCircle.setAttribute('stroke-width', String(stroke));
    fgCircle.setAttribute('stroke-linecap', 'round');
    fgCircle.setAttribute('stroke-dasharray', String(circumference));
    fgCircle.setAttribute('stroke-dashoffset', String(circumference));
    fgCircle.style.transform = 'rotate(-90deg)';
    fgCircle.style.transformOrigin = '50% 50%';
    fgCircle.style.transition = 'stroke-dashoffset 0.6s ease-out';
    svg.appendChild(fgCircle);

    ringWrap.appendChild(svg);
    ringWrap.appendChild(el('div', {
      position: 'absolute',
      top: '0',
      left: '0',
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      alignItems: 'center',
      justifyContent: 'center',
      color: THEME.ink,
      fontFamily: THEME.fontDisplay,
      pointerEvents: 'none',
    }));
    const pctText = el('div', { fontSize: '30px', fontWeight: '700', lineHeight: '1' }, { textContent: '0%' });
    ringWrap.lastChild.appendChild(pctText);
    ringWrap.lastChild.appendChild(el('div', { fontSize: '10px', letterSpacing: '0.8px', textTransform: 'uppercase', color: THEME.inkSubtle }, { textContent: 'Accuracy' }));
    row.appendChild(ringWrap);

    const statusCol = el('div', { display: 'flex', flexDirection: 'column', gap: '6px' });
    statusCol.appendChild(el('div', {
      fontFamily: THEME.fontDisplay,
      fontSize: '18px',
      fontWeight: '700',
      color: THEME.ink,
      lineHeight: '1.2',
    }, { textContent: getScoreLabel(score) }));
    statusCol.appendChild(el('div', {
      fontSize: '11px',
      color: THEME.inkMuted,
      lineHeight: '1.45',
    }, { textContent: 'Overall confidence from weighted claim verification.' }));
    row.appendChild(statusCol);
    bar.appendChild(row);

    bar.appendChild(el('div', { fontSize: '10px', color: THEME.inkSubtle, marginTop: '8px', letterSpacing: '0.4px' },
      { textContent: `Based on ${claimCount} verified claim${claimCount !== 1 ? 's' : ''}` }));

    requestAnimationFrame(function () {
      fgCircle.setAttribute('stroke-dashoffset', String(dashOffset));
    });

    const start = performance.now();
    const durationMs = 900;
    function animatePct(now) {
      const progress = Math.min((now - start) / durationMs, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      pctText.textContent = Math.round(pct * eased) + '%';
      if (progress < 1) requestAnimationFrame(animatePct);
    }
    requestAnimationFrame(animatePct);

    return bar;
  }

  // ── Build: Claim Card ──

  function buildClaimCard(claim) {
    const cfg = VERDICT_CONFIG[claim.verdict] || VERDICT_CONFIG.unclear;

    const card = el('div', {
      marginBottom: '10px', borderRadius: '12px',
      border: `1px solid ${cfg.border}`, background: cfg.bg,
      overflow: 'hidden', transition: 'all 0.15s ease', position: 'relative',
      boxShadow: `4px 4px 10px ${THEME.shadowDark}, -4px -4px 10px ${THEME.shadowLight}`,
      animation: 'watchout-fade-in 0.3s ease',
    });

    // Collapsed header
    const header = el('div', {
      padding: '14px 12px 12px',
      cursor: 'pointer',
      userSelect: 'none',
      background: 'linear-gradient(180deg, rgba(255,255,255,0.07), rgba(255,255,255,0.01))',
    });
    header.className = 'watchout-claim-btn';

    const topRow = el('div', { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '6px' });
    const left = el('div', { display: 'flex', alignItems: 'center', gap: '8px' });
    left.appendChild(el('span', { fontSize: '13px', color: cfg.accent, fontWeight: '700' }, { textContent: cfg.icon }));
    left.appendChild(el('span', {
      fontSize: '13px',
      fontWeight: '700',
      color: cfg.accent,
      textTransform: 'uppercase',
      letterSpacing: '0.9px',
      fontFamily: THEME.fontDisplay,
    }, { textContent: cfg.label }));
    topRow.appendChild(left);

    const right = el('div', { display: 'flex', alignItems: 'center' });
    const chevron = el('span', {
      fontSize: '18px',
      fontWeight: '700',
      color: THEME.blue,
      transition: 'transform 0.2s ease, color 0.2s ease',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      width: '22px',
      height: '22px',
      borderRadius: '7px',
      border: `1px solid ${THEME.gray}`,
      background: 'linear-gradient(160deg, rgba(255,255,255,0.08), rgba(255,255,255,0.02))',
      boxShadow: `inset 1px 1px 0 ${THEME.insetLight}, inset -1px -1px 0 ${THEME.insetDark}`,
      lineHeight: '1',
    }, { textContent: '\u25BE' });
    right.appendChild(chevron);
    topRow.appendChild(right);
    header.appendChild(topRow);

    header.appendChild(el('div', { fontSize: '14px', lineHeight: '1.5', color: THEME.ink, fontFamily: THEME.fontBody }, { textContent: claim.text }));
    card.appendChild(header);

    // Expanded details (hidden initially)
    const details = el('div', {
      padding: '0 12px 12px', borderTop: '1px solid rgba(255,255,255,0.08)',
      paddingTop: '10px', display: 'none',
      animation: 'watchout-unroll 0.2s ease',
    });

    details.appendChild(el('div', { fontSize: '12px', lineHeight: '1.6', color: THEME.inkMuted, marginBottom: '8px', fontFamily: THEME.fontBody }, { textContent: claim.explanation }));

    if (claim.what_to_check_next) {
      details.appendChild(el('div', {
        fontSize: '11px', color: THEME.yellow,
        marginBottom: '8px', padding: '6px 8px', background: 'rgba(217,179,97,0.14)', borderRadius: '6px',
        border: '1px solid rgba(217,179,97,0.24)',
      }, { textContent: '\uD83D\uDCA1 ' + claim.what_to_check_next }));
    }

    if (claim.sources && claim.sources.length > 0) {
      const srcWrap = el('div', {});
      srcWrap.appendChild(el('div', { fontSize: '10px', color: THEME.inkSubtle, textTransform: 'uppercase', letterSpacing: '0.5px', marginBottom: '6px' }, { textContent: 'Sources' }));

      claim.sources.forEach(function (src) {
        const a = document.createElement('a');
        a.href = src.url;
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.className = 'watchout-source-link';
        Object.assign(a.style, {
          display: 'block', padding: '6px 8px', marginBottom: '4px',
          background: `linear-gradient(150deg, ${THEME.sourceHover}, ${THEME.sourcePaper})`,
          borderRadius: '6px', textDecoration: 'none',
          border: '1px solid rgba(255,255,255,0.07)',
          boxShadow: `inset 1px 1px 0 ${THEME.insetLight}, inset -1px -1px 0 ${THEME.insetDark}`,
          transition: 'background 0.1s ease',
        });
        a.addEventListener('click', function (e) { e.stopPropagation(); });
        a.appendChild(el('div', { fontSize: '11px', color: THEME.blue, fontWeight: '600', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },
          { textContent: '\uD83D\uDD17 ' + (src.title || src.url) }));
        if (src.snippet) {
          a.appendChild(el('div', { fontSize: '10px', color: THEME.inkMuted, marginTop: '2px', lineHeight: '1.4', overflow: 'hidden', display: '-webkit-box', webkitLineClamp: '2', webkitBoxOrient: 'vertical' },
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
      chevron.style.color = expanded ? THEME.fg : THEME.blue;
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

  function buildFeedbackActions() {
    const wrap = el('div', {
      marginTop: 'auto',
      paddingBottom: '4px',
      paddingTop: '12px',
      borderTop: `1px solid ${THEME.edge}`,
      display: 'flex',
      flexDirection: 'column',
      gap: '8px',
      alignItems: 'center',
      flexShrink: '0',
      position: 'relative',
    });

    wrap.appendChild(el('div', {
      fontSize: '11px',
      color: THEME.inkSubtle,
      letterSpacing: '0.7px',
      textTransform: 'uppercase',
      textAlign: 'center',
    }, { textContent: 'Was this helpful?' }));

    const row = el('div', { display: 'flex', gap: '8px', position: 'relative' });
    const likeBtn = el('button', {
      minWidth: '104px',
      padding: '7px 10px',
      borderRadius: '8px',
      border: `1px solid ${THEME.edge}`,
      color: THEME.ink,
      background: `linear-gradient(160deg, ${THEME.surfaceSoft}, ${THEME.surfaceRaised})`,
      boxShadow: `3px 3px 7px ${THEME.shadowDark}, -3px -3px 7px ${THEME.shadowLight}`,
      cursor: 'pointer',
      fontFamily: THEME.fontBody,
      fontSize: '12px',
      fontWeight: '500',
    }, { textContent: 'Like' });
    likeBtn.className = 'watchout-feedback-btn';

    const dislikeBtn = el('button', {
      minWidth: '104px',
      padding: '7px 10px',
      borderRadius: '8px',
      border: `1px solid ${THEME.edge}`,
      color: THEME.ink,
      background: `linear-gradient(160deg, ${THEME.surfaceSoft}, ${THEME.surfaceRaised})`,
      boxShadow: `3px 3px 7px ${THEME.shadowDark}, -3px -3px 7px ${THEME.shadowLight}`,
      cursor: 'pointer',
      fontFamily: THEME.fontBody,
      fontSize: '12px',
      fontWeight: '500',
    }, { textContent: 'Dislike' });
    dislikeBtn.className = 'watchout-feedback-btn';

    let submitted = false;
    function spawnEmojiBurst(emoji, anchorBtn) {
      const anchorX = anchorBtn.offsetLeft + (anchorBtn.offsetWidth / 2);
      for (let i = 0; i < 11; i++) {
        const bubble = el('span', {
          position: 'absolute',
          left: anchorX + 'px',
          bottom: '10px',
          fontSize: (18 + Math.floor(Math.random() * 10)) + 'px',
          pointerEvents: 'none',
          animation: 'watchout-feedback-burst 1.35s ease-out forwards',
          animationDelay: (Math.random() * 0.18) + 's',
          zIndex: '2',
        }, { textContent: emoji });
        bubble.style.setProperty('--drift-x', (-46 + Math.random() * 92).toFixed(0) + 'px');
        bubble.style.setProperty('--drift-y', (58 + Math.random() * 36).toFixed(0) + 'px');
        row.appendChild(bubble);
        setTimeout(function () { bubble.remove(); }, 1700);
      }
    }

    function submitFeedback(kind) {
      if (submitted) return;
      submitted = true;
      const isLike = kind === 'like';
      const targetBtn = isLike ? likeBtn : dislikeBtn;
      targetBtn.style.borderColor = isLike ? THEME.green : THEME.red;
      targetBtn.style.color = isLike ? THEME.green : THEME.red;
      spawnEmojiBurst(isLike ? '🤭' : '🥀', targetBtn);

      setTimeout(function () {
        wrap.innerHTML = '';
        wrap.appendChild(el('div', {
          fontSize: '12px',
          color: THEME.inkMuted,
          textAlign: 'center',
          fontWeight: '500',
          letterSpacing: '0.3px',
          padding: '6px 0 2px',
        }, { textContent: 'We value your feedback!' }));
      }, 980);
    }

    likeBtn.addEventListener('click', function () {
      submitFeedback('like');
    });

    dislikeBtn.addEventListener('click', function () {
      submitFeedback('dislike');
    });

    row.appendChild(likeBtn);
    row.appendChild(dislikeBtn);
    wrap.appendChild(row);
    return wrap;
  }

  // ── Main render ──

  function render() {
    if (!_container) return;
    syncTheme();
    injectStyles();
    _container.innerHTML = '';

    if (_state.state === 'idle') return;

    const shell = el('div', {
      width: '100%', height: '100%',
      background: THEME.bg,
      borderRadius: '16px',
      border: `1px solid ${THEME.edge}`,
      color: THEME.ink,
      fontFamily: THEME.fontBody,
      opacity: '1',
      overflowY: 'auto', overflowX: 'hidden',
      display: 'flex', flexDirection: 'column',
      boxSizing: 'border-box',
      boxShadow: `10px 10px 22px ${THEME.shadowDark}, -10px -10px 22px ${THEME.shadowLight}`,
    });
    shell.className = 'watchout-shell';

    // ── Header ──
    const hdr = el('div', { padding: '16px 16px 12px', borderBottom: '1px solid rgba(255,255,255,0.07)', flexShrink: '0' });

    const hdrRow = el('div', { display: 'flex', alignItems: 'center', minHeight: '30px', position: 'relative' });
    const brand = el('div', { display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', width: '100%' });
    brand.appendChild(el('span', { fontSize: '16px', color: THEME.inkMuted }, { textContent: '\uD83D\uDC41\uFE0F' }));
    brand.appendChild(el('span', {
      fontWeight: '700',
      fontSize: '17px',
      letterSpacing: '1.6px',
      fontFamily: THEME.fontDisplay,
      color: THEME.ink,
      textShadow: '1px 1px 1px rgba(0,0,0,0.28)',
    }, { textContent: 'Watch Out' }));
    hdrRow.appendChild(brand);

    const closeBtn = el('button', {
      background: `linear-gradient(160deg, ${THEME.surfaceSoft}, ${THEME.surfaceRaised})`, border: `1px solid ${THEME.edge}`, color: THEME.inkSubtle,
      cursor: 'pointer', fontSize: '16px', width: '28px', height: '28px', borderRadius: '6px',
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      boxShadow: `3px 3px 7px ${THEME.shadowDark}, -3px -3px 7px ${THEME.shadowLight}`,
      position: 'absolute', right: '0', top: '50%', transform: 'translateY(-50%)',
    }, { 'aria-label': 'Close sidebar', textContent: '\u2715' });
    closeBtn.addEventListener('click', function () {
      window.dispatchEvent(new CustomEvent('factcheck-close-sidebar'));
    });
    hdrRow.appendChild(closeBtn);
    hdr.appendChild(hdrRow);

    shell.appendChild(hdr);

    // ── Body ──
    const body = el('div', {
      padding: '16px',
      flex: '1',
      overflowY: 'auto',
      display: 'flex',
      flexDirection: 'column',
      minHeight: '0',
    });

    if (_state.state === 'loading') {
      body.appendChild(buildLoading());
    }

    if (_state.state === 'no_transcript') {
      const w = el('div', { padding: '32px 16px', textAlign: 'center' });
      w.appendChild(el('div', { fontSize: '32px', marginBottom: '12px' }, { textContent: '\uD83D\uDD07' }));
      w.appendChild(el('div', { fontSize: '14px', fontWeight: '600', color: THEME.ink, marginBottom: '6px', fontFamily: THEME.fontDisplay }, { textContent: 'No Transcript Available' }));
      w.appendChild(el('div', { fontSize: '12px', color: THEME.inkMuted, lineHeight: '1.5' }, { textContent: "This Short doesn't have captions, so we can't verify its claims reliably." }));
      body.appendChild(w);
    }

    if (_state.state === 'error') {
      const w = el('div', { padding: '32px 16px', textAlign: 'center' });
      w.appendChild(el('div', { fontSize: '32px', marginBottom: '12px' }, { textContent: '\u26A0\uFE0F' }));
      w.appendChild(el('div', { fontSize: '14px', fontWeight: '600', color: THEME.red, marginBottom: '6px', fontFamily: THEME.fontDisplay }, { textContent: 'Something went wrong' }));
      w.appendChild(el('div', { fontSize: '12px', color: THEME.inkMuted, lineHeight: '1.5' }, { textContent: _state.errorMessage || 'Failed to analyze this Short. Please try again.' }));
      body.appendChild(w);
    }

    if (_state.state === 'result') {
      const claims = _state.claims || [];
      const score = _state.overallScore;

      if (score !== null && score !== undefined && claims.length > 0) {
        body.appendChild(buildVerificationBar(score, claims.length));
      }

      if (claims.length === 0) {
        body.appendChild(el('div', { padding: '24px 16px', textAlign: 'center', color: THEME.inkMuted, fontSize: '13px' },
          { textContent: 'No verifiable factual claims found in this Short.' }));
      } else {
        const wrap = el('div', { marginTop: '12px' });
        wrap.appendChild(el('div', {
          textAlign: 'center',
          fontSize: '10px', color: THEME.inkSubtle, textTransform: 'uppercase',
          letterSpacing: '0.8px', fontWeight: '600', marginBottom: '10px',
        }, { textContent: claims.length + ' claim' + (claims.length !== 1 ? 's' : '') + ' analyzed' }));

        claims.forEach(function (claim) {
          wrap.appendChild(buildClaimCard(claim));
        });
        body.appendChild(wrap);
      }

      body.appendChild(buildFeedbackActions());
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
