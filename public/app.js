// Keep this in sync with api/_models.js (label + kind only — the backend
// owns the actual parameter whitelist and schema introspection).
const MODELS = {
  "flux-schnell": { label: "Flux Schnell (fast)", kind: "image" },
  "flux-1.1-pro": { label: "Flux 1.1 Pro (high quality)", kind: "image" },
  sdxl: { label: "Stable Diffusion XL", kind: "image" },
  "minimax-video-01": { label: "Minimax Video-01", kind: "video" },
  "kling-v1.6-standard": { label: "Kling v1.6 Standard", kind: "video" },
  "luma-ray-flash-2": { label: "Luma Ray Flash 2 (720p)", kind: "video" },
};

const STORAGE_KEY = "ai-studio-history";
const MAX_INLINE_BYTES = 4 * 1024 * 1024; // ~4MB, safe under typical serverless body limits

let mode = "image"; // image | video | lipsync | kids
let videoSubMode = "t2v"; // t2v | i2v
let kidsSubMode = "story"; // story | song | cartoon
let voicesLoaded = false;
let cartoonCharacterUrl = null; // last-generated character image, reused across cartoon scenes

const els = {
  modeBtns: document.querySelectorAll(".mode-btn"),
  submodeBtns: document.querySelectorAll(".submode-btn"),
  kidsSubmodeBtns: document.querySelectorAll(".kids-submode-btn"),
  genControls: document.getElementById("genControls"),
  videoOnlyControls: document.getElementById("videoOnlyControls"),
  singleShotControls: document.getElementById("singleShotControls"),
  lipsyncControls: document.getElementById("lipsyncControls"),
  kidsControls: document.getElementById("kidsControls"),
  kidsStoryControls: document.getElementById("kidsStoryControls"),
  kidsSongControls: document.getElementById("kidsSongControls"),
  kidsCartoonControls: document.getElementById("kidsCartoonControls"),
  kidsScript: document.getElementById("kidsScript"),
  kidVoice: document.getElementById("kidVoice"),
  adultVoice: document.getElementById("adultVoice"),
  kidVoiceManual: document.getElementById("kidVoiceManual"),
  adultVoiceManual: document.getElementById("adultVoiceManual"),
  voiceListHint: document.getElementById("voiceListHint"),
  songLyrics: document.getElementById("songLyrics"),
  songStyle: document.getElementById("songStyle"),
  songVoice: document.getElementById("songVoice"),
  songLength: document.getElementById("songLength"),
  cartoonCharacter: document.getElementById("cartoonCharacter"),
  generateCharacterBtn: document.getElementById("generateCharacterBtn"),
  cartoonCharacterPreview: document.getElementById("cartoonCharacterPreview"),
  cartoonCharacterImg: document.getElementById("cartoonCharacterImg"),
  cartoonLyrics: document.getElementById("cartoonLyrics"),
  cartoonSongStyle: document.getElementById("cartoonSongStyle"),
  cartoonVideoModel: document.getElementById("cartoonVideoModel"),
  cartoonAction: document.getElementById("cartoonAction"),
  cartoonLength: document.getElementById("cartoonLength"),
  kidsProgress: document.getElementById("kidsProgress"),
  modelSelect: document.getElementById("model"),
  aspectRatio: document.getElementById("aspectRatio"),
  promptLabel: document.getElementById("promptLabel"),
  prompt: document.getElementById("prompt"),
  enhanceBtn: document.getElementById("enhanceBtn"),
  videoLength: document.getElementById("videoLength"),
  lengthHint: document.getElementById("lengthHint"),
  storyboardProgress: document.getElementById("storyboardProgress"),
  cameraMotion: document.getElementById("cameraMotion"),
  startImage: document.getElementById("startImage"),
  startImageLabel: document.getElementById("startImageLabel"),
  endImage: document.getElementById("endImage"),
  endImageField: document.getElementById("endImageField"),
  keyframeHint: document.getElementById("keyframeHint"),
  ugcStyle: document.getElementById("ugcStyle"),
  referenceImageField: document.getElementById("referenceImageField"),
  referenceImage: document.getElementById("referenceImage"),
  negativePrompt: document.getElementById("negativePrompt"),
  seed: document.getElementById("seed"),
  lipsyncVideo: document.getElementById("lipsyncVideo"),
  lipsyncAudio: document.getElementById("lipsyncAudio"),
  generateBtn: document.getElementById("generateBtn"),
  statusLine: document.getElementById("statusLine"),
  gallery: document.getElementById("gallery"),
  clearBtn: document.getElementById("clearBtn"),
};

function isStoryboard() {
  return mode === "video" && els.videoLength.value !== "short";
}

function applyVideoLengthUI() {
  const storyboard = isStoryboard();
  els.singleShotControls.classList.toggle("hidden", storyboard);
  els.promptLabel.textContent = storyboard ? "Topic / script outline" : "Prompt";
  if (storyboard) {
    const seconds = Number(els.videoLength.value);
    const scenes = Math.ceil(seconds / 5);
    els.lengthHint.textContent =
      `Built from ~${scenes} short clips stitched together in your browser. ` +
      `Expect roughly ${scenes}–${scenes * 2} minutes and ${scenes}× the per-clip cost of your chosen model.`;
  } else {
    els.lengthHint.textContent = "";
  }
}

els.videoLength.addEventListener("change", applyVideoLengthUI);

function populateModelSelect() {
  els.modelSelect.innerHTML = "";
  Object.entries(MODELS)
    .filter(([, m]) => m.kind === mode)
    .forEach(([id, m]) => {
      const opt = document.createElement("option");
      opt.value = id;
      opt.textContent = m.label;
      els.modelSelect.appendChild(opt);
    });
}

