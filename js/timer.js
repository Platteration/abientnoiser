/* A steady interval that keeps running when the tab is in the background.
 * requestAnimationFrame is paused in hidden tabs and setInterval can be
 * throttled hard, but a worker's timer keeps its cadence — which matters here
 * because the sleep timer, the focus timer and the queue all have to keep
 * working while you are looking at something else. */
(function (root) {
  const AN = root.AN = root.AN || {};

  const WORKER_SRC = 'let id=null;onmessage=e=>{clearInterval(id);if(e.data>0)id=setInterval(()=>postMessage(0),e.data)}';

  /**
   * @param {number} ms interval
   * @param {function} cb called on every tick
   * @returns {{stop: function}}
   */
  AN.ticker = function (ms, cb) {
    let worker = null, timer = null;
    try {
      const url = URL.createObjectURL(new Blob([WORKER_SRC], { type: 'text/javascript' }));
      worker = new Worker(url);
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
