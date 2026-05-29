const canvas = document.querySelector("#stage");
const ctx = canvas.getContext("2d", { alpha: false });
const listenButton = document.querySelector("#listenButton");
const generateButton = document.querySelector("#generateButton");
const scatterButton = document.querySelector("#scatterButton");
const promptInput = document.querySelector("#promptInput");
const statusEl = document.querySelector("#status");
const levelBar = document.querySelector("#levelBar");
const apiKeyInput = document.querySelector("#apiKeyInput");
const autoGenerateInput = document.querySelector("#autoGenerateInput");

const POLLINATIONS_ENDPOINT = "https://image.pollinations.ai/prompt/";
const IMAGE_PROXY_ENDPOINT = "https://images.weserv.nl/?url=";
const STORAGE_KEY = "voice2vision.pollinationsKey";
const AUTO_KEY = "voice2vision.autoGenerate";
const SpeechRecognition =
  window.SpeechRecognition || window.webkitSpeechRecognition || null;

const stopWords = new Set(
  "a about above after again against all am an and any are as at be because been before being below between both but by came can could did do does doing down during each few for from further had has have having he her here hers herself him himself his how i if in into is it its itself just like me more most my myself no nor not now of off on once only or other our ours ourselves out over own said same she should so some such than that the their theirs them themselves then there these they this those through to too under until up very was we were what when where which while who whom why will with you your yours yourself yourselves".split(
    " ",
  ),
);

const state = {
  width: 0,
  height: 0,
  dpr: 1,
  lastFrame: 0,
  count: 0,
  forming: false,
  listening: false,
  spoken: "",
  interim: "",
  autoTimer: 0,
  generationId: 0,
  lastGeneratedAt: 0,
  audioContext: null,
  analyser: null,
  audioData: null,
  micStream: null,
  recognition: null,
  audioLevel: 0,
  reduceMotion: window.matchMedia("(prefers-reduced-motion: reduce)").matches,
};