function applyVideoSubModeUI() {
  els.submodeBtns.forEach((b) => b.classList.toggle("active", b.dataset.submode === videoSubMode));
  if (videoSubMode === "i2v") {
    els.startImageLabel.textContent = "Source image (required)";
    els.endImageField.querySelector("span").textContent = "End frame (optional)";
    els.keyframeHint.textContent =
      "The source image is animated based on your prompt. Add an end frame too if you want the clip to land on a specific final shot.";
  } else {
    els.startImageLabel.textContent = "Start frame (optional)";
    els.keyframeHint.textContent =
      "Upload one or both to guide the shot like a keyframe. Not every model supports an end frame — you'll be told if it was ignored.";
  }
}

els.submodeBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    videoSubMode = btn.dataset.submode;
    applyVideoSubModeUI();
  });
});

function applyKidsSubModeUI() {
  els.kidsSubmodeBtns.forEach((b) => b.classList.toggle("active", b.dataset.kidsmode === kidsSubMode));
  els.kidsStoryControls.classList.toggle("hidden", kidsSubMode !== "story");
  els.kidsSongControls.classList.toggle("hidden", kidsSubMode !== "song");
  els.kidsCartoonControls.classList.toggle("hidden", kidsSubMode !== "cartoon");
}

els.kidsSubmodeBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    kidsSubMode = btn.dataset.kidsmode;
    applyKidsSubModeUI();
  });
});

async function ensureVoicesLoaded() {
  if (voicesLoaded) return;
  voicesLoaded = true; // don't retry-storm on every tab switch if it fails
  els.voiceListHint.textContent = "Loading voice list…";
  try {
    const res = await fetch("/api/voices");
    const data = await res.json();
    if (!data.available) {
      // fal doesn't publish an enum of valid voice IDs for this model — fall
      // back to letting the user type one in directly (find real voice
      // names on the model's fal.ai page) instead of leaving them stuck with
      // an empty, unusable dropdown.
      els.kidVoice.classList.add("hidden");
      els.adultVoice.classList.add("hidden");
      els.kidVoiceManual.classList.remove("hidden");
      els.adultVoiceManual.classList.remove("hidden");
      els.voiceListHint.textContent =
        data.note ||
        "This model doesn't publish a fixed voice list. Type a voice ID above, or leave Adult blank to use the default voice.";
      return;
    }
    const fill = (select, list, placeholder) => {
      select.innerHTML = "";
      if (list.length === 0) {
        const opt = document.createElement("option");
        opt.textContent = placeholder;
        select.appendChild(opt);
        return;
      }
      list.forEach((v) => {
        const opt = document.createElement("option");
        opt.value = v;
        opt.textContent = v.replace(/_/g, " ");
        select.appendChild(opt);
      });
    };
    fill(els.kidVoice, data.kid, "(no kid-style voices found — pick from adult list)");
    fill(els.adultVoice, data.adult, "(no adult voices found)");
    els.voiceListHint.textContent = `${data.kid.length} kid-style and ${data.adult.length} adult voices available.`;
  } catch (err) {
    els.voiceListHint.textContent = "Couldn't load the voice list: " + (err.message || "network error");
  }
}

function applyModeUI() {
  els.modeBtns.forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));

  els.genControls.classList.add("hidden");
  els.lipsyncControls.classList.add("hidden");
  els.kidsControls.classList.add("hidden");

  if (mode === "lipsync") {
    els.lipsyncControls.classList.remove("hidden");
    els.generateBtn.textContent = "Sync";
  } else if (mode === "kids") {
    els.kidsControls.classList.remove("hidden");
    els.generateBtn.textContent = "Generate";
    applyKidsSubModeUI();
    ensureVoicesLoaded();
  } else {
    els.genControls.classList.remove("hidden");
    els.videoOnlyControls.style.display = mode === "video" ? "block" : "none";
    els.generateBtn.textContent = "Generate";
    populateModelSelect();
    if (mode === "video") {
      applyVideoSubModeUI();
      applyVideoLengthUI();
    } else {
      els.promptLabel.textContent = "Prompt";
    }
  }
}

els.modeBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    mode = btn.dataset.mode;
    applyModeUI();
  });
});

function setStatus(text, kind) {
  els.statusLine.textContent = text || "";
  els.statusLine.className = "status-line" + (kind ? " " + kind : "");
}

function loadHistory() {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveHistory(items) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(0, 60)));
}

function upsertHistoryItem(entry) {
  const items = loadHistory();
  const idx = items.findIndex((i) => i.id === entry.id);
  if (idx >= 0) items[idx] = { ...items[idx], ...entry };
  else items.unshift(entry);
  saveHistory(items);
  renderGallery();
}

function escapeHtml(str) {
  const div = document.createElement("div");
  div.textContent = str || "";
  return div.innerHTML;
}

