/* Small music theory toolkit: modes, diatonic chords, voicings. */
(function (root) {
  const AN = root.AN = root.AN || {};

  const NOTE_NAMES = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];

  const MODES = {
    major:      [0, 2, 4, 5, 7, 9, 11],
    lydian:     [0, 2, 4, 6, 7, 9, 11],
    mixolydian: [0, 2, 4, 5, 7, 9, 10],
    dorian:     [0, 2, 3, 5, 7, 9, 10],
    minor:      [0, 2, 3, 5, 7, 8, 10],
    phrygian:   [0, 1, 3, 5, 7, 8, 10],
  };

  const midiToFreq = (m) => 440 * Math.pow(2, (m - 69) / 12);

  /** Semitone offsets (from the key root) of the chord built on a scale degree. */
  function chordTones(mode, degree, size = 3) {
    const scale = MODES[mode];
    const out = [];
    for (let i = 0; i < size; i++) {
      const d = degree + 2 * i;
      out.push(scale[d % 7] + 12 * Math.floor(d / 7));
    }
    return out;
  }

  function chordQuality(tones) {
    const third = tones[1] - tones[0];
    const fifth = tones[2] - tones[0];
    const seventh = tones.length > 3 ? tones[3] - tones[0] : null;
    if (third === 4 && fifth === 7) return seventh === null ? '' : (seventh === 11 ? 'maj7' : '7');
    if (third === 3 && fifth === 7) return seventh === null ? 'm' : 'm7';
    if (third === 3 && fifth === 6) return seventh === null ? 'dim' : 'm7b5';
    if (third === 4 && fifth === 8) return seventh === null ? 'aug' : 'aug7';
    return '';
  }

  function chordName(keyRoot, mode, degree, size = 3) {
    const tones = chordTones(mode, degree, size);
    return NOTE_NAMES[(keyRoot + tones[0]) % 12] + chordQuality(tones);
  }

  /** Place chord tones (relative to keyMidi) inside an octave window around `center`. */
  function voiceChord(tones, keyMidi, center, spread = 12) {
    const notes = tones.map((t) => {
      let m = keyMidi + t;
      while (m < center - spread / 2) m += 12;
      while (m >= center + spread / 2) m -= 12;
      return m;
    });
    return Array.from(new Set(notes)).sort((a, b) => a - b);
  }

  /** Chord root placed within [low, low+12). */
  function rootInRange(rootTone, keyMidi, low) {
    let m = keyMidi + rootTone;
    while (m < low) m += 12;
    while (m >= low + 12) m -= 12;
    return m;
  }

  /** The octave of `midi`'s pitch class closest to `near`, kept inside [low, high]. */
  function nearestOctave(midi, near, low, high) {
    let m = midi;
    while (m - 12 >= low && Math.abs(m - 12 - near) < Math.abs(m - near)) m -= 12;
    while (m + 12 <= high && Math.abs(m + 12 - near) < Math.abs(m - near)) m += 12;
    return m;
  }

  /** All scale notes of a mode in [low, high]. */
  function scaleNotes(keyMidi, mode, low, high) {
    const scale = MODES[mode];
    const out = [];
    for (let m = low; m <= high; m++) {
      if (scale.includes(((m - keyMidi) % 12 + 12) % 12)) out.push(m);
    }
    return out;
  }

  AN.theory = {
    NOTE_NAMES, MODES, midiToFreq, chordTones, chordQuality, chordName,
    voiceChord, rootInRange, scaleNotes, nearestOctave,
    keyName: (root) => NOTE_NAMES[((root % 12) + 12) % 12],
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