const particles = {
  x: new Float32Array(),
  y: new Float32Array(),
  vx: new Float32Array(),
  vy: new Float32Array(),
  tx: new Float32Array(),
  ty: new Float32Array(),
  size: new Float32Array(),
  brightness: new Float32Array(),
  hue: new Float32Array(),
  seed: new Float32Array(),
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function randomBetween(min, max) {
  return min + Math.random() * (max - min);
}

function setStatus(message, tone = "") {
  statusEl.textContent = message;
  statusEl.dataset.tone = tone;
}

function resize() {
  const rect = canvas.getBoundingClientRect();
  state.width = rect.width;
  state.height = rect.height;
  state.dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.floor(state.width * state.dpr);
  canvas.height = Math.floor(state.height * state.dpr);
  ctx.setTransform(state.dpr, 0, 0, state.dpr, 0, 0);
  ctx.fillStyle = "#050712";
  ctx.fillRect(0, 0, state.width, state.height);

  const desired = clamp(Math.floor((state.width * state.height) / 145), 2400, 9200);
  if (desired !== state.count) {
    allocateParticles(desired);
  }
}

function allocateParticles(count) {
  const old = { ...particles, count: state.count };

  particles.x = new Float32Array(count);
  particles.y = new Float32Array(count);
  particles.vx = new Float32Array(count);
  particles.vy = new Float32Array(count);
  particles.tx = new Float32Array(count);
  particles.ty = new Float32Array(count);
  particles.size = new Float32Array(count);
  particles.brightness = new Float32Array(count);
  particles.hue = new Float32Array(count);
  particles.seed = new Float32Array(count);

  for (let index = 0; index < count; index += 1) {
    if (index < old.count) {
      particles.x[index] = old.x[index];
      particles.y[index] = old.y[index];
      particles.vx[index] = old.vx[index];
      particles.vy[index] = old.vy[index];
      particles.tx[index] = old.tx[index];
      particles.ty[index] = old.ty[index];
      particles.size[index] = old.size[index];
      particles.brightness[index] = old.brightness[index];
      particles.hue[index] = old.hue[index];
      particles.seed[index] = old.seed[index];
    } else {
      particles.x[index] = Math.random() * state.width;
      particles.y[index] = Math.random() * state.height;
      particles.vx[index] = randomBetween(-0.8, 0.8);
      particles.vy[index] = randomBetween(-0.8, 0.8);
      particles.size[index] = randomBetween(0.7, 2.2);
      particles.brightness[index] = randomBetween(0.18, 0.7);
      particles.hue[index] = Math.random();
      particles.seed[index] = randomBetween(0, Math.PI * 2);
      setDriftTarget(index);
    }
  }

  state.count = count;
}

function setDriftTarget(index) {
  const margin = Math.min(state.width, state.height) * 0.08;
  particles.tx[index] = randomBetween(-margin, state.width + margin);
  particles.ty[index] = randomBetween(-margin, state.height + margin);
}

function scatterParticles() {
  state.forming = false;
  for (let index = 0; index < state.count; index += 1) {
    setDriftTarget(index);
    particles.brightness[index] = randomBetween(0.16, 0.78);
    particles.size[index] = randomBetween(0.7, 2.1);
  }
  setStatus("Scattered. Speak a scene or type one to reshape the flow.");
}

function flowAngle(x, y, time, seed) {
  const waveA = Math.sin(x * 0.004 + time * 0.00043 + seed);
  const waveB = Math.cos(y * 0.005 - time * 0.00037 + seed * 1.7);
  const waveC = Math.sin((x + y) * 0.0023 + time * 0.00028);
  return (waveA + waveB + waveC) * Math.PI;
}

function updateAudioLevel() {
  if (!state.analyser || !state.audioData) {
    state.audioLevel *= 0.92;
    return;
  }

  state.analyser.getByteTimeDomainData(state.audioData);
  let sum = 0;
  for (let index = 0; index < state.audioData.length; index += 1) {
    const centered = state.audioData[index] - 128;
    sum += centered * centered;
  }
  const rms = Math.sqrt(sum / state.audioData.length) / 128;
  state.audioLevel = state.audioLevel * 0.76 + clamp(rms * 2.8, 0, 1) * 0.24;
}

function animate(time = 0) {
  const elapsed = state.lastFrame ? time - state.lastFrame : 16.67;
  const dt = clamp(elapsed / 16.67, 0.4, 2.2);
  state.lastFrame = time;

  updateAudioLevel();
  levelBar.style.width = `${clamp(4 + state.audioLevel * 96, 4, 100)}%`;

  ctx.globalCompositeOperation = "source-over";
  ctx.fillStyle = `rgba(3, 5, 16, ${state.reduceMotion ? 0.35 : 0.18})`;
  ctx.fillRect(0, 0, state.width, state.height);
  ctx.globalCompositeOperation = "lighter";

  const flowStrength = state.forming ? 0.055 : 0.14;
  const targetStrength = state.forming ? 0.017 : 0.0028;
  const friction = state.forming ? 0.875 : 0.955;
  const pulse = 1 + state.audioLevel * 1.7;
  const driftChance = state.forming ? 0.00008 : 0.0022;
  const margin = 42;

  for (let index = 0; index < state.count; index += 1) {
    const brightness = particles.brightness[index];
    const seed = particles.seed[index];
    const wave = state.forming
      ? Math.sin(time * 0.0012 + seed) * (2.4 + (1 - brightness) * 4)
      : 0;
    const targetX = particles.tx[index] + wave;
    const targetY =
      particles.ty[index] + Math.cos(time * 0.001 + seed * 1.3) * wave;
    const dx = targetX - particles.x[index];
    const dy = targetY - particles.y[index];
    const distance = Math.hypot(dx, dy);
    const angle = flowAngle(particles.x[index], particles.y[index], time, seed);
    const attraction = targetStrength * (0.55 + brightness * 0.95);

    particles.vx[index] +=
      dx * attraction * dt + Math.cos(angle) * flowStrength * pulse * dt;
    particles.vy[index] +=
      dy * attraction * dt + Math.sin(angle) * flowStrength * pulse * dt;
    particles.vx[index] *= friction;
    particles.vy[index] *= friction;
    particles.x[index] += particles.vx[index] * dt;
    particles.y[index] += particles.vy[index] * dt;

    if (!state.forming && (distance < 28 || Math.random() < driftChance * dt)) {
      setDriftTarget(index);
    }

    if (particles.x[index] < -margin) particles.x[index] = state.width + margin;
    if (particles.x[index] > state.width + margin) particles.x[index] = -margin;
    if (particles.y[index] < -margin) particles.y[index] = state.height + margin;
    if (particles.y[index] > state.height + margin) particles.y[index] = -margin;

    const size = particles.size[index] * (0.76 + brightness * 0.58) * pulse;
    const hue = 182 + particles.hue[index] * 72 + Math.sin(time * 0.0007 + seed) * 18;
    const lightness = 48 + brightness * 34;
    const alpha = 0.2 + brightness * 0.58;
    ctx.fillStyle = `hsla(${hue}, 100%, ${lightness}%, ${alpha})`;
    ctx.fillRect(particles.x[index], particles.y[index], size, size);
  }

  requestAnimationFrame(animate);
}

function extractSceneCue(text) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (!normalized) return "";

  const clauses = normalized
    .split(/[.!?;:]|\s—\s|\s-\s/g)
    .map((part) => part.trim())
    .filter(Boolean);
  const recent = clauses.slice(-2).join(" ") || normalized;
  const words = recent.match(/[a-zA-Z][a-zA-Z'-]*/g) || [];
  const meaningful = words
    .map((word) => word.toLowerCase())
    .filter((word) => word.length > 2 && !stopWords.has(word));
  const selected = meaningful.slice(-28).join(" ");

  if (selected.length >= 10) return selected.slice(0, 180);
  return recent.slice(-180);
}

function buildHeightPrompt(cue) {
  return [
    "high contrast black and white height map",
    "luminous white subject on deep black background",
    "simple readable silhouette composition",
    "soft grayscale depth relief",
    "no text no letters no watermark no border",
    `scene: ${cue}`,
  ].join(", ");
}

function hashText(text) {
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

async function fetchHeightMap(cue) {
  const prompt = buildHeightPrompt(cue);
  const params = new URLSearchParams({
    width: "512",
    height: "512",
    model: "flux",
    nologo: "true",
    safe: "true",
    seed: String(hashText(cue) % 1000000),
  });
  const key = apiKeyInput.value.trim();

  if (key) params.set("key", key);

  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), 45000);
  const directUrl = `${POLLINATIONS_ENDPOINT}${encodeURIComponent(prompt)}?${params}`;
  const proxyParams = new URLSearchParams(params);
  proxyParams.delete("key");
  const proxySourceUrl = `${POLLINATIONS_ENDPOINT}${encodeURIComponent(prompt)}?${proxyParams}`;

  try {
    try {
      return await fetchBitmap(directUrl, controller.signal, "Generator");
    } catch (error) {
      const proxiedUrl = `${IMAGE_PROXY_ENDPOINT}${encodeURIComponent(proxySourceUrl)}`;
      return await fetchBitmap(proxiedUrl, controller.signal, "Image proxy");
    }
  } finally {
    window.clearTimeout(timeout);
  }
}

async function fetchBitmap(url, signal, label) {
  const response = await fetch(url, {
    mode: "cors",
    signal,
  });

  if (!response.ok) {
    throw new Error(`${label} returned ${response.status}`);
  }

  const blob = await response.blob();
  if (!blob.type.startsWith("image/")) {
    throw new Error(`${label} did not return an image`);
  }
  return await createImageBitmap(blob);
}

function createWorkingCanvas(size) {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(size, size);
  }
  const element = document.createElement("canvas");
  element.width = size;
  element.height = size;
  return element;
}

