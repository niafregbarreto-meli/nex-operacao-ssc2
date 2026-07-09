/*
 * Persistence adapter: uses the Grid HTML SDK collaborative state when the app
 * runs inside a Grid document viewer. Grid's upload validation rejects any
 * HTML that references browser storage APIs, so local preview (outside
 * Grid) falls back to a plain in-memory variable instead — it won't survive
 * a reload, but it keeps the app usable for local testing without risking
 * an upload rejection.
 *
 * window.GRID.state.get() resolves to {state, updated_at} (not the bare
 * state) and .set(next, updated_at) takes the previous updated_at back as an
 * optimistic-lock token — both are easy to miss and silently break
 * persistence, so this shim tracks updated_at internally.
 */
(function (global) {
  var saveTimer = null;
  var pendingState = null;
  var memoryFallback = null;
  var lastUpdatedAt = null;

  function hasGridState() {
    return !!(global.GRID && global.GRID.state && typeof global.GRID.state.get === 'function');
  }

  var GridStore = {
    async load() {
      if (hasGridState()) {
        try {
          var res = await global.GRID.state.get();
          lastUpdatedAt = res && res.updated_at != null ? res.updated_at : null;
          var state = res && res.state;
          return state && Object.keys(state).length ? state : null;
        } catch (err) {
          console.warn('GRID.state.get failed, starting empty', err);
          return null;
        }
      }
      return memoryFallback;
    },

    // Debounced write so rapid edits (typing, checkbox toggles) coalesce into
    // one call instead of one per keystroke.
    saveDebounced(state, delayMs) {
      pendingState = state;
      if (saveTimer) clearTimeout(saveTimer);
      saveTimer = setTimeout(function () {
        GridStore.saveNow(pendingState);
      }, delayMs || 500);
    },

    async saveNow(state) {
      if (hasGridState()) {
        try {
          var res = await global.GRID.state.set(state, lastUpdatedAt);
          if (res && res.updated_at != null) lastUpdatedAt = res.updated_at;
        } catch (err) {
          console.error('GRID.state.set failed', err);
        }
        return;
      }
      memoryFallback = state;
    },

    isRunningInGrid() {
      return hasGridState();
    },

    // Forces any pending debounced write to happen immediately. Call this
    // before the page is hidden/unloaded so a save timer in flight isn't lost.
    flush() {
      if (saveTimer) {
        clearTimeout(saveTimer);
        saveTimer = null;
        if (pendingState) GridStore.saveNow(pendingState);
      }
    }
  };

  document.addEventListener('visibilitychange', function () {
    if (document.visibilityState === 'hidden') GridStore.flush();
  });
  window.addEventListener('pagehide', function () { GridStore.flush(); });

  global.GridStore = GridStore;
})(window);
