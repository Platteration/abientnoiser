/* Share card: a 1200x630 PNG summarising a mix — style, seed, movement colours
 * and the first few movement names. Drawn on a canvas, no network involved. */
(function (root) {
  const AN = root.AN = root.AN || {};

  const W = 1200, H = 630;
  const DISPLAY = '"Iowan Old Style", "Palatino Linotype", Palatino, Georgia, "Times New Roman", serif';
  const UI = 'system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';

  function roundRect(c, x, y, w, h, r) {
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  /** Truncate to fit `max` pixels, with an ellipsis. */
  function fit(c, text, max) {
    if (c.measureText(text).width <= max) return text;
    let s = text;
    while (s.length > 1 && c.measureText(`${s}…`).width > max) s = s.slice(0, -1);
    return `${s}…`;
  }

  /**
   * Draw the card for a plan.
   * @returns {Promise<Blob>} a PNG blob
   */
  AN.shareCard = function (plan, settings) {
    const canvas = document.createElement('canvas');
    canvas.width = W; canvas.height = H;
    const c = canvas.getContext('2d');
    const first = plan.sections[0];
    const hue = first.hue;

    // ground
    const bg = c.createLinearGradient(0, 0, W * 0.4, H);
    bg.addColorStop(0, `hsl(${hue} 32% 16%)`);
    bg.addColorStop(1, '#0b0e13');
    c.fillStyle = bg;
    c.fillRect(0, 0, W, H);

    // glow
    const glow = c.createRadialGradient(W * 0.82, -60, 0, W * 0.82, -60, W * 0.75);
    glow.addColorStop(0, `hsla(${hue} 70% 55% / 0.35)`);
    glow.addColorStop(1, 'transparent');
    c.fillStyle = glow;
    c.fillRect(0, 0, W, H);

    // drifting bands, echoing the visualiser
    for (let i = 0; i < 4; i++) {
      const depth = i / 3;
      const amp = 26 * (1 - depth * 0.4);
      const base = H * (0.62 + depth * 0.12);
      c.beginPath();
      c.moveTo(0, H);
      for (let x = 0; x <= W; x += 6) {
        const y = base + Math.sin((x / W) * Math.PI * (2.2 + i * 1.4) + i * 1.3) * amp
          + Math.sin((x / W) * Math.PI * (5.1 + i)) * amp * 0.3;
        c.lineTo(x, y);
      }
      c.lineTo(W, H);
      c.closePath();
      c.fillStyle = `hsla(${hue + i * 14} 40% ${16 + i * 5}% / 0.22)`;
      c.fill();
    }

    const pad = 72;
    // wordmark
    c.fillStyle = 'rgba(255,255,255,0.55)';
    c.font = `600 20px ${UI}`;
    c.letterSpacing = '3px';
    c.fillText('AMBIENT NOISER', pad, pad + 6);
    c.letterSpacing = '0px';

    // style name
    c.fillStyle = '#f2f5fa';
    c.font = `78px ${DISPLAY}`;
    c.fillText(fit(c, plan.styleName, W - pad * 2), pad, pad + 108);

    // opening movement
    c.fillStyle = `hsl(${hue} 55% 72%)`;
    c.font = `italic 40px ${DISPLAY}`;
    c.fillText(fit(c, first.name, W - pad * 2), pad, pad + 164);

    // facts
    const mins = Math.round(plan.duration / 60);
    c.fillStyle = 'rgba(255,255,255,0.72)';
    c.font = `22px ${UI}`;
    const facts = `${mins} min loop · ${plan.sections.length} movements · key of ${AN.theory.keyName(plan.keyRoot)} · ~${plan.tempo} bpm`
      + (plan.daypartName ? ` · ${plan.daypartName.toLowerCase()}` : '');
    c.fillText(fit(c, facts, W - pad * 2), pad, pad + 212);

    // the environment layers that are switched on
    const env = AN.AMBIENCE_LAYERS.filter((l) => (settings.levels[l.id] || 0) > 0).map((l) => l.name.toLowerCase());
    if (env.length) {
      c.fillStyle = 'rgba(255,255,255,0.5)';
      c.font = `20px ${UI}`;
      c.fillText(fit(c, `with ${env.join(', ')}`, W - pad * 2), pad, pad + 248);
    }

    // timeline strip
    const stripY = 372, stripH = 34;
    roundRect(c, pad, stripY, W - pad * 2, stripH, 8);
    c.save();
    c.clip();
    let x = pad;
    for (const s of plan.sections) {
      const w = ((W - pad * 2) * s.length) / plan.duration;
      c.fillStyle = `hsl(${s.hue} 45% ${28 + s.intensity * 30}%)`;
      c.fillRect(x, stripY, Math.ceil(w), stripH);
      x += w;
    }
    c.restore();

    // movement names
    c.fillStyle = 'rgba(255,255,255,0.62)';
    c.font = `21px ${UI}`;
    const names = plan.sections.slice(0, 5).map((s) => s.name).join('  ·  ');
    c.fillText(fit(c, `${names}  ·  …`, W - pad * 2), pad, stripY + stripH + 42);

    // how to get it back
    c.fillStyle = 'rgba(255,255,255,0.45)';
    c.font = `20px ${UI}`;
    c.fillText(fit(c, `seed ${plan.seed}`, W - pad * 2), pad, H - pad + 10);
    c.textAlign = 'right';
    c.fillText('generated in the browser · no samples', W - pad, H - pad + 10);
    c.textAlign = 'left';

    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Could not draw the card'))), 'image/png');
    });
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