function pickFromCumulative(cumulative, total) {
  const target = Math.random() * total;
  let low = 0;
  let high = cumulative.length - 1;

  while (low < high) {
    const mid = (low + high) >> 1;
    if (cumulative[mid] < target) low = mid + 1;
    else high = mid;
  }

  return low;
}

function morphFromImage(source) {
  const sampleSize = 256;
  const workCanvas = createWorkingCanvas(sampleSize);
  const workCtx = workCanvas.getContext("2d", { willReadFrequently: true });

  workCtx.fillStyle = "#000";
  workCtx.fillRect(0, 0, sampleSize, sampleSize);
  workCtx.drawImage(source, 0, 0, sampleSize, sampleSize);

  const image = workCtx.getImageData(0, 0, sampleSize, sampleSize);
  const cumulative = new Float32Array(sampleSize * sampleSize);
  const luminance = new Float32Array(sampleSize * sampleSize);
  let total = 0;

  for (let pixel = 0; pixel < luminance.length; pixel += 1) {
    const dataIndex = pixel * 4;
    const red = image.data[dataIndex];
    const green = image.data[dataIndex + 1];
    const blue = image.data[dataIndex + 2];
    const bright = (red * 0.299 + green * 0.587 + blue * 0.114) / 255;
    const x = (pixel % sampleSize) / sampleSize - 0.5;
    const y = Math.floor(pixel / sampleSize) / sampleSize - 0.5;
    const centerBias = clamp(1.2 - Math.hypot(x, y) * 0.7, 0.75, 1.2);
    const weight = (Math.pow(bright, 2.25) + Math.max(0, bright - 0.18) * 0.045) * centerBias;
    luminance[pixel] = bright;
    total += weight;
    cumulative[pixel] = total;
  }

  if (total < 8) {
    throw new Error("Height map was too dark to sample");
  }

  const shapeSize = Math.min(state.width, state.height) * 0.78;
  const centerX = state.width * 0.5;
  const centerY = state.height * 0.53;

  for (let index = 0; index < state.count; index += 1) {
    const pixel = pickFromCumulative(cumulative, total);
    const pixelX = pixel % sampleSize;
    const pixelY = Math.floor(pixel / sampleSize);
    const bright = luminance[pixel];
    const jitter = randomBetween(-1, 1) * (1.6 + (1 - bright) * 5.8);
    const relief = (bright - 0.5) * shapeSize * 0.045;

    particles.tx[index] =
      centerX + (pixelX / sampleSize - 0.5) * shapeSize + jitter;
    particles.ty[index] =
      centerY + (pixelY / sampleSize - 0.5) * shapeSize - relief + jitter;
    particles.size[index] = randomBetween(0.55, 1.45) + bright * 2.25;
    particles.brightness[index] = clamp(0.16 + bright * 0.9, 0.16, 1);
    particles.hue[index] = clamp(0.12 + bright * 0.75 + Math.random() * 0.2, 0, 1);
  }

  state.forming = true;
}

