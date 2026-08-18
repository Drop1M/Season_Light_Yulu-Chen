// Seasons — An Interactive Light & Shadow Installation  v8  + audio layer

// =====================================================================
// AUDIO SYSTEM
// =====================================================================
// Layer 1 — background ambience (one per season, crossfade on transition)
// Layer 2 — interaction sounds (triggered by gesture, fade in/out)
//
// Volume levels are normalised here so nothing sounds jarring:
//   BG sounds  → target 0.32  (quiet bed, never overpowers visuals)
//   Interaction → target 0.55  (clearly audible but not harsh)
//
// BG_SUMMER is only 48 s so it loops; the others are long enough not to.
// INTERACTION_SPRING1/2 are ~1 s each and alternate so the loop
// doesn't feel robotic.  All interaction sounds loop while the gesture
// is active and fade out when the gesture ends.
// =====================================================================

// ---- volume targets (tweak these if anything feels too loud/quiet) ----
const BG_VOL        = 0.32;   // background ambience target volume
const INTERACT_VOL  = 0.55;   // interaction sound target volume (spring/summer/autumn)
const INTERACT_VOL_WINTER = 0.4;  // winter interaction was too loud relative to the others — tweak this alone if needed
const INTERACT_VOL_BY_SEASON = [INTERACT_VOL, INTERACT_VOL, INTERACT_VOL, INTERACT_VOL_WINTER]; // [spring, summer, autumn, winter]
const FADE_SPEED    = 0.025;  // how fast volume changes per frame (0~1 per frame)
const BG_FADE_SPEED = 0.008;  // crossfade speed for background (slower = smoother)

// ---- sound objects (filled in preload) ----
let bgSounds   = [];   // [spring, summer, autumn, winter]
let intSounds  = [];   // [spring-alternating, summer, autumn, winter]
// spring uses two files that swap each time one finishes
let springSound1, springSound2;
let springToggle = false;  // which spring sound plays next

// ---- runtime state ----
let currentBgIndex  = -1;   // which bg track is currently the "main" one
let bgVolumes       = [0, 0, 0, 0];  // live volume for each bg track
let intVolumes      = [0, 0, 0, 0];  // live volume for each interaction track
let audioStarted    = false;          // first user gesture unlocks Web Audio


// ---- preload: called automatically by p5 before setup() ----
function preload() {
  // p5's loadSound wraps Howler/Web Audio — files must be in the same folder
  // (or adjust the paths below if you put audio in a subfolder)
  springSound1  = loadSound('INTERACTION_SPRING1.mp3');
  springSound2  = loadSound('INTERACTION_SPRING2.mp3');

  bgSounds[0]   = loadSound('BG_SPRING.mp3');
  bgSounds[1]   = loadSound('BG_SUMMER.mp3');
  bgSounds[2]   = loadSound('BG_FALL.mp3');
  bgSounds[3]   = loadSound('BG_WINTER.mp3');

  // interaction sounds — index matches season (spring uses special alternating logic)
  intSounds[0]  = null;  // spring handled separately via springSound1/2
  intSounds[1]  = loadSound('INTERACTION_SUMMER.mp3');
  intSounds[2]  = loadSound('INTERACTION_FALL.mp3');
  intSounds[3]  = loadSound('INTERACTION_WINTER.mp3');
}


// ---- call once on first user interaction to unlock Web Audio context ----
function ensureAudioStarted() {
  if (audioStarted) return;
  audioStarted = true;
  getAudioContext().resume();

  // start all bg tracks at volume 0; we'll fade in the right one
  for (let i = 0; i < bgSounds.length; i++) {
    if (bgSounds[i] && bgSounds[i].isLoaded()) {
      bgSounds[i].setVolume(0);
      bgSounds[i].loop();
    }
  }

  // start interaction sounds looping silently
  for (let i = 1; i < intSounds.length; i++) {
    if (intSounds[i] && intSounds[i].isLoaded()) {
      intSounds[i].setVolume(0);
      intSounds[i].loop();
    }
  }

  // spring interaction sounds — these play once each (short clips, not looped)
  if (springSound1 && springSound1.isLoaded()) springSound1.setVolume(0);
  if (springSound2 && springSound2.isLoaded()) springSound2.setVolume(0);
}


// ---- called every frame from draw() ----
function updateAudio() {
  if (!audioStarted) return;

  // --- background crossfade ---
  // seasonIndex tells us which track should be the loudest.
  // During the blend period we crossfade: outgoing track fades to 0,
  // incoming track fades to BG_VOL.
  const targetBg = seasonIndex;          // main track
  const incomingBg = (seasonIndex + 1) % 4; // next track (only during blend)

  for (let i = 0; i < 4; i++) {
    let targetVol = 0;

    if (i === targetBg) {
      // current season — full volume, but fade out as blend progresses
      targetVol = BG_VOL * (1 - seasonBlend);
    } else if (i === incomingBg && seasonBlend > 0) {
      // next season fades in
      targetVol = BG_VOL * seasonBlend;
    }

    // smooth approach to target
    bgVolumes[i] = lerp(bgVolumes[i], targetVol, BG_FADE_SPEED);

    if (bgSounds[i] && bgSounds[i].isLoaded()) {
      bgSounds[i].setVolume(constrain(bgVolumes[i], 0, 1));
    }
  }

  // --- interaction sounds ---
  // Determine whether each season's interaction sound should be active
  const springActive  = (seasonIndex === 0 && currentGesture === 'open');
  const summerActive  = (seasonIndex === 1 && currentGesture === 'finger' &&
                         Math.abs(summerRotationSpeed) > 0.00002);
  const autumnActive  = (seasonIndex === 2 && autumnFingerActive &&
                         autumnPrevFingerPos !== null);
  const winterActive  = (seasonIndex === 3 && winterIntensity > 0.05);

  const interactActive = [springActive, summerActive, autumnActive, winterActive];

  // seasons 1-3: loop-based fade
  for (let i = 1; i <= 3; i++) {
    const targetVol = interactActive[i] ? INTERACT_VOL_BY_SEASON[i] : 0;
    intVolumes[i] = lerp(intVolumes[i], targetVol, FADE_SPEED);
    if (intSounds[i] && intSounds[i].isLoaded()) {
      intSounds[i].setVolume(constrain(intVolumes[i], 0, 1));
    }
  }

  // spring: alternating one-shot clips
  updateSpringInteractionSound(springActive);
}


