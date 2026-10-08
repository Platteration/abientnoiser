/* A steady interval that keeps running when the tab is in the background.
 * requestAnimationFrame is paused in hidden tabs and setInterval can be
 * throttled hard, but a worker's timer keeps its cadence — which matters here
 * because the sleep timer, the focus timer and the queue all have to keep
 * working while you are looking at something else. */
(function (root) {
  const AN = root.AN = root.AN || {};

  const WORKER_SRC = 'let id=null;onmessage=e=>{clearInterval(id);if(e.data>0)id=setInterval(()=>postMessage(0),e.data)}';

  /* Under the page's Trusted Types policy (require-trusted-types-for 'script') a Worker
   * takes a TrustedScriptURL, not a string, and a plain string throws — which the catch
   * below would quietly turn into a throttled setInterval. This policy is private to this
   * file and vouches only for a blob: URL, which nothing but a script on the page can
   * mint. Where the browser has no Trusted Types, or the host's policy does not name this
   * one, the URL stays a string. */
  let scriptURLs = null;
  try {
    if (root.trustedTypes && root.trustedTypes.createPolicy) {
      scriptURLs = root.trustedTypes.createPolicy('ambient-noiser-ticker', {
        createScriptURL(url) {
          if (/^blob:/.test(url)) return url;
          throw new TypeError(`not a ticker worker: ${url}`);
        },
      });
    }
  } catch { /* no policy: the string is used as it is */ }

  /**
   * @param {number} ms interval
   * @param {function} cb called on every tick
   * @returns {{stop: function}}
   */
  AN.ticker = function (ms, cb) {
    let worker = null, timer = null;
    try {
      const url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
      worker = new Worker(scriptURLs ? scriptURLs.createScriptURL(url) : url);
      worker.onmessage = () => cb();
      worker.postMessage(ms);
      URL.revokeObjectURL(url);
    } catch {
      timer = setInterval(cb, ms); // workers blocked (file: URLs, strict CSP)
    }
    return {
      stop() {
        if (worker) { worker.terminate(); worker = null; }
        if (timer) { clearInterval(timer); timer = null; }
      },
    };
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
