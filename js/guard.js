/* The safety net. Loaded first, from <head>, and depending on nothing, so that when a file
   the page needs does not load, or a script throws before the app has started, the visitor
   reads a short note where the controls were rather than a page of controls that do
   nothing. The page starts with class="no-js" on <html>, which shows the same note in
   place of the controls; scripts are running, so that comes off at once. js/app.js adds
   "started" to <html> as the last step of init(): after that the app reports its own
   failures and this file stays out of the way. */
(function () {
  'use strict';
  var root = document.documentElement;
  root.classList.remove('no-js');

  var MESSAGES = {
    load: 'Part of Ambient Noiser did not load, so it cannot start. Check your connection and reload the page.',
    start: 'Ambient Noiser could not start in this browser. Reload the page; if it happens again, try a current Chrome, Edge, Firefox or Safari.',
  };

  /** Only this site's own files count. An extension that injects a script of its own, and
      fails, is not a reason to take the app away. */
  function ours(url) {
    try { return new URL(url, location.href).origin === location.origin; } catch (e) { return false; }
  }

  var shown = null;
  function show() {
    var note = document.getElementById('startNote');
    if (note && shown) note.textContent = MESSAGES[shown];
  }

  function fail(kind) {
    if (root.classList.contains('started')) return;
    if (shown !== 'load') shown = kind; // a missing file is the cause; the throws that follow are its symptoms
    root.classList.add('start-failed');
    show();
  }

  // Capture phase: a script or stylesheet that fails to load fires on its element and does
  // not bubble. An exception thrown by a script reaches here as an ErrorEvent on window.
  window.addEventListener('error', function (e) {
    var el = e.target;
    if (el && el !== window && el.tagName) {
      var tag = el.tagName.toLowerCase();
      if ((tag === 'script' && ours(el.src)) || (tag === 'link' && el.rel === 'stylesheet' && ours(el.href))) fail('load');
      return;
    }
    if (e.filename && ours(e.filename)) fail('start');
  }, true);

  // A failure before the body was parsed has no note to write into yet.
  document.addEventListener('DOMContentLoaded', show);
})();