// Spring interaction: two short clips alternate so it doesn't sound like a stuck record.
// Each clip plays once; when it finishes the other one is queued.
function updateSpringInteractionSound(active) {
  if (!springSound1 || !springSound2) return;
  if (!springSound1.isLoaded() || !springSound2.isLoaded()) return;

  const s1 = springSound1;
  const s2 = springSound2;

  if (active) {
    // fade volume up on whichever clip is currently playing
    intVolumes[0] = lerp(intVolumes[0], INTERACT_VOL, FADE_SPEED);
    const currentVol = constrain(intVolumes[0], 0, 1);

    // if neither clip is playing, start the next one in the alternation
    if (!s1.isPlaying() && !s2.isPlaying()) {
      springToggle = !springToggle;
      if (springToggle) {
        s1.setVolume(currentVol);
        s1.play();
      } else {
        s2.setVolume(currentVol);
        s2.play();
      }
    } else {
      // keep volume updated on whichever is playing
      if (s1.isPlaying()) s1.setVolume(currentVol);
      if (s2.isPlaying()) s2.setVolume(currentVol);
    }
  } else {
    // fade out
    intVolumes[0] = lerp(intVolumes[0], 0, FADE_SPEED);
    const currentVol = constrain(intVolumes[0], 0, 1);
    if (s1.isPlaying()) s1.setVolume(currentVol);
    if (s2.isPlaying()) s2.setVolume(currentVol);
  }
}

// =====================================================================
// END OF AUDIO SYSTEM
// =====================================================================

const PI_Q = Math.PI / 4;
const NUM_PARTICLES = 360;
const THICKNESS = 1.4;
const BODY_EXTRA = 4;

const MAX_BRIGHT_DIST = 560;
const MAX_SHADOW_LEN = 50;

// season timing — each season holds ~25s, transition ~7s
// full loop = (25000+7000)*4 = 128000ms ≈ 2 min
const SEASON_HOLD_MS = 25000;
const SEASON_BLEND_MS = 7000;

const LIGHT_SMOOTH = 0.08;

// ╔══════════════════════════════════════════════════════════════════╗
// ║  【★ 可调参数 ①】人脸距离 & 画面缩放                            ║
// ║  用 debug 面板看实际 Box width 数值，对照下面两个像素值校准。      ║
// ╚══════════════════════════════════════════════════════════════════╝
const FACE_NEAR_PX = 140;    // ← 人脸最近时人脸框的宽度（像素），越大=允许离得更近
const FACE_FAR_PX  = 75;     // ← 人脸最远时人脸框的宽度（像素），越小=允许离得更远

const VIEW_SCALE_MIN = 1.0;  // ← 人脸最远时画面缩放倍率（最小）
const VIEW_SCALE_MAX = 1.4;  // ← 人脸最近时画面缩放倍率（最大），调大=靠近时放大更明显
const VIEW_SCALE_SMOOTH = 0.035;
const LOST_FACE_DECAY = 0.02;

// hand gesture — only re-checked every few frames to save performance
const HAND_GESTURE_CHECK_INTERVAL = 3;

// ╔══════════════════════════════════════════════════════════════════╗
// ║  【★ 可调参数 ②】春天 & 冬天 — 张开 / 握拳 判定阈值             ║
// ║  openness 值越高=手越张开；超过阈值判为"张开"，低于则判为"握拳"。 ║
// ║  调大=需要张得更开才触发；调小=稍微张开就触发。                   ║
// ╚══════════════════════════════════════════════════════════════════╝
const HAND_OPENNESS_THRESHOLD = 2.0;   // ← 春天 & 冬天共用，改这一个数值即可

// ╔══════════════════════════════════════════════════════════════════╗
// ║  【★ 可调参数 ③】春天 — 手掌张开触发图案生长速度                 ║
// ║  GROWTH_GAIN_RATE：越大=长得越快，持续张开多久能长满由此决定。     ║
// ╚══════════════════════════════════════════════════════════════════╝
const GROWTH_GAIN_RATE = 0.0000526;   // ← 生长速率（每毫秒累积量）
const GROWTH_MAX = 1.0;

// ╔══════════════════════════════════════════════════════════════════╗
// ║  【★ 可调参数 ④】夏天 — 手指位置驱动图案旋转                     ║
// ║  手指在右半边顺时针转，在左半边逆时针转，位置越偏边缘速度越快。    ║
// ║  SUMMER_ROTATION_SMOOTH : 速度变化平滑度，越小=跟手越跟手越迟缓   ║
// ║  normalizedX * 0.0007   : 最大转速系数，改那个 0.0007 即可        ║
// ╚══════════════════════════════════════════════════════════════════╝
const SUMMER_FINGER_SMOOTH    = 0.25;   // smoothing for index finger position tracking
const SUMMER_ROTATION_SMOOTH  = 0.06;   // ← 转速变化平滑度（0~1，越大越跟手）
// max rotation speed is set in updateHandGesture() summer section: summerTargetRotationSpeed = normalizedX * 0.0007

// ╔══════════════════════════════════════════════════════════════════╗
// ║  【★ 可调参数 ⑤】秋天 — 手指风场推力                             ║
// ║  AUTUMN_WIND_RADIUS : 风场半径，越大=影响范围越广                 ║
// ║  AUTUMN_WIND_FORCE  : 推力强度，越大=薄片被吹得越远               ║
// ╚══════════════════════════════════════════════════════════════════╝
const AUTUMN_WIND_RADIUS = 180;        // ← 风场影响半径（像素）
const AUTUMN_WIND_FORCE  = 2.2;        // ← 每次检测间隔内的最大推动距离

// ╔══════════════════════════════════════════════════════════════════╗
// ║  【★ 可调参数 ⑥】冬天 — 风雪强度上升 / 下降速率                  ║
// ║  RISE_RATE：张开手掌时风雪增强的速度，越大=越快到顶               ║
// ║  FALL_RATE：握拳时风雪消散的速度，越大=消散越快                   ║
// ╚══════════════════════════════════════════════════════════════════╝
const WINTER_INTENSITY_RISE_RATE = 0.00045; // ← 张开时每毫秒增强量
const WINTER_INTENSITY_FALL_RATE = 0.0003;  // ← 握拳时每毫秒减弱量


// =====================================================================
// shape functions for each season
// each one takes a growth param (0~1) that controls how lush/detailed the shape looks
// =====================================================================

