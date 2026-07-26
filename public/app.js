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
      await pollPrediction(data.id, (result)
