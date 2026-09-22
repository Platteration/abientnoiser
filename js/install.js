/* The "Install" button in the header. Chromium fires beforeinstallprompt once the page
   qualifies as installable (a manifest, a service worker, a secure origin) and not while
   it is already installed; Safari never fires it at all. So the button starts hidden and
   only the event shows it — nothing dead is drawn where the event will not come. */
(function (root) {
  const AN = root.AN = root.AN || {};

  /** Wire `button` to the install prompt `target` (the window) may offer. A prompt event
   *  can be used once, so a click spends it and hides the button again until the browser
   *  offers another; `appinstalled` hides it for good. Hands the handlers back so a test
   *  can drive them without a browser, which cannot stage the event on demand. */
  AN.installPrompt = function installPrompt(target, button) {
    let deferred = null;
    const onPrompt = (e) => {
      e.preventDefault();   // no mini-infobar: the page offers its own button
      deferred = e;
      button.hidden = false;
    };
    const onInstalled = () => {
      deferred = null;
      button.hidden = true;
    };
    const onClick = () => {
      const e = deferred;
      if (!e) return;
      deferred = null;
      button.hidden = true;
      Promise.resolve().then(() => e.prompt()).catch(() => { /* not installable after all */ });
    };
    target.addEventListener('beforeinstallprompt', onPrompt);
    target.addEventListener('appinstalled', onInstalled);
    button.addEventListener('click', onClick);
    return { onPrompt, onInstalled, onClick };
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