function springShape(t, i, time, growth) {
  const arms = 5;
  const armIndex = i % arms;
  const armT = Math.floor(i / arms) / Math.ceil(NUM_PARTICLES / arms);

  // slow spin so it still feels alive after fully grown, not just frozen
  const slowSpin = time * 0.00002;
  const angle = armT * Math.PI * 5 + (armIndex / arms) * TWO_PI + slowSpin;

  // positions are fixed from the start — growth shows through opacity fade-in, not movement
  // this avoids the problem where low-growth made everything bunch up in the center
  // outer petals have a longer delay before they start appearing (armT controls timing)
  const growthDelay = armT * 0.6;
  const localGrowth = constrain(map(growth, growthDelay, growthDelay + 0.4, 0, 1, true), 0, 1);

  const radius = 30 + armT * 360; // position is fixed, not scaled by growth
  const wiggle = sin(armT * 30 + time * 0.0006 + armIndex) * 6;

  const x = (radius + wiggle) * cos(angle);
  const y = (radius + wiggle) * sin(angle);
  const rot = angle + PI_Q + sin(armT * 10) * 0.3;
  const len = 30 + sin(armT * 18) * 14 + 20;

  // visibility is used by drawSingleParticle as an extra alpha multiplier
  // 0 = completely invisible, 1 = fully shown
  return { x, y, rot, len, visibility: localGrowth };

  return { x, y, rot, len };
}

function summerShape(t, i, time, growth) {
  const rings = 12;
  const ringIndex = i % rings;
  const idxInRing = Math.floor(i / rings);
  const itemsInRing = Math.ceil(NUM_PARTICLES / rings);

  const baseAngle = (idxInRing / itemsInRing) * TWO_PI;
  const radius = 25 + ringIndex * 26;


  // rotation is now controlled by finger position in real time via summerRotationOffset
  // (replaces the old fixed time*0.00012 auto-spin)
  const angle = baseAngle + summerRotationOffset;

  const petal = sin(baseAngle * 7 + time * 0.001) * 14;

  const x = (radius + petal) * cos(angle);
  const y = (radius + petal) * sin(angle);

  const rot = angle + Math.PI / 3 + cos(time * 0.0005 + radius * 0.01) * 0.3;
  const len = 35 + petal * 0.8;

  return { x, y, rot, len };
}

function autumnShape(t, i, time, growth) {
  const rx = pseudoRandom(i * 12.9898) * 2 - 1;
  const ry = pseudoRandom(i * 78.233) * 2 - 1;
  const spread = 420;

  const driftX = sin(time * 0.00012 + i * 0.3) * 18;
  const driftY = cos(time * 0.00009 + i * 0.5) * 14 + sin(time * 0.00015 + i) * 6;

  let x = rx * spread + driftX;
  let y = ry * spread + driftY;

  // wind-blown offset persists after finger moves away — pieces don't snap back
  const offset = autumnDragOffsets[i];
  if (offset) {
    x += offset.x;
    y += offset.y;
  }

  // wobble is a small circular motion that gets triggered when wind hits a piece
  // it decays over time so things gradually settle instead of staying rigid
  // elliptical path (not a perfect circle) looks more natural
  const wobbleStrength = autumnWobbleStrength[i];
  let wobbleX = 0, wobbleY = 0;
  if (wobbleStrength > 0.01) {
    const wobbleAngle = time * 0.006 + i * 1.7;
    wobbleX = cos(wobbleAngle) * wobbleStrength;
    wobbleY = sin(wobbleAngle) * wobbleStrength * 0.6;
  }
  x += wobbleX;
  y += wobbleY;

  // rotation: base direction + accumulated spin angle from being blown
  // this is what makes them look like they're actually tumbling, not just drifting
  const baseRot = atan2(y, x) + sin(i * 3.1) * 1.2;
  const rot = baseRot + autumnSpinAngle[i];

  const len = 22 + pseudoRandom(i * 33.3) * 20;

  return { x, y, rot, len };
}

function winterShape(t, i, time, windIntensity) {
  const layers = 10;
  const layerIndex = i % layers;
  const idxInLayer = Math.floor(i / layers);
  const itemsInLayer = Math.ceil(NUM_PARTICLES / layers);

  const baseAngle = (idxInLayer / itemsInLayer) * TWO_PI;
  const layerRadius = 25 + layerIndex * 32;

  const spinDir = layerIndex % 2 === 0 ? 1 : -1;
  const dynamicAngle = baseAngle + time * 0.00005 * spinDir;
  const hexAngle = dynamicAngle % (Math.PI / 3);

  const hexRadius = layerRadius / Math.cos(hexAngle - Math.PI / 6);

  // windIntensity drives both radial pulse and tangential sway
  // stronger open-palm = the whole crystal skeleton visibly gets blown around
  const crystalPulse = sin(time * 0.0002 + layerIndex) * (4 + windIntensity * 14);
  const windSway = sin(time * 0.0009 + layerIndex * 1.3) * windIntensity * 26;
  const finalRadius = hexRadius + crystalPulse;

  // slight angular wobble on top of the sway — stronger wind = more visible shake
  const windAngleOffset = sin(time * 0.0007 + idxInLayer * 0.4) * windIntensity * 0.25;
  const finalAngle = dynamicAngle + windAngleOffset;

  const x = finalRadius * cos(finalAngle) + windSway * cos(finalAngle + PI_Q);
  const y = finalRadius * sin(finalAngle) + windSway * sin(finalAngle + PI_Q);

  const rot = finalAngle + Math.PI / 2 + (Math.PI / 6) * sin(layerIndex * 8);
  const len = 22 + layerIndex * 1.5;

  return { x, y, rot, len };
}

function pseudoRandom(seed) {
  const x = Math.sin(seed) * 10000;
  return x - Math.floor(x);
}

const SHAPE_FUNCS = [springShape, summerShape, autumnShape, winterShape];


// =====================================================================
// season color definitions
// =====================================================================
const SEASONS = [
  {
    name: 'Spring', label: 'Spring · Bloom',
    bg: [15, 20, 16], body: [235, 250, 235],
    glowA: { color: [100, 240, 140], alpha: 0.75, shear: 16, blend: 'screen' },
    glowB: { color: [255, 110, 150], alpha: 0.65, shear: -4, blend: 'screen' },
    motionSpeed: 1.0
  },
  {
    name: 'Summer', label: 'Summer · Energy',
    bg: [8, 15, 13], body: [235, 250, 255],
    glowA: { color: [55, 220, 150], alpha: 0.75, shear: 20, blend: 'screen' },
    glowB: { color: [245, 215, 60], alpha: 0.6, shear: -3, blend: 'screen' },
    motionSpeed: 1.3
  },
  {
    name: 'Autumn', label: 'Autumn · Falling',
    bg: [16, 11, 8], body: [250, 235, 215],
    glowA: { color: [225, 110, 50], alpha: 0.7, shear: 24, blend: 'screen' },
    glowB: { color: [225, 165, 55], alpha: 0.55, shear: -6, blend: 'screen' },
    motionSpeed: 0.8
  },
  {
    name: 'Winter', label: 'Winter · Still',
    bg: [9, 11, 16], body: [225, 235, 250],
    glowA: { color: [130, 180, 245], alpha: 0.6, shear: 10, blend: 'screen' },
    glowB: { color: [220, 230, 245], alpha: 0.4, shear: -2, blend: 'screen' },
    motionSpeed: 0.35
  }
];