function renderGallery() {
  const items = loadHistory();
  els.gallery.innerHTML = "";

  if (items.length === 0) {
    els.gallery.innerHTML = '<div class="empty-state">Nothing generated yet — try a prompt on the left.</div>';
    return;
  }

  for (const item of items) {
    const card = document.createElement("div");
    card.className = "card" + (item.status !== "succeeded" ? " " + (item.status === "failed" ? "failed" : "pending") : "");

    const media = document.createElement("div");
    media.className = "card-media";

    if (item.status === "succeeded" && item.url) {
      if (item.kind === "video") {
        const video = document.createElement("video");
        video.src = item.url;
        video.controls = true;
        video.loop = true;
        media.appendChild(video);
      } else if (item.kind === "audio") {
        media.classList.add("audio");
        const audio = document.createElement("audio");
        audio.src = item.url;
        audio.controls = true;
        media.appendChild(audio);
      } else {
        const img = document.createElement("img");
        img.src = item.url;
        img.alt = item.prompt || "";
        media.appendChild(img);
      }
    } else if (item.status === "failed") {
      media.textContent = "Failed: " + (item.error || "unknown error");
    } else {
      media.textContent = "Generating…";
    }

    const body = document.createElement("div");
    body.className = "card-body";
    body.innerHTML = `
      <p class="card-prompt">${escapeHtml(item.prompt || item.label || "")}</p>
      <div class="card-meta"><span>${(MODELS[item.modelId] && MODELS[item.modelId].label) || item.label || ""}</span><span>${item.aspectRatio || ""}</span></div>
    `;

    card.appendChild(media);
    card.appendChild(body);

    if (item.status === "succeeded" && item.url && (item.kind === "image" || item.kind === "video" || item.kind === "audio")) {
      const actions = document.createElement("div");
      actions.className = "card-actions";

      const downloadBtn = document.createElement("button");
      downloadBtn.textContent = "Download";
      downloadBtn.addEventListener("click", () => {
        const a = document.createElement("a");
        a.href = item.url;
        a.download = (item.label || item.prompt || "ai-studio-output").slice(0, 60).replace(/[^\w.-]+/g, "_");
        document.body.appendChild(a);
        a.click();
        a.remove();
      });
      actions.appendChild(downloadBtn);

      if (item.kind !== "audio" && !item.isStoryboardResult) {
        const upscaleBtn = document.createElement("button");
        upscaleBtn.textContent = item.upscaling ? "Upscaling…" : "Upscale";
        upscaleBtn.disabled = !!item.upscaling;
        upscaleBtn.addEventListener("click", () => upscale(item));
        actions.appendChild(upscaleBtn);
      }

      card.appendChild(actions);

      if (item.isStoryboardResult || item.isBrowserStitched) {
        const note = document.createElement("div");
        note.className = "hint";
        note.style.padding = "0 12px 10px";
        note.textContent = "Stitched in your browser — download it now, this link won't survive a page refresh.";
        card.appendChild(note);
      }
    }

    els.gallery.appendChild(card);
  }
}

// ---------- File helpers ----------

function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// Downscale + re-encode an image file client-side so keyframe uploads stay
// well under the request size limit.
async function fileToResizedDataURL(file, maxDim = 1568) {
  const dataUrl = await readFileAsDataURL(file);
  const img = new Image();
  await new Promise((resolve, reject) => {
    img.onload = resolve;
    img.onerror = reject;
    img.src = dataUrl;
  });

  let { width, height } = img;
  if (width > maxDim || height > maxDim) {
    const scale = maxDim / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  canvas.getContext("2d").drawImage(img, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", 0.85);
}

function estimateDataUrlBytes(dataUrl) {
  const base64 = dataUrl.split(",")[1] || "";
  return Math.round((base64.length * 3) / 4);
}

// ---------- Polling ----------

async function pollPrediction(id, onDone) {
  // Video models can legitimately take several minutes, especially under
  // load — fal's own queue can hold a job for up to an hour server-side.
  // ~15 minutes at 4s intervals gives real video generations room to finish
  // instead of the app giving up while fal is still quietly working on it.
  const maxAttempts = 225;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 4000));
    let res, data;
    try {
      res = await fetch(`/api/status?id=${encodeURIComponent(id)}`);
      data = await res.json();
    } catch {
      continue;
    }
    if (!res.ok) {
      onDone({ status: "failed", error: data.error });
      return;
    }
    if (data.status === "succeeded") {
      const output = Array.isArray(data.output) ? data.output[0] : data.output;
      onDone({ status: "succeeded", url: output });
      return;
    }
    if (data.status === "failed" || data.status === "canceled") {
      onDone({ status: "failed", error: data.error || data.status });
      return;
    }
  }
  onDone({ status: "failed", error: "Timed out waiting for a result." });
}

// ---------- Prompt enhancement ----------

els.enhanceBtn.addEventListener("click", async () => {
  const prompt = els.prompt.value.trim();
  if (!prompt) {
    setStatus("Write a prompt first.", "error");
    return;
  }
  els.enhanceBtn.disabled = true;
  els.enhanceBtn.textContent = "Enhancing…";
  try {
    const res = await fetch("/api/enhance-prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, kind: mode === "video" ? "video" : "image" }),
    });
    const data = await res.json();
    if (!res.ok) {
      setStatus(data.error || "Couldn't enhance the prompt.", "error");
    } else {
      els.prompt.value = data.enhancedPrompt;
      setStatus(data.note || "Prompt enhanced — feel free to edit it further.", "success");
    }
  } catch (err) {
    setStatus(err.message || "Network error.", "error");
  } finally {
    els.enhanceBtn.disabled = false;
    els.enhanceBtn.textContent = "✨ Enhance prompt with AI";
  }
});

// ---------- Upscale ----------

async function upscale(item) {
  upsertHistoryItem({ id: item.id, upscaling: true });
  setStatus("Upscaling…");
  try {
    const res = await fetch("/api/upscale", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: item.url, kind: item.kind }),
    });
    const data = await res.json();
    if (!res.ok) {
      setStatus(data.error || "Upscale failed.", "error");
      upsertHistoryItem({ id: item.id, upscaling: false });
      return;
    }

    const newId = "upscale-" + data.id;
    upsertHistoryItem({
      id: newId,
      prompt: (item.prompt || "") + " (upscaled)",
      kind: item.kind,
      label: "Upscaled",
      status: data.status === "succeeded" ? "succeeded" : "processing",
      url: data.status === "succeeded" ? (Array.isArray(data.output) ? data.output[0] : data.output) : null,
    });
    upsertHistoryItem({ id: item.id, upscaling: false });

    if (data.status !== "succeeded") {
      await pollPrediction(data.id, (result) => upsertHistoryItem({ id: newId, ...result }));
    }
    setStatus("Done.", "success");
  } catch (err) {
    setStatus(err.message || "Network error.", "error");
    upsertHistoryItem({ id: item.id, upscaling: false });
  }
}

// ---------- Generate / Sync ----------