function drawCloud(ctxToDraw, x, y, scale) {
  ctxToDraw.beginPath();
  ctxToDraw.ellipse(x - 68 * scale, y + 18 * scale, 55 * scale, 30 * scale, 0, 0, Math.PI * 2);
  ctxToDraw.ellipse(x - 22 * scale, y - 6 * scale, 58 * scale, 46 * scale, 0, 0, Math.PI * 2);
  ctxToDraw.ellipse(x + 43 * scale, y + 3 * scale, 66 * scale, 40 * scale, 0, 0, Math.PI * 2);
  ctxToDraw.ellipse(x + 88 * scale, y + 23 * scale, 48 * scale, 28 * scale, 0, 0, Math.PI * 2);
  ctxToDraw.fill();
}

function drawBird(ctxToDraw, x, y, scale) {
  ctxToDraw.save();
  ctxToDraw.translate(x, y);
  ctxToDraw.scale(scale, scale);
  ctxToDraw.lineCap = "round";
  ctxToDraw.lineJoin = "round";
  ctxToDraw.strokeStyle = "#fff";
  ctxToDraw.lineWidth = 28;
  ctxToDraw.beginPath();
  ctxToDraw.moveTo(-8, 18);
  ctxToDraw.bezierCurveTo(-88, -80, -170, -78, -236, 8);
  ctxToDraw.bezierCurveTo(-126, -34, -62, 4, -8, 38);
  ctxToDraw.bezierCurveTo(70, -44, 152, -54, 228, 28);
  ctxToDraw.bezierCurveTo(130, -10, 66, 20, 8, 42);
  ctxToDraw.stroke();
  ctxToDraw.fillStyle = "#fff";
  ctxToDraw.beginPath();
  ctxToDraw.ellipse(0, 34, 48, 22, 0, 0, Math.PI * 2);
  ctxToDraw.fill();
  ctxToDraw.restore();
}

function drawMountains(ctxToDraw) {
  const gradient = ctxToDraw.createLinearGradient(0, 130, 0, 420);
  gradient.addColorStop(0, "#fff");
  gradient.addColorStop(1, "#333");
  ctxToDraw.fillStyle = gradient;
  ctxToDraw.beginPath();
  ctxToDraw.moveTo(20, 410);
  ctxToDraw.lineTo(150, 190);
  ctxToDraw.lineTo(245, 330);
  ctxToDraw.lineTo(335, 160);
  ctxToDraw.lineTo(492, 410);
  ctxToDraw.closePath();
  ctxToDraw.fill();
}

function drawTree(ctxToDraw) {
  ctxToDraw.fillStyle = "#ddd";
  ctxToDraw.fillRect(238, 252, 38, 178);
  ctxToDraw.fillStyle = "#fff";
  ctxToDraw.beginPath();
  ctxToDraw.ellipse(256, 190, 118, 94, 0, 0, Math.PI * 2);
  ctxToDraw.ellipse(180, 242, 88, 68, 0, 0, Math.PI * 2);
  ctxToDraw.ellipse(332, 242, 88, 68, 0, 0, Math.PI * 2);
  ctxToDraw.fill();
}