// weather particle colors — kept in the same palette as each season's glow
const WEATHER_COLORS = [
  [180, 235, 190],   // spring: soft green
  [180, 220, 255],   // summer: light blue rain
  [225, 150, 70],    // autumn: warm orange leaves
  [230, 238, 250]    // winter: white snow
];


// =====================================================================
// global state
// =====================================================================
let particles = [];
let lightX = 0, lightY = 0;
let targetLightX = 0, targetLightY = 0;
let lightActiveStrength = 0;

let viewScale = 1.0;
let targetViewScale = 1.0;

let inputMode = 'mouse';
let faceMeshModel;
let faceDetections = [];
let video;
let camReady = false;

// hand tracking state
let handPoseModel;
let handDetections = [];
let handReady = false;
let frameCounter = 0;

// gesture result — updated every few frames to reduce CPU load
let currentGesture = null;  // 'open' | 'finger' | 'drag' | 'fist' | null
let prevHandCenter = null;
let debugCurrentOpenness = null; // live openness value shown in debug panel

// vote buffer to smooth out noisy gesture detection
// keeps last N raw results and takes the majority — prevents flickering when fingers overlap
const GESTURE_VOTE_BUFFER_SIZE = 5;
let openFistVoteBuffer = [];

// summer: finger position drives rotation
let summerPrevFingerX = null;
let summerFingerX = null;
let summerRotationOffset = 0;     // accumulated angle offset (read by summerShape)
let summerRotationSpeed = 0;      // smoothed angular velocity
let summerTargetRotationSpeed = 0;

// autumn: each piece has its own persistent wind-blown offset (doesn't spring back)
let autumnDragOffsets = new Array(NUM_PARTICLES).fill(null).map(() => ({ x: 0, y: 0 }));
let autumnFingerActive = false;
let autumnFingerX = 0;
let autumnFingerY = 0;
let autumnPrevFingerPos = null; // used to calculate finger speed, which scales wind force

// per-piece tumble state — triggered by wind, decays over time
// makes pieces look like they're actually spinning in the air, not just sliding
let autumnSpinVelocity = new Array(NUM_PARTICLES).fill(0);
let autumnSpinAngle = new Array(NUM_PARTICLES).fill(0);
let autumnWobbleStrength = new Array(NUM_PARTICLES).fill(0);

// spring: growth progress (0~1) — increases while palm is open, holds when fist, never resets mid-season
let seasonGrowth = [0, 0, 0, 0]; // only index 0 (spring) is actually used

// winter: blizzard intensity — open palm raises it, fist lowers it (not instant on/off)
let winterIntensity = 0;

// weather particle pool
let weatherParticles = [];

let seasonIndex = 0;
let seasonBlend = 0;
let seasonTimer = 0;
let autoCycle = true;
let currentSeasonStyle = {};

let hintFadeStarted = false;
let motionClock = 0;

let showDebug = true;
let debugFaceBoxWidth = 0;
let debugFaceDetected = false;
let debugHandDetected = false;