async function generateImageOrVideo() {
  const prompt = els.prompt.value.trim();
  const modelId = els.modelSelect.value;
  const aspectRatio = els.aspectRatio.value;
  const negativePrompt = els.negativePrompt.value.trim();
  const seed = els.seed.value.trim();
  const cameraMotion = mode === "video" ? els.cameraMotion.value : "none";

  if (!prompt) {
    setStatus("Write a prompt first.", "error");
    return;
  }

  if (mode === "video" && videoSubMode === "i2v" && !els.startImage.files[0]) {
    setStatus("Upload a source image for Image → Video.", "error");
    return;
  }

  let startImage = null;
  let endImage = null;
  let referenceImage = null;
  if (mode === "video") {
    try {
      if (els.startImage.files[0]) startImage = await fileToResizedDataURL(els.startImage.files[0]);
      if (els.endImage.files[0]) endImage = await fileToResizedDataURL(els.endImage.files[0]);
    } catch {
      setStatus("Couldn't read the keyframe image(s).", "error");
      return;
    }
  }

  const style = els.ugcStyle.checked ? "ugc" : "standard";
  if (style === "ugc" && els.referenceImage.files[0]) {
    try {
      referenceImage = await fileToResizedDataURL(els.referenceImage.files[0]);
    } catch {
      setStatus("Couldn't read the reference photo.", "error");
      return;
    }
  }

  setStatus("Sending request…");

  const res = await fetch("/api/generate", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      modelId,
      prompt,
      aspectRatio,
      negativePrompt,
      seed,
      cameraMotion,
      startImage,
      endImage,
      style,
      referenceImage,
    }),
  });
  const data = await res.json();

  if (!res.ok) {
    setStatus(data.error || "Something went wrong.", "error");
    return;
  }

  const placeholder = {
    id: data.id,
    prompt,
    modelId,
    aspectRatio,
    kind: MODELS[modelId].kind,
    status: data.status === "succeeded" ? "succeeded" : "processing",
    url: data.status === "succeeded" ? (Array.isArray(data.output) ? data.output[0] : data.output) : null,
  };
  upsertHistoryItem(placeholder);

  const notes = [];
  if (data.appliedFeatures) {
    if (data.appliedFeatures.startImage === false) notes.push("start/source image wasn't supported by this model, so it was ignored");
    if (data.appliedFeatures.endImage === false) notes.push("end frame wasn't supported by this model, so it was ignored");
    if (data.appliedFeatures.referenceImage === false) notes.push("reference photo wasn't supported by this model, so it was ignored");
  }

  if (placeholder.status !== "succeeded") {
    setStatus(
      "Generating — this can take anywhere from a few seconds to a couple minutes…" + (notes.length ? " (" + notes.join("; ") + ")" : "")
    );
    await pollPrediction(data.id, (result) => upsertHistoryItem({ id: data.id, ...result }));
  }
  setStatus(notes.length ? "Done — " + notes.join("; ") + "." : "Done.", "success");
}

// AI-generated video clips can come out at a much higher resolution/bitrate
// than you'd expect for a few seconds of footage (e.g. 2560x1440 HEVC at
// ~17 Mbps), which blows past the inline request-size limit long before any
// duration limit does. Rather than making the user manually re-encode
// footage before every lip-sync attempt, re-encode it down client-side.
async function compressVideoForLipsync(file, onProgress) {
  const { ffmpeg, fetchFile } = await loadFFmpeg(onProgress);
  await ffmpeg.writeFile("in_video", await fetchFile(file));
  await ffmpeg.exec([
    "-i", "in_video",
    "-vf", "scale='min(640,iw)':-2",
    "-c:v", "libx264",
    "-preset", "veryfast",
    "-crf", "28",
    "-c:a", "aac",
    "-b:a", "96k",
    "-movflags", "+faststart",
    "out.mp4",
  ]);
  const data = await ffmpeg.readFile("out.mp4");
  return readFileAsDataURL(new Blob([data.buffer], { type: "video/mp4" }));
}

async function generateLipsync() {
  const videoFile = els.lipsyncVideo.files[0];
  const audioFile = els.lipsyncAudio.files[0];

  if (!videoFile || !audioFile) {
    setStatus("Choose both a source video and an audio file.", "error");
    return;
  }

  let videoDataUrl;
  try {
    videoDataUrl = await readFileAsDataURL(videoFile);
    // Only pay the compression cost when the raw file actually needs it.
    if (estimateDataUrlBytes(videoDataUrl) > 2 * 1024 * 1024) {
      setStatus("Compressing video — this clip is larger than expected…");
      videoDataUrl = await compressVideoForLipsync(videoFile, (p) => setStatus(`Compressing video… ${Math.round(p * 100)}%`));
    }
  } catch (err) {
    setStatus("Couldn't process the video file (" + (err.message || "unknown error") + ").", "error");
    return;
  }

  const audioDataUrl = await readFileAsDataURL(audioFile);

  if (estimateDataUrlBytes(videoDataUrl) + estimateDataUrlBytes(audioDataUrl) > MAX_INLINE_BYTES) {
    setStatus("Even after compression, those files are too large for this app's free hosting tier — try a shorter clip (a few seconds).", "error");
    return;
  }

  setStatus("Sending request…");

  const res = await fetch("/api/lipsync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ video: videoDataUrl, audio: audioDataUrl }),
  });
  const data = await res.json();

  if (!res.ok) {
    setStatus(data.error || "Something went wrong.", "error");
    return;
  }

  const placeholder = {
    id: data.id,
    label: "Lip sync",
    kind: "video",
    status: data.status === "succeeded" ? "succeeded" : "processing",
    url: data.status === "succeeded" ? (Array.isArray(data.output) ? data.output[0] : data.output) : null,
  };
  upsertHistoryItem(placeholder);

  if (placeholder.status !== "succeeded") {
    setStatus("Syncing — this usually takes a minute or two…");
    await pollPrediction(data.id, (result) => upsertHistoryItem({ id: data.id, ...result }));
  }
  setStatus("Done.", "success");
}

// ---------- Storyboard (30s-2min videos made of stitched scene clips) ----------

function pollPredictionPromise(id) {
  return new Promise((resolve) => pollPrediction(id, resolve));
}

