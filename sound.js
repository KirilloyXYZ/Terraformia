(function () {
  "use strict";

  const PREFERENCE = "terraformia:mute";
  const MASTER_LEVEL = 0.68;

  function createSoundscape() {
    const AudioContext = globalThis.AudioContext || globalThis.webkitAudioContext;
    const lastCue = new Map();
    let context, master, noiseBuffer, wind, tracks, motor, resume;
    let muted = false;
    let wasActive = false;
    let lastMix = -Infinity;

    try {
      muted = globalThis.localStorage.getItem(PREFERENCE) === "1";
    } catch {
      // Sound is still available when storage is blocked.
    }

    function noise(type, frequency, loop = false) {
      const source = context.createBufferSource();
      const filter = context.createBiquadFilter();
      const gain = context.createGain();
      source.buffer = noiseBuffer;
      source.loop = loop;
      filter.type = type;
      filter.frequency.value = frequency;
      filter.Q.value = 0.7;
      gain.gain.value = 0;
      source.connect(filter);
      filter.connect(gain);
      gain.connect(master);
      return { source, filter, gain:gain.gain };
    }

    function prepare() {
      context = new AudioContext();
      master = context.createGain();
      master.gain.value = muted ? 0 : MASTER_LEVEL;
      const limiter = context.createDynamicsCompressor();
      limiter.threshold.value = -13;
      limiter.ratio.value = 5;
      master.connect(limiter);
      limiter.connect(context.destination);

      noiseBuffer = context.createBuffer(1, context.sampleRate * 4, context.sampleRate);
      const samples = noiseBuffer.getChannelData(0);
      for (let i = 0; i < samples.length; i++) samples[i] = Math.random() * 2 - 1;

      wind = noise("bandpass", 330, true);
      wind.source.start();
      tracks = noise("lowpass", 540, true);
      tracks.source.playbackRate.value = 1.18;
      tracks.source.start(0, 1.37);

      const oscillator = context.createOscillator();
      const filter = context.createBiquadFilter();
      const gain = context.createGain();
      oscillator.type = "triangle";
      oscillator.frequency.value = 52;
      filter.type = "lowpass";
      filter.frequency.value = 195;
      filter.Q.value = 0.1;
      gain.gain.value = 0;
      oscillator.connect(filter);
      filter.connect(gain);
      gain.connect(master);
      oscillator.start();
      motor = { pitch:oscillator.frequency, gain:gain.gain, filter:filter.frequency };
    }

    function unlock() {
      if (!AudioContext || muted) return;
      try {
        if (!context) prepare();
        if (context.state !== "running" && !resume) {
          resume = context.resume().catch(() => {}).finally(() => { resume = null; });
        }
      } catch {
        // Sound is optional on browsers without an available audio output.
      }
    }

    function toggle() {
      muted = !muted;
      try {
        globalThis.localStorage.setItem(PREFERENCE, muted ? "1" : "0");
      } catch {
        // Keep the choice for the current session.
      }
      if (master) master.gain.setTargetAtTime(muted ? 0 : MASTER_LEVEL, context.currentTime, 0.025);
      if (!muted) unlock();
    }

    function mix(active, speed, weather) {
      if (!motor || context.state !== "running" || (!active && !wasActive)) return;
      const now = context.currentTime;
      if (active && wasActive && now - lastMix < 0.055) return;
      wasActive = active;
      lastMix = now;
      const throttle = active ? Math.min(1, Math.max(0, speed)) : 0;
      const gust = 0.78 + 0.15 * Math.sin(now * 0.98) + 0.07 * Math.sin(now * 3.1);
      const breeze = weather.storm ? 0.31 : weather.night ? 0.105 : 0.14;
      wind.gain.setTargetAtTime(active && !muted ? breeze * gust : 0, now, 0.16);
      wind.filter.frequency.setTargetAtTime(weather.storm ? 620 : weather.night ? 275 : 410, now, 0.24);
      tracks.gain.setTargetAtTime(0.15 * throttle, now, 0.08);
      tracks.filter.frequency.setTargetAtTime(330 + 770 * throttle, now, 0.10);
      motor.gain.setTargetAtTime(0.095 * throttle, now, 0.06);
      motor.pitch.setTargetAtTime(49 + 46 * throttle, now, 0.075);
      motor.filter.setTargetAtTime(124 + 165 * throttle, now, 0.12);
    }

    function tone(frequency, endFrequency, start, duration, volume, type = "sine") {
      const oscillator = context.createOscillator();
      const envelope = context.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, start);
      oscillator.frequency.exponentialRampToValueAtTime(endFrequency, start + duration);
      envelope.gain.setValueAtTime(0.0001, start);
      envelope.gain.exponentialRampToValueAtTime(volume, start + Math.min(0.023, duration * 0.3));
      envelope.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      oscillator.connect(envelope);
      envelope.connect(master);
      oscillator.start(start);
      oscillator.stop(start + duration + 0.012);
    }

    function burst(frequency, start, duration, volume, type = "bandpass") {
      const voice = noise(type, frequency);
      voice.gain.setValueAtTime(0.0001, start);
      voice.gain.exponentialRampToValueAtTime(volume, start + 0.012);
      voice.gain.exponentialRampToValueAtTime(0.0001, start + duration);
      voice.source.start(start, 0.85);
      voice.source.stop(start + duration + 0.012);
    }

    function steps(notes, start, interval, volume) {
      notes.forEach((note, i) => tone(note, note, start + i * interval, interval * 2.1, volume));
    }

    function play(cue) {
      if (muted || !motor || context.state !== "running" || !cue) return;
      const now = context.currentTime + 0.008;
      const gap = cue === "refine" || cue === "harvest" ? 2.7 : cue === "denied" ? 0.45 : 0.25;
      if (now - (lastCue.get(cue) ?? -Infinity) < gap) return;
      lastCue.set(cue, now);

      switch (cue) {
        case "ice":
          burst(1800, now, 0.14, 0.19);
          steps([730, 1090], now + 0.025, 0.075, 0.085);
          break;
        case "ore":
          burst(740, now, 0.21, 0.27);
          tone(170, 91, now + 0.025, 0.16, 0.16, "triangle");
          break;
        case "unload":
          tone(128, 61, now, 0.18, 0.20, "triangle");
          burst(490, now + 0.047, 0.13, 0.24);
          steps([490, 650], now + 0.095, 0.09, 0.09);
          break;
        case "build":
          burst(1380, now, 0.09, 0.20);
          tone(112, 67, now + 0.065, 0.18, 0.16, "triangle");
          steps([392, 524, 658], now + 0.115, 0.075, 0.105);
          break;
        case "clean":
          burst(2450, now, 0.34, 0.19, "highpass");
          tone(630, 820, now + 0.105, 0.15, 0.074);
          break;
        case "activate":
          steps([420, 640], now, 0.065, 0.09);
          break;
        case "refine":
          tone(510, 570, now, 0.11, 0.072);
          break;
        case "harvest":
          steps([554, 740], now, 0.10, 0.085);
          break;
        case "delivery":
        case "survey":
          steps([440, 590, 740], now, 0.09, 0.10);
          break;
        case "achievement":
          steps([392, 494, 587, 784], now, 0.12, 0.15);
          tone(196, 196, now, 0.56, 0.12);
          break;
        case "forecast":
          steps([390, 475, 390, 475], now, 0.17, 0.16);
          break;
        case "storm":
          burst(420, now, 0.48, 0.24, "lowpass");
          tone(123, 53, now, 0.60, 0.15, "triangle");
          break;
        case "clear":
          steps([415, 554, 622], now, 0.115, 0.095);
          break;
        case "setback":
        case "defeat":
          steps([294, 247, 187], now, 0.16, 0.14);
          break;
        case "victory":
          steps([392, 494, 587, 784, 988], now, 0.15, 0.17);
          steps([196, 247, 294], now + 0.075, 0.22, 0.095);
          break;
        case "denied":
          tone(174, 132, now, 0.105, 0.075, "triangle");
          break;
      }
    }

    return { unlock, toggle, mix, play, get muted() { return muted; } };
  }

  if (typeof module === "object" && module.exports) module.exports = { createSoundscape };
  else globalThis.TerraformiaSound = { createSoundscape };
}());