// =====================================================================
// color lerp helpers
// =====================================================================
function lerpColor3(c1, c2, t) {
  return [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
}

function lerpGlow(g1, g2, t) {
  return {
    color: lerpColor3(g1.color, g2.color, t),
    alpha: lerp(g1.alpha, g2.alpha, t),
    shear: lerp(g1.shear, g2.shear, t),
    blend: t < 0.5 ? g1.blend : g2.blend
  };
}

function getInterpolatedStyle() {
  const a = SEASONS[seasonIndex];
  const b = SEASONS[(seasonIndex + 1) % SEASONS.length];
  const t = seasonBlend;
  return {
    name: t < 0.5 ? a.name : b.name,
    label: t < 0.5 ? a.label : b.label,
    bg: lerpColor3(a.bg, b.bg, t),
    body: lerpColor3(a.body, b.body, t),
    glowA: lerpGlow(a.glowA, b.glowA, t),
    glowB: lerpGlow(a.glowB, b.glowB, t),
    motionSpeed: lerp(a.motionSpeed, b.motionSpeed, t)
  };
}


// =====================================================================
// setup
// =====================================================================
function setup() {
  createCanvas(windowWidth, windowHeight);
  rectMode(CENTER);
  noStroke();
  colorMode(RGB, 255);

  for (let i = 0; i < NUM_PARTICLES; i++) {
    particles.push({ i: i, t: i / NUM_PARTICLES });
  }

  setupCamera();
  setupHandTracking();

  // Unlock Web Audio on first user interaction.
  // p5.sound needs a user gesture before any sound can play;
  // we register a one-time listener here so audio starts as soon
  // as the viewer moves their mouse or touches the screen.
  const unlockAudio = () => {
    ensureAudioStarted();
    window.removeEventListener('mousemove', unlockAudio);
    window.removeEventListener('touchstart', unlockAudio);
    window.removeEventListener('keydown', unlockAudio);
  };
  window.addEventListener('mousemove', unlockAudio);
  window.addEventListener('touchstart', unlockAudio);
  window.addEventListener('keydown', unlockAudio);
}

function windowResized() {
  resizeCanvas(windowWidth, windowHeight);
}


// =====================================================================
// camera + face tracking setup
// =====================================================================
function setupCamera() {
  const statusText = document.getElementById('statusText');
  const statusDot = document.getElementById('statusDot');

  function setStatus(text, state) {
    if (statusText) statusText.textContent = text;
    if (statusDot) {
      statusDot.classList.remove('active', 'error');
      if (state === 'ok') statusDot.classList.add('active');
      if (state === 'error') statusDot.classList.add('error');
    }
  }

  if (location.protocol === 'file:') {
    setStatus('Camera disabled (file:// protocol) · Mouse control active', 'error');
    inputMode = 'mouse';
    return;
  }
  if (typeof ml5 === 'undefined') {
    setStatus('ml5.js not loaded · Mouse control active', 'error');
    inputMode = 'mouse';
    return;
  }

  setStatus('Loading face tracking model…', null);

  try {
    faceMeshModel = ml5.faceMesh({ maxFaces: 1, flipped: true }, () => {
      setStatus('Requesting camera access…', null);

      video = createCapture(VIDEO, () => {
        video.size(320, 240);
        video.hide();
        camReady = true;
        inputMode = 'face';
        setStatus('Camera connected', 'ok');

        faceMeshModel.detectStart(video, (results) => {
          faceDetections = results;
        });
      });
    });
  } catch (e) {
    inputMode = 'mouse';
    setStatus('Face tracking init failed · Mouse control active', 'error');
  }
}


// =====================================================================
// hand tracking setup
// shares the same video stream as face tracking, just a separate ml5 model
// polling loop waits for video to be ready before starting detectStart
// =====================================================================
function setupHandTracking() {
  const handStatusText = document.getElementById('handStatusText');

  function setHandStatus(text) {
    if (handStatusText) handStatusText.textContent = text;
  }

  if (location.protocol === 'file:' || typeof ml5 === 'undefined') {
    setHandStatus('Gesture tracking unavailable');
    return;
  }

  setHandStatus('Loading gesture tracking model…');

  try {
    handPoseModel = ml5.handPose({ maxHands: 1, flipped: true }, () => {
      // video is created by setupCamera asynchronously, so poll until it exists
      const waitForVideo = setInterval(() => {
        if (video) {
          clearInterval(waitForVideo);
          handReady = true;
          setHandStatus('Gesture tracking active');
          handPoseModel.detectStart(video, (results) => {
            handDetections = results;
          });
        }
      }, 200);
    });
  } catch (e) {
    setHandStatus('Gesture tracking init failed');
  }
}


function keyPressed() {
  if (key === '1') jumpToSeason(0);
  if (key === '2') jumpToSeason(1);
  if (key === '3') jumpToSeason(2);
  if (key === '4') jumpToSeason(3);
  if (key === ' ') autoCycle = !autoCycle;
  if (key === 'd' || key === 'D') {
    showDebug = !showDebug;
    const dbg = document.getElementById('debugInfo');
    if (dbg) dbg.style.display = showDebug ? 'block' : 'none';
  }
}

function jumpToSeason(idx) {
  seasonIndex = idx;
  seasonBlend = 0;
  seasonTimer = 0;
  autoCycle = false;
  onSeasonEnter(idx);
}


// =====================================================================
// gesture detection
// only runs every HAND_GESTURE_CHECK_INTERVAL frames to save performance
//
// each season has its own interaction:
//   spring: open palm = grow, fist = pause growth
//   summer: finger on right half = clockwise, left half = counterclockwise
//   autumn: index finger pushes nearby pieces away like a wind source
//   winter: open palm = build up blizzard, fist = let it die down
// =====================================================================

// calculates how open the hand is — ratio of avg fingertip distance to palm width
function calcHandOpenness(kp) {
  const wrist = kp[0];
  const fingerTipIndices = [4, 8, 12, 16, 20];
  let avgTipDist = 0;
  for (const idx of fingerTipIndices) {
    avgTipDist += dist(kp[idx].x, kp[idx].y, wrist.x, wrist.y);
  }
  avgTipDist /= fingerTipIndices.length;

  let palmWidth = dist(kp[5].x, kp[5].y, kp[17].x, kp[17].y);
  palmWidth = Math.max(palmWidth, 1);

  return avgTipDist / palmWidth;
}

// majority vote over last N frames — prevents one or two noisy frames from
// flipping the gesture state (especially common when fingers overlap during a fist)
function voteGesture(rawResult) {
  openFistVoteBuffer.push(rawResult);
  if (openFistVoteBuffer.length > GESTURE_VOTE_BUFFER_SIZE) {
    openFistVoteBuffer.shift();
  }

  let openCount = 0, fistCount = 0;
  for (const g of openFistVoteBuffer) {
    if (g === 'open') openCount++;
    else if (g === 'fist') fistCount++;
  }

  if (openCount > fistCount && openCount >= 2) return 'open';
  if (fistCount > openCount && fistCount >= 2) return 'fist';
  // not enough votes either way — hold whatever we had before to avoid flickering
  if (currentGesture === 'open' || currentGesture === 'fist') return currentGesture;
  return null;
}

function updateHandGesture() {
  frameCounter++;
  if (frameCounter % HAND_GESTURE_CHECK_INTERVAL !== 0) return;

  debugHandDetected = handDetections && handDetections.length > 0;

  if (!debugHandDetected) {
    currentGesture = null;
    autumnFingerActive = false;
    summerTargetRotationSpeed = 0;
    summerPrevFingerX = null;
    debugCurrentOpenness = null;
    return;
  }

  const hand = handDetections[0];
  const kp = hand.keypoints;
  if (!kp || kp.length < 21) {
    currentGesture = null;
    autumnFingerActive = false;
    summerTargetRotationSpeed = 0;
    summerPrevFingerX = null;
    debugCurrentOpenness = null;
    return;
  }

  const indexTip = kp[8]; // index fingertip

  // ---- spring: open = grow, fist = pause ----
  if (seasonIndex === 0) {
    autumnFingerActive = false;
    summerTargetRotationSpeed = 0;
    const openness = calcHandOpenness(kp);
    debugCurrentOpenness = openness;

    const rawResult = openness > HAND_OPENNESS_THRESHOLD ? 'open' : 'fist';

    currentGesture = voteGesture(rawResult);
    return;
  }

  // ---- summer: finger on right half = clockwise, left half = counterclockwise ----
  if (seasonIndex === 1) {
    currentGesture = 'finger';
    autumnFingerActive = false;

    const vw = (video && video.videoWidth) ? video.videoWidth : 320;

    // smooth the position to reduce jitter
    if (summerFingerX === null) summerFingerX = indexTip.x;
    summerFingerX = lerp(summerFingerX, indexTip.x, SUMMER_FINGER_SMOOTH);

    // normalize to -1 (far left) ~ +1 (far right), use distance from center as speed
    const normalizedX = (summerFingerX / vw) * 2 - 1;
    summerTargetRotationSpeed = normalizedX * 0.0007;
    return;
  }

  // ---- autumn: index finger position = wind source, pushes nearby pieces outward ----
  if (seasonIndex === 2) {
    currentGesture = 'drag';
    summerTargetRotationSpeed = 0;
    summerPrevFingerX = null;

    const vw = (video && video.videoWidth) ? video.videoWidth : 320;
    const vh = (video && video.videoHeight) ? video.videoHeight : 240;
    const nx = (indexTip.x / vw) * 2 - 1;
    const ny = (indexTip.y / vh) * 2 - 1;

    autumnFingerX = nx * 420;
    autumnFingerY = ny * 420;
    autumnFingerActive = true;
    return;
  }

  // ---- winter: open = blizzard builds up, fist = blizzard fades out ----
  if (seasonIndex === 3) {
    autumnFingerActive = false;
    summerTargetRotationSpeed = 0;

    const openness = calcHandOpenness(kp);
    debugCurrentOpenness = openness;

    const rawResult = openness > HAND_OPENNESS_THRESHOLD ? 'open' : 'fist';

    currentGesture = voteGesture(rawResult);
    return;
  }
}

// runs every frame (not rate-limited) so the rotation animation stays smooth
// target speed is set by updateHandGesture(), this just lerps toward it
function updateSummerRotation() {
  summerRotationSpeed = lerp(summerRotationSpeed, summerTargetRotationSpeed, SUMMER_ROTATION_SMOOTH);
  // when hand is gone, let speed coast down slowly instead of cutting to zero instantly
  if (summerTargetRotationSpeed === 0) {
    summerRotationSpeed *= 0.97;
  }
  summerRotationOffset += summerRotationSpeed * deltaTime;
}

// autumn wind field update:
// finger is the wind source — nearby pieces get pushed outward
// wind force scales with how fast the finger is moving (still finger = no wind)
// tumble/wobble state decays every frame regardless of whether finger is active
function updateAutumnDrag() {
  if (seasonIndex === 2 && autumnFingerActive) {
    // finger speed = difference between current and last frame position
    let fingerSpeed = 0;
    if (autumnPrevFingerPos) {
      const fdx = autumnFingerX - autumnPrevFingerPos.x;
      const fdy = autumnFingerY - autumnPrevFingerPos.y;
      fingerSpeed = Math.sqrt(fdx * fdx + fdy * fdy);
    }
    autumnPrevFingerPos = { x: autumnFingerX, y: autumnFingerY };

    // only generate wind if finger is actually moving
    if (fingerSpeed >= 0.6) {
      const windStrength = constrain(fingerSpeed, 0, 14) * AUTUMN_WIND_FORCE * 0.12;

      for (let i = 0; i < NUM_PARTICLES; i++) {
        const rx = pseudoRandom(i * 12.9898) * 2 - 1;
        const ry = pseudoRandom(i * 78.233) * 2 - 1;
        const baseX = rx * 420;
        const baseY = ry * 420;

        const currentOffset = autumnDragOffsets[i];
        const currentX = baseX + currentOffset.x;
        const currentY = baseY + currentOffset.y;

        const dxAway = currentX - autumnFingerX;
        const dyAway = currentY - autumnFingerY;
        const distToFinger = Math.sqrt(dxAway * dxAway + dyAway * dyAway);

        if (distToFinger < AUTUMN_WIND_RADIUS && distToFinger > 0.01) {
          const influence = 1 - distToFinger / AUTUMN_WIND_RADIUS;
          const pushAmount = windStrength * influence;

          currentOffset.x += (dxAway / distToFinger) * pushAmount;
          currentOffset.y += (dyAway / distToFinger) * pushAmount;

          // also kick the piece into a spin — closer to finger = stronger spin
          // random direction per piece so they don't all rotate the same way
          const spinKick = influence * windStrength * 0.08;
          const spinDir = pseudoRandom(i * 7.77) > 0.5 ? 1 : -1;
          autumnSpinVelocity[i] += spinKick * spinDir;
          autumnWobbleStrength[i] = min(40, autumnWobbleStrength[i] + influence * windStrength * 1.8);
        }
      }
    }
  } else {
    autumnPrevFingerPos = null;
  }

  // decay runs every frame regardless — spin and wobble gradually settle down
  // feels more like real leaves coming to rest than an instant stop
  for (let i = 0; i < NUM_PARTICLES; i++) {
    autumnSpinAngle[i] += autumnSpinVelocity[i] * deltaTime * 0.001;
    autumnSpinVelocity[i] *= 0.985;
    autumnWobbleStrength[i] *= 0.992;
  }
}



// =====================================================================
// spring growth + winter intensity update
// spring: growth only increases (open palm), never decreases — fist just pauses it
// winter: intensity rises with open palm, drops with fist, stays put if no clear gesture
// =====================================================================
function updateSeasonGrowth() {
  if (seasonIndex === 0 && currentGesture === 'open') {
    seasonGrowth[0] = min(GROWTH_MAX, seasonGrowth[0] + GROWTH_GAIN_RATE * deltaTime);
  }
  // fist or no gesture = hold current growth, not reverse it
}

function updateWinterIntensity() {
  if (seasonIndex === 3 && currentGesture === 'open') {
    winterIntensity = min(1.0, winterIntensity + WINTER_INTENSITY_RISE_RATE * deltaTime);
  } else if (seasonIndex === 3 && currentGesture === 'fist') {
    winterIntensity = max(0, winterIntensity - WINTER_INTENSITY_FALL_RATE * deltaTime);
  }
  // no clear gesture = hold intensity, requires active hand input to change
}



// =====================================================================
// light source update — face position drives light, face distance drives zoom
// falls back to mouse if no face detected
// =====================================================================
function updateLightTarget() {
  let usingFace = false;

  if (inputMode === 'face' && camReady && faceDetections && faceDetections.length > 0) {
    const face = faceDetections[0];
    const kp = face.keypoints;

    if (kp && kp.length > 0 && kp[0].x !== undefined) {
      let sx = 0, sy = 0;
      for (let i = 0; i < kp.length; i++) {
        sx += kp[i].x; sy += kp[i].y;
      }
      const cx = sx / kp.length;
      const cy = sy / kp.length;

      if (!isNaN(cx) && !isNaN(cy)) {
        const vw = video.width || 320;
        const vh = video.height || 240;

        const nx = (cx / vw) * 2 - 1;
        const ny = (cy / vh) * 2 - 1;

        targetLightX = nx * (width * 0.55);
        targetLightY = ny * (height * 0.55);

        const box = face.box;
        if (box && box.width) {
          debugFaceBoxWidth = box.width;
          debugFaceDetected = true;

          const proximity = constrain(
            map(box.width, FACE_FAR_PX, FACE_NEAR_PX, 0.9, 1.15, true),
            0.9, 1.2
          );
          lightActiveStrength = lerp(lightActiveStrength, proximity, 0.08);

          targetViewScale = constrain(
            map(box.width, FACE_FAR_PX, FACE_NEAR_PX, VIEW_SCALE_MIN, VIEW_SCALE_MAX, true),
            VIEW_SCALE_MIN, VIEW_SCALE_MAX
          );
        } else {
          lightActiveStrength = lerp(lightActiveStrength, 1.0, 0.08);
          targetViewScale = lerp(targetViewScale, 1.0, LOST_FACE_DECAY);
        }
        usingFace = true;
      }
    }
  }

  if (!usingFace) {
    targetLightX = mouseX - width / 2;
    targetLightY = mouseY - height / 2;
    lightActiveStrength = lerp(lightActiveStrength, 1.0, 0.08);

    debugFaceDetected = false;

    if (inputMode === 'face') {
      targetViewScale = lerp(targetViewScale, 1.0, LOST_FACE_DECAY);
    } else {
      targetViewScale = 1.0;
    }
  }

  lightX = lerp(lightX, targetLightX, LIGHT_SMOOTH);
  lightY = lerp(lightY, targetLightY, LIGHT_SMOOTH);

  viewScale = lerp(viewScale, targetViewScale, VIEW_SCALE_SMOOTH);
}


// =====================================================================
// season timer + transition
// =====================================================================
function updateSeasonClock() {
  if (!autoCycle) return;

  seasonTimer += deltaTime;

  if (seasonTimer < SEASON_HOLD_MS) {
    seasonBlend = 0;
  } else if (seasonTimer < SEASON_HOLD_MS + SEASON_BLEND_MS) {
    // reset the incoming season's state at the very first frame of transition,
    // not at the end — otherwise the next season starts with last cycle's leftover state
    // (e.g. spring would already be fully grown when transition finishes)
    const wasZero = seasonBlend === 0;
    const localT = (seasonTimer - SEASON_HOLD_MS) / SEASON_BLEND_MS;
    seasonBlend = localT < 0.5
      ? 4 * localT * localT * localT
      : 1 - Math.pow(-2 * localT + 2, 3) / 2;

    if (wasZero && seasonBlend > 0) {
      onSeasonEnter((seasonIndex + 1) % SEASONS.length);
    }
  } else {
    seasonIndex = (seasonIndex + 1) % SEASONS.length;
    seasonTimer = 0;
    seasonBlend = 0;
  }
}

// called whenever a season starts (auto cycle or manual key press)
// resets any accumulated state so each cycle starts fresh:
//   spring: growth resets to 0 so it grows from scratch
//   autumn: wind offsets clear so pieces start in clean floating positions
//   winter: blizzard resets to 0 so it doesn't start at full intensity
function onSeasonEnter(idx) {
  if (idx === 0) {
    seasonGrowth[0] = 0;
  } else if (idx === 2) {
    for (let i = 0; i < NUM_PARTICLES; i++) {
      autumnDragOffsets[i].x = 0;
      autumnDragOffsets[i].y = 0;
    }
  } else if (idx === 3) {
    winterIntensity = 0;
  }
}



// =====================================================================
// weather particle system
// only winter uses particles — summer rain was removed, spring/autumn use shape changes instead
// spawn rate and wind strength scale with winterIntensity (0~1)
// =====================================================================
function spawnWeatherParticles() {
  if (seasonIndex !== 3) return;
  if (winterIntensity <= 0.02) return; // don't spawn anything if intensity is basically zero

  const c = WEATHER_COLORS[3];
  // higher intensity = more particles per frame (1 to 5)
  const spawnCount = Math.ceil(map(winterIntensity, 0, 1, 1, 5, true));

  for (let i = 0; i < spawnCount; i++) {
    // stronger blizzard = more horizontal drift, feels more like being blown sideways
    const windForce = map(winterIntensity, 0, 1, 0.3, 3.5, true);

    let particle = {
      x: random(-width / 2 - 100, width / 2 + 100),
      y: -height / 2 - random(0, 100),
      vx: random(-windForce, windForce * 0.4) - windForce * 0.5, // biased toward one direction
      vy: random(1.5, 3 + winterIntensity * 3),
      len: random(3, 8),
      swayPhase: random(TWO_PI),
      color: c
    };

    weatherParticles.push(particle);
  }

  if (weatherParticles.length > 320) {
    weatherParticles.splice(0, weatherParticles.length - 320);
  }
}

function updateAndDrawWeatherParticles() {
  for (let i = weatherParticles.length - 1; i >= 0; i--) {
    const p = weatherParticles[i];

    p.y += p.vy;
    if (p.swayPhase !== undefined) {
      p.swayPhase += 0.05;
      p.x += p.vx + sin(p.swayPhase) * 0.6;
    } else {
      p.x += p.vx;
    }

    // remove when out of frame
    const outOfBounds = p.y > height / 2 + 60 || p.y < -height / 2 - 60;
    if (outOfBounds) {
      p.life = 0;
      weatherParticles.splice(i, 1);
      continue;
    }

    // draw as thin rectangles — matches the piece visual language, using screen blend
    push();
    translate(p.x, p.y);
    rotate(p.vx * 0.3 + (p.swayPhase ? sin(p.swayPhase) * 0.3 : 0));
    drawingContext.globalCompositeOperation = 'screen';
    const c = p.color;
    fill(c[0], c[1], c[2], 160);
    rect(0, 0, 1.4, p.len);
    drawingContext.globalCompositeOperation = 'source-over';
    pop();
  }
}


// =====================================================================
// UI update
// =====================================================================
// gesture hint shown on screen — tells the viewer what to do each season
const GESTURE_HINTS = [
  'Open your palm toward the camera — let life emerge from stillness',
  'Slide your finger left or right — the light follows your hand',
  'Swipe across the air — feel the wind carry the leaves',
  'Open your palm to call the storm · Close your fist to let it rest'
];

function updateUI(style) {
  if (window.updateSeasonLabelDOM) window.updateSeasonLabelDOM(style.label);

  const gestureHintEl = document.getElementById('gestureHint');
  if (gestureHintEl) {
    // Use the same season the label shows — incoming season when blend > 0.5,
    // current season otherwise. Keeps hint in sync with the season name.
    const hintSeasonIdx = seasonBlend > 0.5
      ? (seasonIndex + 1) % GESTURE_HINTS.length
      : seasonIndex;
    gestureHintEl.textContent = GESTURE_HINTS[hintSeasonIdx];
  }

  if (!hintFadeStarted && millis() > 9000) {
    hintFadeStarted = true;
    const hintEl = document.getElementById('hint');
    if (hintEl) hintEl.style.opacity = '0';
  }

  // DEBUG PANEL — remove the /* and */ below to re-enable, then press D to toggle
  /*
  if (showDebug) {
    const dbg = document.getElementById('debugInfo');
    if (dbg) {
      const gestureNames = { open: 'open', finger: 'index finger', drag: 'dragging', fist: 'fist' };
      const opennessText = debugCurrentOpenness === null ? 'none' : debugCurrentOpenness.toFixed(3);
      dbg.textContent =
        `Face: ${debugFaceDetected ? 'yes' : 'no'}  Box width: ${debugFaceBoxWidth.toFixed(0)}px\n` +
        `FACE_NEAR_PX=${FACE_NEAR_PX}  FACE_FAR_PX=${FACE_FAR_PX}\n` +
        `View scale: ${viewScale.toFixed(2)}x\n` +
        `Hand: ${debugHandDetected ? 'yes' : 'no'}  Gesture: ${currentGesture ? gestureNames[currentGesture] : 'none'}\n` +
        `[Spring/Winter] openness: ${opennessText}  (threshold: >${HAND_OPENNESS_THRESHOLD} = open)\n` +
        `Spring growth: ${(seasonGrowth[0]*100).toFixed(0)}%\n` +
        `Summer spin: ${summerRotationSpeed.toFixed(5)}\n` +
        `Autumn wind: ${autumnFingerActive ? 'active (' + autumnFingerX.toFixed(0) + ',' + autumnFingerY.toFixed(0) + ')' : 'inactive'}\n` +
        `Winter blizzard: ${(winterIntensity*100).toFixed(0)}%`;
    }
  }
  */
}


// =====================================================================
// main draw loop
// =====================================================================
function draw() {
  updateSeasonClock();
  updateLightTarget();
  updateHandGesture();
  updateSeasonGrowth();
  updateWinterIntensity();
  updateSummerRotation();
  updateAutumnDrag();
  updateAudio();  // audio layer — runs every frame for smooth crossfades

  currentSeasonStyle = getInterpolatedStyle();
  updateUI(currentSeasonStyle);

  motionClock += deltaTime * currentSeasonStyle.motionSpeed;

  spawnWeatherParticles();

  background(currentSeasonStyle.bg[0], currentSeasonStyle.bg[1], currentSeasonStyle.bg[2]);
  translate(width / 2, height / 2);

  scale(viewScale);

  const shapeA = SHAPE_FUNCS[seasonIndex];
  const shapeB = SHAPE_FUNCS[(seasonIndex + 1) % SHAPE_FUNCS.length];

  const localLightX = lightX / viewScale;
  const localLightY = lightY / viewScale;

  // winter passes windIntensity as the extra param, others pass their growth value
  const extraParamA = seasonIndex === 3 ? winterIntensity : seasonGrowth[seasonIndex];
  const extraParamB = ((seasonIndex + 1) % SEASONS.length) === 3 ? winterIntensity : seasonGrowth[(seasonIndex + 1) % SEASONS.length];

  for (const p of particles) {
    const stateA = shapeA(p.t, p.i, motionClock, extraParamA);
    const stateB = shapeB(p.t, p.i, motionClock, extraParamB);

    const x = lerp(stateA.x, stateB.x, seasonBlend);
    const y = lerp(stateA.y, stateB.y, seasonBlend);
    const rotation = lerpAngle(stateA.rot, stateB.rot, seasonBlend);
    const len = lerp(stateA.len, stateB.len, seasonBlend);

    // visibility only exists on springShape — other seasons default to 1 (fully visible)
    const visA = stateA.visibility ?? 1;
    const visB = stateB.visibility ?? 1;
    const visibility = lerp(visA, visB, seasonBlend);

    drawSingleParticle(x, y, rotation, len, localLightX, localLightY, currentSeasonStyle, visibility);
  }

  // weather particles drawn on top, inside the same scale/translate space
  updateAndDrawWeatherParticles();

  drawLightCursor();
}

// draws one piece — glow layers first, then the body rect on top
// extraAlphaMul handles spring's fade-in growth (0 = invisible, skip draw entirely)
function drawSingleParticle(x, y, rotation, len, localLightX, localLightY, style, extraAlphaMul) {
  const alphaMul = extraAlphaMul === undefined ? 1 : extraAlphaMul;
  if (alphaMul <= 0.001) return;

  const dx = x - localLightX;
  const dy = y - localLightY;
  const d = dist(x, y, localLightX, localLightY);

  let brightness = map(d, 0, MAX_BRIGHT_DIST, 1.0, 0.0, true);
  brightness *= constrain(lightActiveStrength, 0, 1.4);
  brightness = constrain(brightness, 0, 1.1);
  brightness *= alphaMul;

  if (brightness <= 0.001) return;

  const lightAngle = atan2(dy, dx);
  const angleDiff = lightAngle - rotation;
  const localDirX = cos(angleDiff);
  const signX = localDirX >= 0 ? 1 : -1;

  const shadowLen = map(d, 0, (width / 2) / viewScale, 0, MAX_SHADOW_LEN, true);
  const bodyLen = len + BODY_EXTRA;

  push();
  translate(x, y);

  drawGlowLayer(style.glowA, rotation, signX, shadowLen, bodyLen, brightness);
  drawGlowLayer(style.glowB, rotation, signX, shadowLen, bodyLen, brightness);

  drawingContext.globalCompositeOperation = 'source-over';
  const bc = style.body;
  fill(bc[0], bc[1], bc[2], constrain(190 * brightness + 26, 0, 255) * alphaMul);
  rotate(rotation);
  rect(0, 0, THICKNESS, bodyLen);

  pop();
}

function lerpAngle(a, b, t) {
  let diff = ((b - a + PI) % TWO_PI + TWO_PI) % TWO_PI - PI;
  return a + diff * t;
}


// =====================================================================
// glow layer rendering
// =====================================================================
function drawGlowLayer(glow, rotation, signX, shadowLen, bodyLen, brightness) {
  drawingContext.globalCompositeOperation = glow.blend;

  push();
  rotate(rotation);
  shearY(radians(glow.shear * signX));

  const alpha = constrain(glow.alpha * brightness, 0, 1);
  const c = glow.color;

  const grad = drawingContext.createLinearGradient(0, 0, shadowLen * signX, 0);
  grad.addColorStop(0, `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${alpha})`);
  grad.addColorStop(1, `rgba(${c[0]}, ${c[1]}, ${c[2]}, 0)`);

  drawingContext.fillStyle = grad;
  rect((shadowLen * signX) / 2, 0, shadowLen, bodyLen);

  pop();
}


// =====================================================================
// light cursor dot
// =====================================================================
function drawLightCursor() {
  push();
  resetMatrix();

  drawingContext.globalCompositeOperation = 'screen';
  noStroke();
  const pulse = 1 + sin(millis() * 0.004) * 0.12;

  translate(width / 2, height / 2);

  for (let i = 3; i >= 1; i--) {
    const r = 10 * i * pulse;
    fill(255, 255, 255, 14 / i);
    ellipse(lightX, lightY, r, r);
  }
  fill(255, 255, 255, 160);
  ellipse(lightX, lightY, 4, 4);

  drawingContext.globalCompositeOperation = 'source-over';
  pop();
}