async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let next = 0;
  async function runOne() {
    while (next < items.length) {
      const i = next++;
      results[i] = await worker(items[i], i);
    }
  }
  const workers = Array.from({ length: Math.min(limit, items.length) }, runOne);
  await Promise.all(workers);
  return results;
}

function renderStoryboardProgress(scenes, statuses) {
  els.storyboardProgress.classList.remove("hidden");
  els.storyboardProgress.innerHTML = scenes
    .map((s, i) => {
      const st = statuses[i] || "waiting";
      const icon = st === "done" ? "✓" : st === "failed" ? "✕" : st === "working" ? "…" : "·";
      return `<div class="hint">${icon} Scene ${i + 1}/${scenes.length}: ${escapeHtml(s.slice(0, 70))}</div>`;
    })
    .join("");
}

async function generateOneSceneClip(sceneText, opts) {
  const attempt = async () => {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        modelId: opts.modelId,
        prompt: sceneText,
        aspectRatio: opts.aspectRatio,
        cameraMotion: "none",
        style: opts.style,
        referenceImage: opts.referenceImage,
      }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Scene generation was rejected.");
    if (data.status === "succeeded") return Array.isArray(data.output) ? data.output[0] : data.output;
    const result = await pollPredictionPromise(data.id);
    if (result.status !== "succeeded") throw new Error(result.error || "Scene generation failed.");
    return result.url;
  };

  try {
    return await attempt();
  } catch (err) {
    // one retry — transient failures on a single scene shouldn't sink the whole storyboard
    return await attempt();
  }
}

async function loadFFmpeg(onProgress) {
  const { FFmpeg } = await import("https://esm.sh/@ffmpeg/ffmpeg@0.12.10");
  const { fetchFile, toBlobURL } = await import("https://esm.sh/@ffmpeg/util@0.12.1");

  const ffmpeg = new FFmpeg();
  if (onProgress) ffmpeg.on("progress", ({ progress }) => onProgress(progress));

  const base = "https://esm.sh/@ffmpeg/core@0.12.6/dist/esm";
  await ffmpeg.load({
    coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, "text/javascript"),
    wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, "application/wasm"),
  });

  return { ffmpeg, fetchFile };
}

// Concatenates short spoken-line audio clips (from TTS) into one track, with
// a brief silent gap between lines so the dialogue doesn't run together.
async function stitchAudioClips(urls, onProgress) {
  const { ffmpeg, fetchFile } = await loadFFmpeg(onProgress);

  const names = [];
  for (let i = 0; i < urls.length; i++) {
    const name = `line${i}.mp3`;
    await ffmpeg.writeFile(name, await fetchFile(urls[i]));
    names.push(name);
  }

  // Re-encode with a short pause between lines — audio clips coming from a
  // TTS model are unlikely to share identical container/codec params, so we
  // skip straight to the safe concat-filter path rather than trying "-c copy".
  const inputArgs = names.flatMap((n) => ["-i", n]);
  const withGaps = names.map((_, i) => `[${i}:a]apad=pad_dur=0.4[a${i}]`).join(";");
  const filter = `${withGaps};${names.map((_, i) => `[a${i}]`).join("")}concat=n=${names.length}:v=0:a=1[a]`;
  await ffmpeg.exec([...inputArgs, "-filter_complex", filter, "-map", "[a]", "output.mp3"]);

  const data = await ffmpeg.readFile("output.mp3");
  return URL.createObjectURL(new Blob([data.buffer], { type: "audio/mpeg" }));
}

async function stitchVideoClips(urls, onProgress, opts = {}) {
  const withAudio = !!opts.withAudio; // true once clips have been lip-synced and carry real audio
  const { ffmpeg, fetchFile } = await loadFFmpeg(onProgress);

  const names = [];
  for (let i = 0; i < urls.length; i++) {
    const name = `scene${i}.mp4`;
    await ffmpeg.writeFile(name, await fetchFile(urls[i]));
    names.push(name);
  }

  const listContent = names.map((n) => `file '${n}'`).join("\n");
  await ffmpeg.writeFile("list.txt", listContent);

  try {
    // Fast path: works when every clip shares the same codec/resolution/fps,
    // which is typical since every scene uses the same model + settings.
    await ffmpeg.exec(["-f", "concat", "-safe", "0", "-i", "list.txt", "-c", "copy", "output.mp4"]);
  } catch {
    // Fallback: re-encode while concatenating (slower, but tolerant of any
    // mismatch between clips).
    const inputArgs = names.flatMap((n) => ["-i", n]);
    if (withAudio) {
      const filter = `${names.map((_, i) => `[${i}:v:0][${i}:a:0]`).join("")}concat=n=${names.length}:v=1:a=1[v][a]`;
      await ffmpeg.exec([...inputArgs, "-filter_complex", filter, "-map", "[v]", "-map", "[a]", "output.mp4"]);
    } else {
      // Plain (not-yet-lip-synced) AI video clips are almost always silent.
      const filter = `${names.map((_, i) => `[${i}:v:0]`).join("")}concat=n=${names.length}:v=1:a=0[v]`;
      await ffmpeg.exec([...inputArgs, "-filter_complex", filter, "-map", "[v]", "output.mp4"]);
    }
  }

  const data = await ffmpeg.readFile("output.mp4");
  return URL.createObjectURL(new Blob([data.buffer], { type: "video/mp4" }));
}