function drawFallbackHeightMap(cue) {
  const size = 512;
  const workCanvas = createWorkingCanvas(size);
  const workCtx = workCanvas.getContext("2d");
  const lower = cue.toLowerCase();
  const random = seededRandom(hashText(cue));

  workCtx.fillStyle = "#000";
  workCtx.fillRect(0, 0, size, size);
  workCtx.filter = "blur(1.5px)";
  workCtx.fillStyle = "#fff";

  if (lower.includes("mountain") || lower.includes("hill")) drawMountains(workCtx);
  if (lower.includes("tree") || lower.includes("forest")) drawTree(workCtx);
  if (lower.includes("cloud") || lower.includes("sky")) {
    drawCloud(workCtx, 175, 360, 0.72);
    drawCloud(workCtx, 345, 330, 0.58);
  }
  if (lower.includes("bird") || lower.includes("wing") || lower.includes("fly")) {
    drawBird(workCtx, 256, lower.includes("cloud") ? 180 : 250, 0.78);
  }
  if (lower.includes("moon") || lower.includes("sun")) {
    const gradient = workCtx.createRadialGradient(360, 145, 15, 360, 145, 92);
    gradient.addColorStop(0, "#fff");
    gradient.addColorStop(0.58, "#ddd");
    gradient.addColorStop(1, "#000");
    workCtx.fillStyle = gradient;
    workCtx.beginPath();
    workCtx.arc(360, 145, 92, 0, Math.PI * 2);
    workCtx.fill();
  }
  if (lower.includes("ocean") || lower.includes("sea") || lower.includes("river")) {
    workCtx.strokeStyle = "#fff";
    workCtx.lineWidth = 22;
    for (let row = 0; row < 5; row += 1) {
      workCtx.beginPath();
      const y = 265 + row * 35;
      for (let x = 20; x <= 500; x += 32) {
        const waveY = y + Math.sin(x * 0.04 + row) * 13;
        if (x === 20) workCtx.moveTo(x, waveY);
        else workCtx.lineTo(x, waveY);
      }
      workCtx.stroke();
    }
  }

  const image = workCtx.getImageData(0, 0, size, size);
  let visible = 0;
  for (let index = 0; index < image.data.length; index += 4) {
    visible += image.data[index];
  }

  if (visible < 400000) {
    for (let blob = 0; blob < 9; blob += 1) {
      const x = 96 + random() * 320;
      const y = 96 + random() * 320;
      const radius = 42 + random() * 92;
      const gradient = workCtx.createRadialGradient(x, y, 4, x, y, radius);
      gradient.addColorStop(0, "#fff");
      gradient.addColorStop(0.62, `rgba(255,255,255,${0.45 + random() * 0.35})`);
      gradient.addColorStop(1, "rgba(255,255,255,0)");
      workCtx.fillStyle = gradient;
      workCtx.beginPath();
      workCtx.arc(x, y, radius, 0, Math.PI * 2);
      workCtx.fill();
    }
  }

  workCtx.filter = "blur(3px)";
  workCtx.drawImage(workCanvas, 0, 0);
  workCtx.filter = "none";
  return workCanvas;
}

async function shapeFromPrompt(rawPrompt, source = "typed") {
  const cue = extractSceneCue(rawPrompt);
  if (!cue) {
    setStatus("Give me a few descriptive words first.", "warn");
    return;
  }

  const now = Date.now();
  if (source === "voice" && now - state.lastGeneratedAt < 8500) return;

  state.lastGeneratedAt = now;
  const generationId = ++state.generationId;
  generateButton.disabled = true;
  setStatus(`Generating hidden height map for “${cue}”…`);

  let bitmap = null;
  try {
    bitmap = await fetchHeightMap(cue);
    if (generationId !== state.generationId) return;
    morphFromImage(bitmap);
    setStatus(`Shaped from: ${cue}`, "good");
  } catch (error) {
    console.warn(error);
    if (generationId !== state.generationId) return;
    const fallback = drawFallbackHeightMap(cue);
    morphFromImage(fallback);
    setStatus(`Generator unavailable; using local fallback for: ${cue}`, "warn");
  } finally {
    if (bitmap && typeof bitmap.close === "function") bitmap.close();
    generateButton.disabled = false;
  }
}

function scheduleVoiceGeneration() {
  if (!autoGenerateInput.checked) return;
  window.clearTimeout(state.autoTimer);
  state.autoTimer = window.setTimeout(() => {
    shapeFromPrompt(promptInput.value, "voice");
  }, 1700);
}

