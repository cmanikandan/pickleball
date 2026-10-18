/**
 * Web Audio API Procedural Spatial Sound Synthesizer for 3D Pickleball
 * - Synthesizes authentic polypropylene honeycomb + graphite / raw carbon-fiber paddle "pop" strikes
 * - 3D spatial PannerNode positioning for paddle hits, court bounces, net cord clips, and shoe squeaks
 * - Dynamic crowd reaction synthesizer scaling with rally length & shot intensity
 * - Optional tournament referee voice announcements
 */
export class SoundEngine {
  constructor() {
    this.ctx = null;
    this.masterGain = null;
    this.enabled = true;
    this.voiceEnabled = true;
    this.paddleCoreMaterial = 'carbon16'; // 'carbon16' (T700 Carbon 16mm) | 'graphite14' (Graphite 14mm)
    this.noiseBuffer = null;
    this.lastSqueakTime = 0;
  }

  init() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') {
        this.ctx.resume();
      }
      return;
    }
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return;

    this.ctx = new AudioCtx();
    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.value = 0.85;
    this.masterGain.connect(this.ctx.destination);

    // Pre-generate 2 seconds of white/pink noise for impact transients, shoe squeaks, and crowd applause
    const sr = this.ctx.sampleRate;
    this.noiseBuffer = this.ctx.createBuffer(1, sr * 2, sr);
    const data = this.noiseBuffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
  }

  createSpatialPanner(pos3D) {
    if (!this.ctx) return null;
    const panner = this.ctx.createPanner();
    panner.panningModel = 'equalpower';
    panner.distanceModel = 'inverse';
    panner.refDistance = 4.0;
    panner.maxDistance = 30.0;
    panner.rolloffFactor = 0.85;

    if (pos3D) {
      const now = this.ctx.currentTime;
      if (panner.positionX) {
        panner.positionX.setValueAtTime(pos3D.x || 0, now);
        panner.positionY.setValueAtTime(pos3D.y || 1, now);
        panner.positionZ.setValueAtTime((pos3D.z || 0) * 0.35, now);
      } else {
        panner.setPosition(pos3D.x || 0, pos3D.y || 1, (pos3D.z || 0) * 0.35);
      }
    }
    panner.connect(this.masterGain);
    return panner;
  }

  /**
   * Crisp, distinctive "POP" audio trigger tailored to high-grade Graphite or Raw Carbon-Fiber paddle strikes
   */
  playPaddlePop({
    pos = { x: 0, y: 1, z: 4 },
    shotType = 'drive',
    speedMps = 15,
    sweetSpot = 0.95,
  } = {}) {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const panner = this.createSpatialPanner(pos);

    const isGraphite = this.paddleCoreMaterial === 'graphite14';
    const intensity = Math.min(1.35, Math.max(0.32, speedMps / 18.0));
    const isSoftDink = shotType === 'dink' || shotType === 'drop';
    const isSmash = shotType === 'smash';

    // 1. Primary Polypropylene Honeycomb Cavity Resonance ("Pop" Body: 780Hz - 1350Hz)
    const oscPop = this.ctx.createOscillator();
    const popGain = this.ctx.createGain();
    oscPop.type = 'triangle';

    const baseFreq = isGraphite ? 1040 : 890;
    const pitchMod = (isSoftDink ? 0.88 : isSmash ? 1.16 : 1.0) * (0.9 + sweetSpot * 0.12);
    oscPop.frequency.setValueAtTime(baseFreq * 1.45 * pitchMod, now);
    oscPop.frequency.exponentialRampToValueAtTime(baseFreq * 0.72 * pitchMod, now + 0.042);

    popGain.gain.setValueAtTime(0.001, now);
    popGain.gain.linearRampToValueAtTime(0.55 * intensity, now + 0.0025);
    popGain.gain.exponentialRampToValueAtTime(0.001, now + (isSoftDink ? 0.048 : 0.068));

    oscPop.connect(popGain);
    popGain.connect(panner);
    oscPop.start(now);
    oscPop.stop(now + 0.075);

    // 2. Secondary Perforated Shell Harmonic Over-Ping (1420Hz - 2100Hz)
    const oscShell = this.ctx.createOscillator();
    const shellGain = this.ctx.createGain();
    oscShell.type = 'sine';
    const shellFreq = isGraphite ? 1760 : 1480;
    oscShell.frequency.setValueAtTime(shellFreq * pitchMod, now);
    oscShell.frequency.exponentialRampToValueAtTime(shellFreq * 0.82 * pitchMod, now + 0.032);

    shellGain.gain.setValueAtTime(0.32 * intensity, now);
    shellGain.gain.exponentialRampToValueAtTime(0.001, now + 0.036);

    oscShell.connect(shellGain);
    shellGain.connect(panner);
    oscShell.start(now);
    oscShell.stop(now + 0.04);

    // 3. Crisp Carbon-Fiber / Graphite Face Snap Transient (Bandpass Filtered Impulse Burst)
    const noiseSrc = this.ctx.createBufferSource();
    noiseSrc.buffer = this.noiseBuffer;

    const bpFilter = this.ctx.createBiquadFilter();
    bpFilter.type = 'bandpass';
    bpFilter.frequency.setValueAtTime(isGraphite ? 2850 : 2250, now);
    bpFilter.Q.setValueAtTime(3.2, now);

    const snapGain = this.ctx.createGain();
    snapGain.gain.setValueAtTime(0.68 * intensity, now);
    snapGain.gain.exponentialRampToValueAtTime(0.001, now + 0.022);

    noiseSrc.connect(bpFilter);
    bpFilter.connect(snapGain);
    snapGain.connect(panner);
    noiseSrc.start(now);
    noiseSrc.stop(now + 0.028);
  }

  /**
   * Hollow 40-hole polymer pickleball bounce on silica-sand acrylic court surface
   */
  playCourtBounce(pos = { x: 0, y: 0, z: 0 }, impactSpeed = 5.0, inBounds = true) {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const panner = this.createSpatialPanner(pos);
    const amp = Math.min(0.9, Math.max(0.18, impactSpeed / 9.5));

    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';

    // Hollow plastic court bounce resonant ping
    const f0 = inBounds ? 1160 : 920;
    osc.frequency.setValueAtTime(f0 * 1.25, now);
    osc.frequency.exponentialRampToValueAtTime(f0 * 0.78, now + 0.038);

    gain.gain.setValueAtTime(0.42 * amp, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.045);

    osc.connect(gain);
    gain.connect(panner);
    osc.start(now);
    osc.stop(now + 0.05);
  }

  /**
   * Net cord vinyl tape clip or net mesh thud
   */
  playNetImpact(pos = { x: 0, y: 0.86, z: 0 }, isCordRoll = false) {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const panner = this.createSpatialPanner(pos);

    const noiseSrc = this.ctx.createBufferSource();
    noiseSrc.buffer = this.noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.frequency.setValueAtTime(isCordRoll ? 1650 : 420, now);
    filter.Q.setValueAtTime(2.5, now);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(isCordRoll ? 0.45 : 0.55, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + (isCordRoll ? 0.06 : 0.11));

    noiseSrc.connect(filter);
    filter.connect(gain);
    gain.connect(panner);
    noiseSrc.start(now);
    noiseSrc.stop(now + 0.12);
  }

  /**
   * Localized Spatial Audio for Rubber Court Shoe Squeaks on Acrylic Surface
   */
  playShoeSqueak(pos = { x: 0, y: 0.05, z: 4 }, intensity = 0.7) {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const nowPerf = performance.now();
    if (nowPerf - this.lastSqueakTime < 260) return; // Prevent overlapping squeak spam
    this.lastSqueakTime = nowPerf;

    const now = this.ctx.currentTime;
    const panner = this.createSpatialPanner(pos);

    // High-pitched rubber stick-slip friction chirp (2900Hz -> 3750Hz -> 3100Hz)
    const osc = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    const gain = this.ctx.createGain();

    const basePitch = 2850 + Math.random() * 450;
    const dur = 0.075 + Math.random() * 0.045;

    osc.type = 'sine';
    osc.frequency.setValueAtTime(basePitch, now);
    osc.frequency.linearRampToValueAtTime(basePitch * 1.24, now + dur * 0.45);
    osc.frequency.exponentialRampToValueAtTime(basePitch * 0.92, now + dur);

    osc2.type = 'triangle';
    osc2.frequency.setValueAtTime(basePitch * 2.01, now);
    osc2.frequency.linearRampToValueAtTime(basePitch * 2.45, now + dur * 0.45);

    const vol = Math.min(0.22, 0.14 * intensity);
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(vol, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    osc.connect(gain);
    osc2.connect(gain);
    gain.connect(panner);

    osc.start(now);
    osc2.start(now);
    osc.stop(now + dur + 0.01);
    osc2.stop(now + dur + 0.01);
  }

  /**
   * Dynamic Crowd Reactions matching the intensity of long rallies, smashes, and point outcomes
   */
  playCrowdReaction(type = 'cheer', rallyLength = 4) {
    if (!this.enabled) return;
    this.init();
    if (!this.ctx) return;

    const now = this.ctx.currentTime;
    const rallyScale = Math.min(1.6, 0.65 + rallyLength * 0.09);

    if (type === 'gasp') {
      // Short stadium "Ooooh!" during intense smash or long kitchen rally exchange
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 4.2;
      filter.frequency.setValueAtTime(420, now);
      filter.frequency.linearRampToValueAtTime(680, now + 0.18);
      filter.frequency.exponentialRampToValueAtTime(460, now + 0.42);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.18 * rallyScale, now + 0.08);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

      src.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);
      src.start(now);
      src.stop(now + 0.48);
      return;
    }

    if (type === 'groan') {
      // Sympathetic crowd murmur/groan on unforced error or NVZ fault
      const src = this.ctx.createBufferSource();
      src.buffer = this.noiseBuffer;
      const filter = this.ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.value = 3.5;
      filter.frequency.setValueAtTime(520, now);
      filter.frequency.exponentialRampToValueAtTime(290, now + 0.65);

      const gain = this.ctx.createGain();
      gain.gain.setValueAtTime(0.001, now);
      gain.gain.linearRampToValueAtTime(0.22 * rallyScale, now + 0.1);
      gain.gain.exponentialRampToValueAtTime(0.001, now + 0.7);

      src.connect(filter);
      filter.connect(gain);
      gain.connect(this.masterGain);
      src.start(now);
      src.stop(now + 0.75);
      return;
    }

    // 'cheer' — Stadium applause + roar scaled by rallyLength
    const dur = Math.min(1.85, 0.85 + rallyLength * 0.08);
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuffer;

    const filter = this.ctx.createBiquadFilter();
    filter.type = 'bandpass';
    filter.Q.value = 1.4;
    filter.frequency.setValueAtTime(750, now);
    filter.frequency.linearRampToValueAtTime(1250, now + dur * 0.35);
    filter.frequency.exponentialRampToValueAtTime(650, now + dur);

    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(0.001, now);
    gain.gain.linearRampToValueAtTime(0.28 * rallyScale, now + 0.12);
    gain.gain.exponentialRampToValueAtTime(0.001, now + dur);

    src.connect(filter);
    filter.connect(gain);
    gain.connect(this.masterGain);
    src.start(now);
    src.stop(now + dur + 0.05);

    // Celebratory stadium chime chord on point won
    const freqs = [523.25, 659.25, 783.99, 1046.5];
    freqs.forEach((f, idx) => {
      const o = this.ctx.createOscillator();
      const g = this.ctx.createGain();
      o.type = 'triangle';
      o.frequency.setValueAtTime(f, now + idx * 0.045);
      g.gain.setValueAtTime(0.08, now + idx * 0.045);
      g.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.045 + 0.35);
      o.connect(g);
      g.connect(this.masterGain);
      o.start(now + idx * 0.045);
      o.stop(now + idx * 0.045 + 0.38);
    });
  }

  /**
   * Announces USAPA score or rule callout via SpeechSynthesis
   */
  announceReferee(text) {
    if (!this.enabled || !this.voiceEnabled) return;
    if (!('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.rate = 1.08;
      utter.pitch = 1.0;
      utter.volume = 0.75;
      window.speechSynthesis.speak(utter);
    } catch {
      // Ignore speech synthesis errors on restricted contexts
    }
  }
}