async function generateStoryboard() {
  const topic = els.prompt.value.trim();
  if (!topic) {
    setStatus("Describe a topic or script outline first.", "error");
    return;
  }

  const modelId = els.modelSelect.value;
  const aspectRatio = els.aspectRatio.value;
  const totalSeconds = Number(els.videoLength.value);
  const style = els.ugcStyle.checked ? "ugc" : "standard";

  let referenceImage = null;
  if (style === "ugc" && els.referenceImage.files[0]) {
    try {
      referenceImage = await fileToResizedDataURL(els.referenceImage.files[0]);
    } catch {
      setStatus("Couldn't read the reference photo.", "error");
      return;
    }
  }

  setStatus("Planning scenes…");
  const planRes = await fetch("/api/plan-scenes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ topic, totalSeconds, perSceneSeconds: 5, style }),
  });
  const plan = await planRes.json();
  if (!planRes.ok) {
    setStatus(plan.error || "Couldn't plan scenes for that topic.", "error");
    return;
  }

  const scenes = plan.scenes;
  const statuses = scenes.map(() => "waiting");
  renderStoryboardProgress(scenes, statuses);
  setStatus(`Generating ${scenes.length} scene clips (this can take a while)…`);

  let firstError = null;
  const clipUrls = await runWithConcurrency(scenes, 2, async (sceneText, i) => {
    statuses[i] = "working";
    renderStoryboardProgress(scenes, statuses);
    try {
      const url = await generateOneSceneClip(sceneText, { modelId, aspectRatio, style, referenceImage });
      statuses[i] = "done";
      renderStoryboardProgress(scenes, statuses);
      return url;
    } catch (err) {
      statuses[i] = "failed";
      renderStoryboardProgress(scenes, statuses);
      if (!firstError) firstError = `Scene ${i + 1} failed: ${err.message}`;
      return null;
    }
  });

  if (firstError || clipUrls.some((u) => !u)) {
    setStatus((firstError || "One or more scenes failed.") + " Try again — storyboards don't partially resume.", "error");
    return;
  }

  setStatus("All scenes ready — stitching them into one video in your browser (this can take a few minutes)…");
  try {
    const finalUrl = await stitchVideoClips(clipUrls, (progress) => {
      setStatus(`Stitching… ${Math.round(progress * 100)}%`);
    });
    els.storyboardProgress.classList.add("hidden");
    upsertHistoryItem({
      id: "storyboard-" + Date.now(),
      prompt: topic,
      label: `Storyboard (${totalSeconds}s)`,
      kind: "video",
      status: "succeeded",
      url: finalUrl,
      isStoryboardResult: true,
    });
    setStatus("Done — download it from the gallery before refreshing the page.", "success");
  } catch (err) {
    setStatus(
      "Scenes generated fine, but stitching them together in your browser failed (" +
        (err.message || "unknown error") +
        "). Here are the individual clip links so you can stitch them elsewhere: " +
        clipUrls.join(" | "),
      "error"
    );
  }
}

// ---------- Kids content: multi-voice story or a song ----------

function parseScript(script) {
  return script
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line) => {
      const match = line.match(/^(kid|adult)\s*:\s*(.+)$/i);
      if (match) return { speaker: match[1].toLowerCase(), text: match[2].trim() };
      return { speaker: "adult", text: line }; // unlabeled lines default to the adult/narrator voice
    });
}

async function generateOneLine(text, voiceId) {
  const attempt = async () => {
    const res = await fetch("/api/tts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text, voiceId }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Line generation was rejected.");
    if (data.status === "succeeded") return Array.isArray(data.output) ? data.output[0] : data.output;
    const result = await pollPredictionPromise(data.id);
    if (result.status !== "succeeded") throw new Error(result.error || "Line generation failed.");
    return result.url;
  };
  try {
    return await attempt();
  } catch {
    return await attempt(); // one retry
  }
}

async function generateKidsStory() {
  const lines = parseScript(els.kidsScript.value);
  if (lines.length === 0) {
    setStatus("Write a script first.", "error");
    return;
  }

  // Use the typed-in voice ID when the dropdown is hidden (fal published no
  // enum for this model), otherwise use whichever dropdown option is picked.
  const kidVoiceId = els.kidVoiceManual.classList.contains("hidden") ? els.kidVoice.value : els.kidVoiceManual.value.trim();
  const adultVoiceId = els.adultVoiceManual.classList.contains("hidden") ? els.adultVoice.value : els.adultVoiceManual.value.trim();

  els.kidsProgress.classList.remove("hidden");
  const statuses = lines.map(() => "waiting");
  const renderProgress = () => {
    els.kidsProgress.innerHTML = lines
      .map((l, i) => {
        const st = statuses[i];
        const icon = st === "done" ? "✓" : st === "failed" ? "✕" : st === "working" ? "…" : "·";
        return `<div class="hint">${icon} ${l.speaker === "kid" ? "Kid" : "Adult"}: ${escapeHtml(l.text.slice(0, 60))}</div>`;
      })
      .join("");
  };
  renderProgress();
  setStatus(`Generating ${lines.length} line(s) of dialogue…`);

  let firstError = null;
  const audioUrls = await runWithConcurrency(lines, 2, async (line, i) => {
    statuses[i] = "working";
    renderProgress();
    try {
      const url = await generateOneLine(line.text, line.speaker === "kid" ? kidVoiceId : adultVoiceId);
      statuses[i] = "done";
      renderProgress();
      return url;
    } catch (err) {
      statuses[i] = "failed";
      renderProgress();
      if (!firstError) firstError = `Line ${i + 1} failed: ${err.message}`;
      return null;
    }
  });

  if (firstError || audioUrls.some((u) => !u)) {
    setStatus(firstError || "One or more lines failed to generate.", "error");
    return;
  }

  if (audioUrls.length === 1) {
    els.kidsProgress.classList.add("hidden");
    upsertHistoryItem({
      id: "kids-story-" + Date.now(),
      prompt: lines[0].text,
      label: "Kids story",
      kind: "audio",
      status: "succeeded",
      url: audioUrls[0],
    });
    setStatus("Done.", "success");
    return;
  }

  setStatus("All lines ready — stitching them into one audio track…");
  try {
    const finalUrl = await stitchAudioClips(audioUrls, (p) => setStatus(`Stitching… ${Math.round(p * 100)}%`));
    els.kidsProgress.classList.add("hidden");
    upsertHistoryItem({
      id: "kids-story-" + Date.now(),
      prompt: els.kidsScript.value.slice(0, 120),
      label: "Kids story",
      kind: "audio",
      status: "succeeded",
      url: finalUrl,
      isBrowserStitched: true,
    });
    setStatus("Done — download it from the gallery before refreshing the page.", "success");
  } catch (err) {
    setStatus(
      "Lines generated fine, but stitching them together failed (" +
        (err.message || "unknown error") +
        "). Individual line links: " +
        audioUrls.join(" | "),
      "error"
    );
  }
}