async function startMicrophoneMeter() {
  if (state.micStream) return;

  state.micStream = await navigator.mediaDevices.getUserMedia({
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
    },
  });
  state.audioContext = new AudioContext();
  const source = state.audioContext.createMediaStreamSource(state.micStream);
  state.analyser = state.audioContext.createAnalyser();
  state.analyser.fftSize = 1024;
  state.audioData = new Uint8Array(state.analyser.fftSize);
  source.connect(state.analyser);
}

function createRecognition() {
  if (!SpeechRecognition) return null;
  const recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.interimResults = true;
  recognition.lang = navigator.language || "en-US";

  recognition.onresult = (event) => {
    let interim = "";
    for (let index = event.resultIndex; index < event.results.length; index += 1) {
      const text = event.results[index][0].transcript;
      if (event.results[index].isFinal) {
        state.spoken = `${state.spoken} ${text}`.trim().slice(-1600);
      } else {
        interim = `${interim} ${text}`.trim();
      }
    }

    state.interim = interim;
    promptInput.value = `${state.spoken} ${state.interim}`.trim().slice(-1000);
    scheduleVoiceGeneration();
  };

  recognition.onerror = (event) => {
    if (event.error === "not-allowed") {
      stopListening();
      setStatus("Microphone permission was blocked.", "bad");
    } else if (event.error !== "no-speech") {
      setStatus(`Speech recognition hiccup: ${event.error}`, "warn");
    }
  };

  recognition.onend = () => {
    if (state.listening) {
      window.setTimeout(() => {
        try {
          recognition.start();
        } catch (error) {
          console.warn(error);
        }
      }, 350);
    }
  };

  return recognition;
}

async function startListening() {
  if (!navigator.mediaDevices?.getUserMedia) {
    setStatus("This browser cannot access the microphone.", "bad");
    return;
  }

  try {
    await startMicrophoneMeter();
  } catch (error) {
    console.warn(error);
    setStatus("Could not start the microphone.", "bad");
    return;
  }

  if (!SpeechRecognition) {
    setStatus("Mic meter is running, but speech recognition needs Chrome or Edge.", "warn");
    listenButton.textContent = "Mic meter on";
    listenButton.disabled = true;
    return;
  }

  if (!state.recognition) state.recognition = createRecognition();

  try {
    state.recognition.start();
    state.listening = true;
    listenButton.textContent = "Stop listening";
    setStatus("Listening. Pause briefly after a visual scene and particles will respond.");
  } catch (error) {
    console.warn(error);
  }
}

function stopListening() {
  state.listening = false;
  listenButton.textContent = "Start listening";
  window.clearTimeout(state.autoTimer);

  if (state.recognition) {
    try {
      state.recognition.stop();
    } catch (error) {
      console.warn(error);
    }
  }

  setStatus("Listening paused. You can still type and shape particles manually.");
}

function saveSettings() {
  const key = apiKeyInput.value.trim();
  if (key.startsWith("sk_")) {
    apiKeyInput.value = "";
    localStorage.removeItem(STORAGE_KEY);
    setStatus("Do not place secret keys in a browser app. Use a publishable key only.", "bad");
    return;
  }

  if (key) localStorage.setItem(STORAGE_KEY, key);
  else localStorage.removeItem(STORAGE_KEY);
}

function restoreSettings() {
  apiKeyInput.value = localStorage.getItem(STORAGE_KEY) || "";
  autoGenerateInput.checked = localStorage.getItem(AUTO_KEY) !== "false";
}

listenButton.addEventListener("click", () => {
  if (state.listening) stopListening();
  else startListening();
});

generateButton.addEventListener("click", () => {
  shapeFromPrompt(promptInput.value, "typed");
});

scatterButton.addEventListener("click", scatterParticles);

apiKeyInput.addEventListener("change", saveSettings);

autoGenerateInput.addEventListener("change", () => {
  localStorage.setItem(AUTO_KEY, String(autoGenerateInput.checked));
});

promptInput.addEventListener("keydown", (event) => {
  if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
    shapeFromPrompt(promptInput.value, "typed");
  }
});

window.addEventListener("resize", resize);
window.addEventListener("beforeunload", () => {
  if (state.micStream) {
    for (const track of state.micStream.getTracks()) track.stop();
  }
});

restoreSettings();
resize();
scatterParticles();
requestAnimationFrame(animate);
