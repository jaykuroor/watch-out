// Stub sidebar — renders raw JSON so Person A can verify data flow
// Replace this file with Person C's built sidebar.bundle.js when ready
(function () {
  let container = null;
  let currentProps = { state: 'idle' };

  function render() {
    if (!container) return;

    if (currentProps.state === 'idle') {
      container.innerHTML = '';
      return;
    }

    const stateColors = {
      loading: '#60a5fa',
      result: '#22c55e',
      error: '#ef4444',
      no_transcript: '#eab308',
    };
    const color = stateColors[currentProps.state] || '#888';

    container.innerHTML = `
      <div style="
        width: 100%;
        height: 100%;
        background: rgba(15, 15, 15, 0.97);
        border-radius: 16px;
        border: 1px solid rgba(255, 255, 255, 0.08);
        color: white;
        font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
        overflow-y: auto;
        display: flex;
        flex-direction: column;
        box-sizing: border-box;
      ">
        <div style="
          padding: 16px;
          border-bottom: 1px solid rgba(255,255,255,0.06);
          display: flex;
          justify-content: space-between;
          align-items: center;
          flex-shrink: 0;
        ">
          <div style="display: flex; align-items: center; gap: 8px;">
            <span style="font-size: 18px;">&#128269;</span>
            <span style="font-weight: 700; font-size: 15px;">Fact Check (Stub)</span>
          </div>
          <button id="factcheck-stub-close" style="
            background: rgba(255,255,255,0.06);
            border: none;
            color: rgba(255,255,255,0.5);
            cursor: pointer;
            font-size: 16px;
            width: 28px;
            height: 28px;
            border-radius: 6px;
            display: flex;
            align-items: center;
            justify-content: center;
          ">&times;</button>
        </div>
        <div style="padding: 16px; flex: 1; overflow-y: auto;">
          <div style="
            display: inline-block;
            padding: 4px 10px;
            border-radius: 6px;
            font-size: 11px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: ${color};
            background: ${color}18;
            border: 1px solid ${color}40;
            margin-bottom: 12px;
          ">${currentProps.state}</div>
          <pre style="
            white-space: pre-wrap;
            word-break: break-word;
            font-size: 11px;
            line-height: 1.6;
            color: rgba(255,255,255,0.65);
            background: rgba(255,255,255,0.03);
            padding: 12px;
            border-radius: 8px;
            margin: 0;
          ">${JSON.stringify(currentProps, null, 2)}</pre>
        </div>
      </div>
    `;

    const closeBtn = container.querySelector('#factcheck-stub-close');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => {
        window.dispatchEvent(new CustomEvent('factcheck-close-sidebar'));
      });
    }
  }

  window.mountFactCheckSidebar = function (el) {
    container = el;
    render();
  };

  window.updateFactCheckSidebar = function (newProps) {
    currentProps = Object.assign({}, currentProps, newProps);
    render();
  };
})();