const SONG_VOICE_CLAUSES = {
  kid: "sung by a cheerful child's voice",
  adult: "sung by a warm adult voice",
  duet: "sung as a duet between a child's voice and an adult voice",
  choir: "sung by a children's choir",
};

// Kicks off a song generation and waits for the finished audio URL.
async function generateSongAudioUrl(lyrics, caption, durationSeconds) {
  const res = await fetch("/api/generate-song", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ lyrics, caption, durationSeconds }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Song generation was rejected.");
  if (data.status === "succeeded") return Array.isArray(data.output) ? data.output[0] : data.output;
  const result = await pollPredictionPromise(data.id);
  if (result.status !== "succeeded") throw new Error(result.error || "Song generation failed.");
  return result.url;
}

async function generateKidsSong() {
  const lyrics = els.songLyrics.value.trim();
  const styleText = els.songStyle.value.trim();
  if (!lyrics || !styleText) {
    setStatus("Add both lyrics and a style/mood description.", "error");
    return;
  }

  const caption = `${styleText}, ${SONG_VOICE_CLAUSES[els.songVoice.value]}`;

  setStatus("Generating song — this can take a few minutes…");
  try {
    const url = await generateSongAudioUrl(lyrics, caption, Number(els.songLength.value));
    upsertHistoryItem({
      id: "kids-song-" + Date.now(),
      prompt: lyrics.slice(0, 120),
      label: "Kids song",
      kind: "audio",
      status: "succeeded",
      url,
    });
    setStatus("Done.", "success");
  } catch (err) {
    setStatus(err.message || "Something went wrong.", "error");
  }
}

// ---------- Cartoon Song Video (character + song + dancing scenes + lip sync) ----------

els.generateCharacterBtn.addEventListener("click", async () => {
  const desc = els.cartoonCharacter.value.trim();
  if (!desc) {
    setStatus("Describe the character first.", "error");
    return;
  }
  els.generateCharacterBtn.disabled = true;
  els.generateCharacterBtn.textContent = "Generating…";
  try {
    const res = await fetch("/api/generate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ modelId: "flux-1.1-pro", prompt: desc, aspectRatio: "1:1", style: "cartoon" }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Character generation was rejected.");
    let url = data.status === "succeeded" ? (Array.isArray(data.output) ? data.output[0] : data.output) : null;
    if (!url) {
      const result = await pollPredictionPromise(data.id);
      if (result.status !== "succeeded") throw new Error(result.error || "Character generation failed.");
      url = result.url;
    }
    cartoonCharacterUrl = url;
    els.cartoonCharacterImg.src = url;
    els.cartoonCharacterPreview.classList.remove("hidden");
    setStatus("Character ready — regenerate if you'd like a different look, or move on to the song.", "success");
  } catch (err) {
    setStatus(err.message || "Network error.", "error");
  } finally {
    els.generateCharacterBtn.disabled = false;
    els.generateCharacterBtn.textContent = "🎨 Generate character design";
  }
});

// Splits a full song into ~segmentSeconds chunks (as base64 data URLs, small
// enough to send inline) so each can be lip-synced to its own scene clip.
async function sliceSongIntoSegments(songUrl, segmentSeconds, count) {
  const { ffmpeg, fetchFile } = await loadFFmpeg();
  await ffmpeg.writeFile("song.mp3", await fetchFile(songUrl));

  const segments = [];
  for (let i = 0; i < count; i++) {
    const outName = `seg${i}.mp3`;
    await ffmpeg.exec([
      "-i", "song.mp3",
      "-ss", String(i * segmentSeconds),
      "-t", String(segmentSeconds),
      "-c", "copy",
      outName,
    ]);
    const data = await ffmpeg.readFile(outName);
    const dataUrl = await readFileAsDataURL(new Blob([data.buffer], { type: "audio/mpeg" }));
    segments.push(dataUrl);
  }
  return segments;
}

async function lipsyncOneScene(videoUrl, audioDataUrl) {
  const attempt = async () => {
    const res = await fetch("/api/lipsync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ video: videoUrl, audio: audioDataUrl }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Lip sync was rejected.");
    if (data.status === "succeeded") return Array.isArray(data.output) ? data.output[0] : data.output;
    const result = await pollPredictionPromise(data.id);
    if (result.status !== "succeeded") throw new Error(result.error || "Lip sync failed.");
    return result.url;
  };
  try {
    return await attempt();
  } catch {
    return await attempt(); // one retry
  }
}

