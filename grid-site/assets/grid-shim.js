/*
 * Persistence adapter: uses the Grid HTML SDK collaborative state when the app
 * runs inside a Grid document viewer, and falls back to localStorage when
 * opened directly in a browser (local development / preview outside Grid).
 */
(function (global) {
  var LOCAL_KEY = 'nex_presorting_state_v1';
  var saveTimer = null;
  var pendingState = null;

  function hasGridState() {
    return !!(global.GRID && global.GRID.state && typeof global.GRID.state.get === 'function');
  }

  var GridStore = {
    async load() {
      if (hasGridState()) {
        try {
          var state = await global.GRID.state.get();
          return state && Object.keys(state).length ? state : null;
        } catch (err) {
          console.warn('GRID.state.get failed, starting empty', err);
          return null;
        }
      }
      try {
        var raw = localStorage.getItem(LOCAL_KEY);
        return raw ? JSON.parse(raw) : null;
      } catch (err) {
        return null;
      }
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
          await global.GRID.state.set(state);
        } catch (err) {
          console.error('GRID.state.set failed', err);
        }
        return;
      }
      try {
        localStorage.setItem(LOCAL_KEY, JSON.stringify(state));
      } catch (err) {
        console.error('localStorage save failed', err);
      }
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