async function generateCartoonSongVideo() {
  if (!cartoonCharacterUrl) {
    setStatus("Generate a character design first.", "error");
    return;
  }
  const lyrics = els.cartoonLyrics.value.trim();
  const styleText = els.cartoonSongStyle.value.trim();
  if (!lyrics || !styleText) {
    setStatus("Add both lyrics and a style/mood description.", "error");
    return;
  }

  const totalSeconds = Number(els.cartoonLength.value);
  const modelId = els.cartoonVideoModel.value;
  const actionMotion = els.cartoonAction.value;
  const perScene = 5;
  const numScenes = Math.ceil(totalSeconds / perScene);

  const progress = (label) => {
    els.kidsProgress.classList.remove("hidden");
    els.kidsProgress.innerHTML = `<div class="hint">${escapeHtml(label)}</div>`;
  };

  try {
    // 1. Song
    progress("Generating song…");
    setStatus("Generating song — this can take a few minutes…");
    const caption = `${styleText}, ${SONG_VOICE_CLAUSES.kid}`;
    const songUrl = await generateSongAudioUrl(lyrics, caption, totalSeconds);
    upsertHistoryItem({
      id: "cartoon-song-" + Date.now(),
      prompt: lyrics.slice(0, 120),
      label: "Cartoon song (audio)",
      kind: "audio",
      status: "succeeded",
      url: songUrl,
    });

    // 2. Plan scenes around the character + song theme
    progress("Planning scenes…");
    setStatus("Planning scenes…");
    const topic = `A cartoon character (${els.cartoonCharacter.value.trim()}) performing a kids song with these lyrics: ${lyrics}`;
    const planRes = await fetch("/api/plan-scenes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ topic, totalSeconds, perSceneSeconds: perScene, style: "cartoon" }),
    });
    const plan = await planRes.json();
    if (!planRes.ok) throw new Error(plan.error || "Couldn't plan scenes.");
    const scenes = plan.scenes.slice(0, numScenes);

    const renderProgress = (label, statuses) => {
      els.kidsProgress.innerHTML =
        `<div class="hint">${escapeHtml(label)}</div>` +
        scenes
          .map((s, i) => {
            const st = statuses[i] || "waiting";
            const icon = st === "done" ? "✓" : st === "failed" ? "✕" : st === "working" ? "…" : "·";
            return `<div class="hint">${icon} Scene ${i + 1}/${scenes.length}: ${escapeHtml(s.slice(0, 60))}</div>`;
          })
          .join("");
    };

    // 3. Animate the character for each scene (image-to-video from the
    // character design, biased toward the chosen action).
    const videoStatuses = scenes.map(() => "waiting");
    renderProgress("Animating character scenes…", videoStatuses);
    setStatus(`Generating ${scenes.length} animated scene(s)…`);

    let firstError = null;
    const sceneVideoUrls = await runWithConcurrency(scenes, 2, async (sceneText, i) => {
      videoStatuses[i] = "working";
      renderProgress("Animating character scenes…", videoStatuses);
      try {
        const res = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            modelId,
            prompt: sceneText,
            style: "cartoon",
            startImage: cartoonCharacterUrl,
            actionMotion,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Scene animation was rejected.");
        let url = data.status === "succeeded" ? (Array.isArray(data.output) ? data.output[0] : data.output) : null;
        if (!url) {
          const result = await pollPredictionPromise(data.id);
          if (result.status !== "succeeded") throw new Error(result.error || "Scene animation failed.");
          url = result.url;
        }
        videoStatuses[i] = "done";
        renderProgress("Animating character scenes…", videoStatuses);
        return url;
      } catch (err) {
        videoStatuses[i] = "failed";
        renderProgress("Animating character scenes…", videoStatuses);
        if (!firstError) firstError = `Scene ${i + 1} animation failed: ${err.message}`;
        return null;
      }
    });

    if (firstError || sceneVideoUrls.some((u) => !u)) {
      throw new Error(firstError || "One or more scenes failed to animate.");
    }

    // 4. Slice the song to match each scene, then lip-sync each scene to its slice
    setStatus("Slicing the song to match each scene…");
    const segments = await sliceSongIntoSegments(songUrl, perScene, scenes.length);

    const syncStatuses = scenes.map(() => "waiting");
    renderProgress("Lip-syncing each scene to the song…", syncStatuses);
    setStatus("Lip-syncing each scene to the song…");

    let syncError = null;
    const syncedUrls = await runWithConcurrency(
      scenes.map((_, i) => i),
      2,
      async (i) => {
        syncStatuses[i] = "working";
        renderProgress("Lip-syncing each scene to the song…", syncStatuses);
        try {
          const url = await lipsyncOneScene(sceneVideoUrls[i], segments[i]);
          syncStatuses[i] = "done";
          renderProgress("Lip-syncing each scene to the song…", syncStatuses);
          return url;
        } catch (err) {
          syncStatuses[i] = "failed";
          renderProgress("Lip-syncing each scene to the song…", syncStatuses);
          if (!syncError) syncError = `Scene ${i + 1} lip sync failed: ${err.message}`;
          return null;
        }
      }
    );

    if (syncError || syncedUrls.some((u) => !u)) {
      throw new Error(
        (syncError || "One or more scenes failed to lip-sync.") +
          " The animated (silent) scenes are still available: " +
          sceneVideoUrls.join(" | ")
      );
    }

    // 5. Stitch the lip-synced scenes into one final video
    setStatus("Stitching the final video together…");
    const finalUrl = await stitchVideoClips(syncedUrls, (p) => setStatus(`Stitching… ${Math.round(p * 100)}%`), {
      withAudio: true,
    });

    els.kidsProgress.classList.add("hidden");
    upsertHistoryItem({
      id: "cartoon-video-" + Date.now(),
      prompt: lyrics.slice(0, 120),
      label: "Cartoon song video",
      kind: "video",
      status: "succeeded",
      url: finalUrl,
      isBrowserStitched: true,
    });
    setStatus("Done — download it from the gallery before refreshing the page. Scene cuts may not line up perfectly with the beat; that's a limit of stitching independently-timed clips.", "success");
  } catch (err) {
    setStatus(err.message || "Something went wrong.", "error");
  }
}

els.generateBtn.addEventListener("click", async () => {
  els.generateBtn.disabled = true;
  try {
    if (mode === "lipsync") await generateLipsync();
    else if (mode === "kids" && kidsSubMode === "song") await generateKidsSong();
    else if (mode === "kids" && kidsSubMode === "cartoon") await generateCartoonSongVideo();
    else if (mode === "kids") await generateKidsStory();
    else if (isStoryboard()) await generateStoryboard();
    else await generateImageOrVideo();
  } catch (err) {
    console.error(err); // full details in the browser console for debugging
    setStatus(err.message || "Network error.", "error");
  } finally {
    els.generateBtn.disabled = false;
  }
});

els.clearBtn.addEventListener("click", () => {
  localStorage.removeItem(STORAGE_KEY);
  renderGallery();
});

applyModeUI();
renderGallery();
