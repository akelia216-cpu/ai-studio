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
let cartoonContentType = "song"; // song | narration | dialogue
let videoAudioSource = "script"; // script | upload
let dialogueVoiceSource = { 1: "preset", 2: "preset" }; // per-character: preset | clone
let dialogueClonedVoiceId = { 1: null, 2: null }; // per-character custom_voice_id once cloned
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
  cartoonContentBtns: document.querySelectorAll(".cartoon-content-btn"),
  cartoonSongFields: document.getElementById("cartoonSongFields"),
  cartoonNarrationFields: document.getElementById("cartoonNarrationFields"),
  cartoonDialogueFields: document.getElementById("cartoonDialogueFields"),
  cartoonLengthField: document.getElementById("cartoonLengthField"),
  cartoonLyrics: document.getElementById("cartoonLyrics"),
  cartoonSongStyle: document.getElementById("cartoonSongStyle"),
  cartoonScript: document.getElementById("cartoonScript"),
  cartoonVoice: document.getElementById("cartoonVoice"),
  cartoonVoiceManual: document.getElementById("cartoonVoiceManual"),
  cartoonVideoModel: document.getElementById("cartoonVideoModel"),
  cartoonAction: document.getElementById("cartoonAction"),
  cartoonLength: document.getElementById("cartoonLength"),
  cartoonStyleDescription: document.getElementById("cartoonStyleDescription"),
  cartoonBackgroundDescription: document.getElementById("cartoonBackgroundDescription"),
  dialogueVoiceSourceBtns: document.querySelectorAll(".dialogue-voice-source-btn"),
  dialogueScript: document.getElementById("dialogueScript"),
  dialogueBothImage: document.getElementById("dialogueBothImage"),
  dialogueChar1Name: document.getElementById("dialogueChar1Name"),
  dialogueChar1ImgDefault: document.getElementById("dialogueChar1ImgDefault"),
  dialogueChar1ExtraExpressions: document.getElementById("dialogueChar1ExtraExpressions"),
  dialogueChar1AddExpressionBtn: document.getElementById("dialogueChar1AddExpressionBtn"),
  dialogueChar1PresetVoice: document.getElementById("dialogueChar1PresetVoice"),
  dialogueChar1CloneVoice: document.getElementById("dialogueChar1CloneVoice"),
  dialogueChar1Voice: document.getElementById("dialogueChar1Voice"),
  dialogueChar1VoiceManual: document.getElementById("dialogueChar1VoiceManual"),
  dialogueChar1CloneFile: document.getElementById("dialogueChar1CloneFile"),
  dialogueChar1CloneBtn: document.getElementById("dialogueChar1CloneBtn"),
  dialogueChar1CloneStatus: document.getElementById("dialogueChar1CloneStatus"),
  dialogueChar2Name: document.getElementById("dialogueChar2Name"),
  dialogueChar2ImgDefault: document.getElementById("dialogueChar2ImgDefault"),
  dialogueChar2ExtraExpressions: document.getElementById("dialogueChar2ExtraExpressions"),
  dialogueChar2AddExpressionBtn: document.getElementById("dialogueChar2AddExpressionBtn"),
  dialogueChar2PresetVoice: document.getElementById("dialogueChar2PresetVoice"),
  dialogueChar2CloneVoice: document.getElementById("dialogueChar2CloneVoice"),
  dialogueChar2Voice: document.getElementById("dialogueChar2Voice"),
  dialogueChar2VoiceManual: document.getElementById("dialogueChar2VoiceManual"),
  dialogueChar2CloneFile: document.getElementById("dialogueChar2CloneFile"),
  dialogueChar2CloneBtn: document.getElementById("dialogueChar2CloneBtn"),
  dialogueChar2CloneStatus: document.getElementById("dialogueChar2CloneStatus"),
  kidsProgress: document.getElementById("kidsProgress"),
  modelSelect: document.getElementById("model"),
  aspectRatio: document.getElementById("aspectRatio"),
  promptLabel: document.getElementById("promptLabel"),
  prompt: document.getElementById("prompt"),
  enhanceBtn: document.getElementById("enhanceBtn"),
  videoLength: document.getElementById("videoLength"),
  lengthHint: document.getElementById("lengthHint"),
  storyboardProgress: document.getElementById("storyboardProgress"),
  addVideoAudio: document.getElementById("addVideoAudio"),
  videoAudioFields: document.getElementById("videoAudioFields"),
  videoAudioSourceBtns: document.querySelectorAll(".video-audio-source-btn"),
  videoAudioScriptFields: document.getElementById("videoAudioScriptFields"),
  videoAudioUploadFields: document.getElementById("videoAudioUploadFields"),
  videoAudioScript: document.getElementById("videoAudioScript"),
  videoAudioVoice: document.getElementById("videoAudioVoice"),
  videoAudioVoiceManual: document.getElementById("videoAudioVoiceManual"),
  videoAudioFile: document.getElementById("videoAudioFile"),
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

function applyCartoonContentTypeUI() {
  els.cartoonContentBtns.forEach((b) => b.classList.toggle("active", b.dataset.cartooncontent === cartoonContentType));
  els.cartoonSongFields.classList.toggle("hidden", cartoonContentType !== "song");
  els.cartoonNarrationFields.classList.toggle("hidden", cartoonContentType !== "narration");
  els.cartoonDialogueFields.classList.toggle("hidden", cartoonContentType !== "dialogue");
  // Dialogue's video length is implied by how many lines the script has —
  // the Length dropdown doesn't apply there.
  els.cartoonLengthField.classList.toggle("hidden", cartoonContentType === "dialogue");
}

els.cartoonContentBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    cartoonContentType = btn.dataset.cartooncontent;
    applyCartoonContentTypeUI();
  });
});

function applyDialogueVoiceSourceUI(charNum) {
  const source = dialogueVoiceSource[charNum];
  els.dialogueVoiceSourceBtns.forEach((b) => {
    if (Number(b.dataset.char) === charNum) b.classList.toggle("active", b.dataset.voicesource === source);
  });
  const presetEl = charNum === 1 ? els.dialogueChar1PresetVoice : els.dialogueChar2PresetVoice;
  const cloneEl = charNum === 1 ? els.dialogueChar1CloneVoice : els.dialogueChar2CloneVoice;
  presetEl.classList.toggle("hidden", source !== "preset");
  cloneEl.classList.toggle("hidden", source !== "clone");
}

els.dialogueVoiceSourceBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    const charNum = Number(btn.dataset.char);
    dialogueVoiceSource[charNum] = btn.dataset.voicesource;
    applyDialogueVoiceSourceUI(charNum);
  });
});

// Expression images beyond "Default" are an open-ended, user-named set (not
// a fixed happy/surprised pair) — each row is a name + an uploaded image,
// added/removed freely so a script can reference any expression by name,
// e.g. "Pip (thinking): ..." or "Pip (triumphant): ...".
function addExpressionRow(charNum) {
  const container = charNum === 1 ? els.dialogueChar1ExtraExpressions : els.dialogueChar2ExtraExpressions;
  const row = document.createElement("div");
  row.className = "expression-row";
  row.innerHTML =
    '<input type="text" class="expr-name-input" placeholder="Expression name, e.g. thinking" />' +
    '<input type="file" class="expr-file-input" accept="image/*" />' +
    '<button type="button" class="expr-remove-btn">Remove</button>';
  row.querySelector(".expr-remove-btn").addEventListener("click", () => row.remove());
  container.appendChild(row);
}

// Reads back every expression row for a character as { name, file } pairs —
// a row only counts once it has both a name and an uploaded image; a row
// missing either is silently skipped rather than erroring, so a half-filled
// row someone forgot to remove doesn't block generation.
function getCharacterExpressionRows(charNum) {
  const container = charNum === 1 ? els.dialogueChar1ExtraExpressions : els.dialogueChar2ExtraExpressions;
  return [...container.querySelectorAll(".expression-row")]
    .map((row) => ({
      name: row.querySelector(".expr-name-input").value.trim().toLowerCase(),
      file: row.querySelector(".expr-file-input").files[0] || null,
    }))
    .filter((r) => r.name && r.file);
}

els.dialogueChar1AddExpressionBtn.addEventListener("click", () => addExpressionRow(1));
els.dialogueChar2AddExpressionBtn.addEventListener("click", () => addExpressionRow(2));

// Uploads a short voice sample and clones it via fal's minimax voice-clone
// model, returning a custom_voice_id string that can be reused anywhere a
// preset voice ID is accepted (api/tts.js already passes any voiceId string
// straight through to the TTS model's voice_setting.voice_id field).
async function cloneVoice(file) {
  const audioUrl = await uploadFileToFal(file);
  const res = await fetch("/api/voice-clone", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ audioUrl }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Voice cloning was rejected.");
  if (data.status === "succeeded" && data.output) return data.output;
  const result = await pollPredictionPromise(data.id);
  if (result.status !== "succeeded") throw new Error(result.error || "Voice cloning failed.");
  return result.url; // pollPrediction stores whatever the output field held here — the custom_voice_id string in this case
}

function wireDialogueCloneButton(charNum) {
  const btn = charNum === 1 ? els.dialogueChar1CloneBtn : els.dialogueChar2CloneBtn;
  const fileInput = charNum === 1 ? els.dialogueChar1CloneFile : els.dialogueChar2CloneFile;
  const statusEl = charNum === 1 ? els.dialogueChar1CloneStatus : els.dialogueChar2CloneStatus;
  btn.addEventListener("click", async () => {
    const file = fileInput.files[0];
    if (!file) {
      statusEl.textContent = "Choose a voice sample file first.";
      return;
    }
    btn.disabled = true;
    statusEl.textContent = "Cloning voice… this can take a minute…";
    try {
      const voiceId = await cloneVoice(file);
      dialogueClonedVoiceId[charNum] = voiceId;
      statusEl.textContent = "Voice cloned ✓";
    } catch (err) {
      dialogueClonedVoiceId[charNum] = null;
      statusEl.textContent = "Couldn't clone that voice: " + (err.message || "unknown error");
    } finally {
      btn.disabled = false;
    }
  });
}
wireDialogueCloneButton(1);
wireDialogueCloneButton(2);

function applyVideoAudioUI() {
  els.videoAudioFields.classList.toggle("hidden", !els.addVideoAudio.checked);
}
els.addVideoAudio.addEventListener("change", applyVideoAudioUI);

function applyVideoAudioSourceUI() {
  els.videoAudioSourceBtns.forEach((b) => b.classList.toggle("active", b.dataset.audiosource === videoAudioSource));
  els.videoAudioScriptFields.classList.toggle("hidden", videoAudioSource !== "script");
  els.videoAudioUploadFields.classList.toggle("hidden", videoAudioSource !== "upload");
}
els.videoAudioSourceBtns.forEach((btn) => {
  btn.addEventListener("click", () => {
    videoAudioSource = btn.dataset.audiosource;
    applyVideoAudioSourceUI();
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
      els.cartoonVoice.classList.add("hidden");
      els.cartoonVoiceManual.classList.remove("hidden");
      els.videoAudioVoice.classList.add("hidden");
      els.videoAudioVoiceManual.classList.remove("hidden");
      els.dialogueChar1Voice.classList.add("hidden");
      els.dialogueChar1VoiceManual.classList.remove("hidden");
      els.dialogueChar2Voice.classList.add("hidden");
      els.dialogueChar2VoiceManual.classList.remove("hidden");
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
    fill(els.cartoonVoice, data.kid, "(no kid-style voices found — pick from adult list)");
    fill(els.videoAudioVoice, data.kid.concat(data.adult), "(no voices found)");
    fill(els.dialogueChar1Voice, data.kid.concat(data.adult), "(no voices found)");
    fill(els.dialogueChar2Voice, data.kid.concat(data.adult), "(no voices found)");
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
      ensureVoicesLoaded(); // needed for the "Add matching audio" voice picker
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

  let finalUrl = placeholder.url;
  if (placeholder.status !== "succeeded") {
    setStatus(
      "Generating — this can take anywhere from a few seconds to a couple minutes…" + (notes.length ? " (" + notes.join("; ") + ")" : "")
    );
    await pollPrediction(data.id, (result) => {
      finalUrl = result.status === "succeeded" ? result.url : null;
      upsertHistoryItem({ id: data.id, ...result });
    });
  }

  if (mode === "video" && finalUrl && els.addVideoAudio.checked) {
    try {
      setStatus("Adding matching audio…");
      const audioUrls = await buildSceneAudioForVideo(1, 5);
      setStatus("Lip-syncing audio to the video…");
      let syncedUrl = await lipsyncOneScene(finalUrl, audioUrls[0]);

      // Auto-detect a sound effect from the video's own generation prompt
      // (that's what actually describes the on-screen action) and mix it in
      // if one applies — a failed detection/generation just skips this step.
      try {
        setStatus("Checking for a sound effect…");
        const sfxDescription = await detectSfx(prompt);
        if (sfxDescription) {
          setStatus("Generating and mixing in a sound effect…");
          const sfxUrl = await generateSoundEffect(sfxDescription, 2);
          syncedUrl = await mixSfxAndStitch([syncedUrl], [sfxUrl]);
        }
      } catch {
        // Sound effects are a nice-to-have on top of the main video — never
        // let a failure here take down an otherwise-successful generation.
      }

      upsertHistoryItem({ id: data.id, url: syncedUrl, label: "Video with matching audio" });
    } catch (err) {
      setStatus(
        "Video generated, but adding audio failed (" + (err.message || "unknown error") + "). The silent video is still saved.",
        "error"
      );
      return;
    }
  }

  setStatus(notes.length ? "Done — " + notes.join("; ") + "." : "Done.", "success");
}

// Uploads a file directly to fal's own storage/CDN, bypassing our serverless
// functions entirely for the large byte transfer — Vercel's request body
// limit (~4.5MB) has nothing to do with how big a file fal can accept, so
// embedding video/audio as base64 in a JSON body was the wrong shape to
// begin with. Verified against fal's own docs/client source: a tiny
// server-side call (/api/upload-url, using our secret FAL_KEY) gets a
// one-time upload URL; the browser then PUTs the raw file straight to that
// URL — no key needed for that step — and gets back a real https:// file
// URL to use as a model input.
async function uploadFileToFal(file) {
  const initRes = await fetch("/api/upload-url", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ contentType: file.type || "application/octet-stream", fileName: file.name || "upload" }),
  });
  const initData = await initRes.json();
  if (!initRes.ok) throw new Error(initData.error || "Couldn't prepare the upload.");

  const putRes = await fetch(initData.uploadUrl, {
    method: "PUT",
    headers: { "Content-Type": file.type || "application/octet-stream" },
    body: file,
  });
  if (!putRes.ok) throw new Error(`Upload to fal's storage failed (${putRes.status}).`);

  return initData.fileUrl;
}

// Builds one audio clip per video scene, either from a narration script (via
// TTS, chunked to roughly match scene count) or from an uploaded file (sliced
// into segments for a storyboard, used as-is for a single short clip).
// Shared by both single-shot "Add matching audio" and storyboard mode.
async function buildSceneAudioForVideo(numScenes, perSceneSeconds) {
  if (videoAudioSource === "upload") {
    const file = els.videoAudioFile.files[0];
    if (!file) throw new Error("Choose an audio file, or switch to writing a narration script.");
    const url = await uploadFileToFal(file);
    if (numScenes <= 1) return [url];
    return await sliceSongIntoSegments(url, perSceneSeconds, numScenes);
  }

  const script = els.videoAudioScript.value.trim();
  if (!script) throw new Error("Write a narration script, or switch to uploading an audio file.");
  const voiceId = els.videoAudioVoiceManual.classList.contains("hidden") ? els.videoAudioVoice.value : els.videoAudioVoiceManual.value.trim();

  const chunks = chunkScriptIntoScenes(script, numScenes);
  if (chunks.length === 0) throw new Error("Couldn't split that script — check it has actual sentences.");

  let audioError = null;
  const audioUrls = await runWithConcurrency(chunks, 2, async (text) => {
    try {
      return await generateOneLine(text, voiceId);
    } catch (err) {
      if (!audioError) audioError = err.message;
      return null;
    }
  });
  if (audioError || audioUrls.some((u) => !u)) throw new Error(audioError || "One or more narration lines failed to generate.");
  return audioUrls;
}

async function generateLipsync() {
  const videoFile = els.lipsyncVideo.files[0];
  const audioFile = els.lipsyncAudio.files[0];

  if (!videoFile || !audioFile) {
    setStatus("Choose both a source video and an audio file.", "error");
    return;
  }

  let videoUrl, audioUrl;
  try {
    setStatus("Uploading video…");
    videoUrl = await uploadFileToFal(videoFile);
    setStatus("Uploading audio…");
    audioUrl = await uploadFileToFal(audioFile);
  } catch (err) {
    setStatus("Couldn't upload the files (" + (err.message || "unknown error") + ").", "error");
    return;
  }

  setStatus("Sending request…");

  const res = await fetch("/api/lipsync", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ video: videoUrl, audio: audioUrl }),
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
  // ffmpeg.wasm spawns its own worker (default "./worker.js", resolved against
  // esm.sh's module URL) to actually run ffmpeg — since that resolves to a
  // different origin than this app, browsers refuse to construct that Worker
  // at all ("cannot be accessed from origin ..."). Blob-ifying it, exactly
  // like coreURL/wasmURL already are, makes it same-origin. esm.sh
  // content-hashes its internal file paths (so the worker isn't at a stable
  // URL there); unpkg serves the package's raw files unchanged, so pull the
  // worker script from there instead.
  const workerBase = "https://unpkg.com/@ffmpeg/ffmpeg@0.12.10/dist/esm";
  await ffmpeg.load({
    coreURL: await toBlobURL(`${base}/ffmpeg-core.js`, "text/javascript"),
    wasmURL: await toBlobURL(`${base}/ffmpeg-core.wasm`, "application/wasm"),
    classWorkerURL: await toBlobURL(`${workerBase}/worker.js`, "text/javascript"),
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

  let finalClipUrls = clipUrls;
  let withAudio = false;
  if (els.addVideoAudio.checked) {
    try {
      setStatus("Preparing matching audio for each scene…");
      const audioUrls = await buildSceneAudioForVideo(scenes.length, 5);
      if (audioUrls.length < scenes.length) {
        throw new Error(`Only got ${audioUrls.length} audio segment(s) for ${scenes.length} scenes — try a longer script.`);
      }
      setStatus("Lip-syncing each scene to its audio…");
      let syncError = null;
      const syncedUrls = await runWithConcurrency(clipUrls.map((_, i) => i), 2, async (i) => {
        try {
          return await lipsyncOneScene(clipUrls[i], audioUrls[i]);
        } catch (err) {
          if (!syncError) syncError = `Scene ${i + 1} lip sync failed: ${err.message}`;
          return null;
        }
      });
      if (syncError || syncedUrls.some((u) => !u)) throw new Error(syncError || "One or more scenes failed to lip-sync.");
      finalClipUrls = syncedUrls;
      withAudio = true;
    } catch (err) {
      setStatus(
        "Couldn't add matching audio (" + (err.message || "unknown error") + ") — continuing with a silent video instead.",
        "error"
      );
    }
  }

  // Auto-detect sound effects from each scene's own visual description —
  // only when scenes already carry real (matching) audio, since mixing an
  // SFX track onto a genuinely silent clip while others stay silent breaks
  // stitching (some clips would have an audio stream and some wouldn't).
  let sfxAudioUrls = null;
  if (withAudio) {
    try {
      setStatus("Checking scenes for sound effects…");
      const sfxDescriptions = await detectSfxForScenes(scenes);
      if (sfxDescriptions.some(Boolean)) {
        setStatus("Generating sound effects…");
        sfxAudioUrls = await generateSfxAudioClips(sfxDescriptions);
      }
    } catch {
      sfxAudioUrls = null; // sound effects are a nice-to-have — never block the main video over this
    }
  }

  setStatus("All scenes ready — stitching them into one video in your browser (this can take a few minutes)…");
  try {
    const finalUrl = sfxAudioUrls
      ? await mixSfxAndStitch(finalClipUrls, sfxAudioUrls, (progress) => setStatus(`Stitching… ${Math.round(progress * 100)}%`))
      : await stitchVideoClips(
          finalClipUrls,
          (progress) => {
            setStatus(`Stitching… ${Math.round(progress * 100)}%`);
          },
          { withAudio }
        );
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
        finalClipUrls.join(" | "),
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
      body: JSON.stringify({
        modelId: "flux-1.1-pro",
        prompt: desc,
        aspectRatio: "1:1",
        style: "cartoon",
        styleOverride: els.cartoonStyleDescription.value.trim(),
      }),
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

// Splits a narration script into up to `targetScenes` chunks, preserving the
// exact wording (no paraphrasing) and keeping sentences intact where
// possible, so each chunk reads naturally when spoken and lip-synced to its
// own scene clip.
function chunkScriptIntoScenes(script, targetScenes) {
  const sentences = script
    .trim()
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (sentences.length === 0) return [];

  const totalWords = sentences.reduce((n, s) => n + s.split(/\s+/).length, 0);
  const perSceneWords = Math.max(1, Math.ceil(totalWords / Math.max(1, targetScenes)));

  const chunks = [];
  let current = [];
  let currentWords = 0;
  for (const sentence of sentences) {
    const w = sentence.split(/\s+/).length;
    if (current.length && currentWords + w > perSceneWords && chunks.length < targetScenes - 1) {
      chunks.push(current.join(" "));
      current = [];
      currentWords = 0;
    }
    current.push(sentence);
    currentWords += w;
  }
  if (current.length) chunks.push(current.join(" "));
  return chunks;
}

// A handful of small variations on the same "Pip talking" scene so a full
// narration video isn't just the same identical shot repeated — the
// underlying framing/motion requirements (medium shot, continuous mouth
// movement) stay fixed since those are what make lip sync work well.
// ---------- Sound effects (auto-detected action sounds mixed into scenes) ----------
//
// Every video pipeline below tries to add short sound effects (a rock
// impact, a door slam, footsteps, etc.) automatically: each scene's text is
// sent to a small LLM (see api/detect-sfx.js) that decides whether the
// action calls for a specific sound, and if so a short clip is generated
// (fal-ai/elevenlabs/sound-effects/v2) and mixed into that scene's audio.
// Where the user writes the scene text themselves (Narration and Dialogue
// scripts), they can skip auto-detection for a line and specify the exact
// sound with an inline tag instead, e.g. "Pip: Watch out! [sfx: a rock
// hitting a wooden fence]" — the tag is stripped before the line is spoken.

function extractSfxTag(text) {
  const m = text.match(/\[sfx:\s*([^\]]+)\]/i);
  if (!m) return { cleanText: text.trim(), manualSfx: null };
  return { cleanText: text.replace(m[0], "").replace(/\s{2,}/g, " ").trim(), manualSfx: m[1].trim() };
}

async function detectSfx(text) {
  try {
    const res = await fetch("/api/detect-sfx", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const data = await res.json();
    if (!res.ok) return null;
    return data.sfx || null;
  } catch {
    return null;
  }
}

// Strips any manual [sfx: ...] tag from each scene's text (using it directly
// when present) and auto-detects a sound effect for every other scene.
// Returns arrays the same length/order as `texts`; sfxDescriptions[i] is
// null when no effect applies to that scene.
async function resolveSfxForScenes(texts) {
  const cleanTexts = [];
  const manualFlags = [];
  for (const t of texts) {
    const { cleanText, manualSfx } = extractSfxTag(t);
    cleanTexts.push(cleanText);
    manualFlags.push(manualSfx);
  }
  const sfxDescriptions = await runWithConcurrency(texts, 3, async (_, i) => (manualFlags[i] ? manualFlags[i] : await detectSfx(cleanTexts[i])));
  return { cleanTexts, sfxDescriptions };
}

// Like resolveSfxForScenes, but for scene text the user didn't type
// themselves (AI-planned storyboard/song scenes, or a video's own generation
// prompt) — auto-detect only, no manual tag support, since that text also
// feeds the visual generation call and isn't safe to rewrite here.
async function detectSfxForScenes(texts) {
  return await runWithConcurrency(texts, 3, async (t) => await detectSfx(t));
}

async function generateSoundEffect(text, durationSeconds = 2) {
  const res = await fetch("/api/sound-effect", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, durationSeconds }),
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || "Sound effect generation was rejected.");
  if (data.status === "succeeded") return Array.isArray(data.output) ? data.output[0] : data.output;
  const result = await pollPredictionPromise(data.id);
  if (result.status !== "succeeded") throw new Error(result.error || "Sound effect generation failed.");
  return result.url;
}

// Generates the actual short SFX clips for whichever scenes got a
// description back (null entries are skipped and stay null) — a failed
// individual SFX generation just means that scene plays without one; it's
// not treated as fatal since it's a nice-to-have on top of the main video.
async function generateSfxAudioClips(sfxDescriptions) {
  return await runWithConcurrency(sfxDescriptions, 3, async (desc) => {
    if (!desc) return null;
    try {
      return await generateSoundEffect(desc, 2);
    } catch {
      return null;
    }
  });
}

// Mixes each scene's optional SFX clip into its already-lip-synced video
// track (voice/song audio stays, SFX layers underneath at reduced volume),
// then stitches the results into one final video — all within a single
// ffmpeg.wasm session, since reloading ffmpeg per scene would be far slower.
// Works fine for a single scene too (the concat step just passes it through).
//
// opts.baseHasAudio: per-scene booleans (defaults to all-true). A scene with
// no base audio at all (a silent, non-verbal Dialogue beat with no TTS/lip
// sync) still needs SOME audio stream to sit in the same concat list as
// scenes that do — its sound effect becomes the sole audio track, or true
// silence is generated, so stitching never mixes audio-having and audio-less
// clips (which breaks both the fast-copy and filter_complex concat paths).
async function mixSfxAndStitch(sceneUrls, sfxAudioUrls, onProgress, opts = {}) {
  const baseHasAudio = opts.baseHasAudio || sceneUrls.map(() => true);
  const { ffmpeg, fetchFile } = await loadFFmpeg(onProgress);

  const finalNames = [];
  for (let i = 0; i < sceneUrls.length; i++) {
    const vName = `scene${i}.mp4`;
    await ffmpeg.writeFile(vName, await fetchFile(sceneUrls[i]));

    if (baseHasAudio[i]) {
      if (sfxAudioUrls[i]) {
        const sName = `sfx${i}.mp3`;
        const outName = `mixed${i}.mp4`;
        try {
          await ffmpeg.writeFile(sName, await fetchFile(sfxAudioUrls[i]));
          await ffmpeg.exec([
            "-i",
            vName,
            "-i",
            sName,
            "-filter_complex",
            "[1:a]volume=0.7[sfx];[0:a][sfx]amix=inputs=2:duration=first:dropout_transition=0:normalize=0[a]",
            "-map",
            "0:v",
            "-map",
            "[a]",
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-shortest",
            outName,
          ]);
          finalNames.push(outName);
          continue;
        } catch {
          // Fall through to using the unmixed scene clip below — a failed mix
          // for one scene shouldn't sink the whole video.
        }
      }
      finalNames.push(vName);
      continue;
    }

    // No base audio track on this clip at all — attach the sound effect as
    // the sole audio track, or true silence if there isn't one, so it still
    // has an audio stream like every other clip in the list.
    const outName = `withaudio${i}.mp4`;
    if (sfxAudioUrls[i]) {
      const sName = `sfx${i}.mp3`;
      await ffmpeg.writeFile(sName, await fetchFile(sfxAudioUrls[i]));
      await ffmpeg.exec(["-i", vName, "-i", sName, "-map", "0:v", "-map", "1:a", "-c:v", "copy", "-c:a", "aac", "-shortest", outName]);
    } else {
      await ffmpeg.exec([
        "-i",
        vName,
        "-filter_complex",
        "aevalsrc=0:d=10:s=44100[a]",
        "-map",
        "0:v",
        "-map",
        "[a]",
        "-c:v",
        "copy",
        "-c:a",
        "aac",
        "-shortest",
        outName,
      ]);
    }
    finalNames.push(outName);
  }

  if (finalNames.length === 1) {
    const data = await ffmpeg.readFile(finalNames[0]);
    return URL.createObjectURL(new Blob([data.buffer], { type: "video/mp4" }));
  }

  const listContent = finalNames.map((n) => `file '${n}'`).join("\n");
  await ffmpeg.writeFile("list.txt", listContent);
  try {
    await ffmpeg.exec(["-f", "concat", "-safe", "0", "-i", "list.txt", "-c", "copy", "output.mp4"]);
  } catch {
    const inputArgs = finalNames.flatMap((n) => ["-i", n]);
    const filter = `${finalNames.map((_, i) => `[${i}:v:0][${i}:a:0]`).join("")}concat=n=${finalNames.length}:v=1:a=1[v][a]`;
    await ffmpeg.exec([...inputArgs, "-filter_complex", filter, "-map", "[v]", "-map", "[a]", "output.mp4"]);
  }

  const data = await ffmpeg.readFile("output.mp4");
  return URL.createObjectURL(new Blob([data.buffer], { type: "video/mp4" }));
}

const NARRATION_SCENE_VARIATIONS = [
  "looking up at a sky full of stars, pointing upward while he talks",
  "gesturing warmly with his paws while he talks",
  "nodding and smiling warmly while he talks",
  "leaning in a little closer to the camera while he talks",
];

// The default look/setting, used whenever the shared "Visual style"/"Setting"
// fields are left blank — kept as a fallback constant so a network hiccup on
// the AI scene-prompt call still produces something reasonable.
const DEFAULT_VISUAL_STYLE = "flat 2D cartoon animation style, soft rounded character design, bright warm color palette";
const DEFAULT_NARRATION_BACKGROUND = "a warm, cozy backyard at dusk with a fence, some stars, and a crescent moon";
const DEFAULT_DIALOGUE_BACKGROUND = "a warm, cozy scene";

function buildNarrationScenePrompt(sceneIndex) {
  const actionDetail = NARRATION_SCENE_VARIATIONS[sceneIndex % NARRATION_SCENE_VARIATIONS.length];
  const visualStyle = els.cartoonStyleDescription.value.trim() || DEFAULT_VISUAL_STYLE;
  const background = els.cartoonBackgroundDescription.value.trim() || DEFAULT_NARRATION_BACKGROUND;
  return (
    `Pip the fox stands in ${background}, ${actionDetail}. ` +
    "Medium shot, front-facing camera — his whole upper body and face are clearly visible, not a tight close-up, " +
    "in the same friendly framing style as a preschool TV show. He's talking directly to the camera with warmth " +
    "and enthusiasm, his mouth moving naturally and continuously in a clear speaking rhythm, expressive but gentle. " +
    `He blinks naturally. ${visualStyle}, simple clean background, inviting and cheerful mood, no other characters in frame.`
  );
}

// Asks a small LLM to write a scene prompt that has the character actually
// act out a given line (instead of just standing and talking) in a specific
// setting matching it (or a fixed setting, if one was given), using the
// caller's chosen visual style instead of a hardcoded one. Used by both the
// Narration and Dialogue pipelines. Can also auto-pick which of a
// character's uploaded expressions best fits an untagged line
// (availableExpressions), can write a silent, non-verbal beat instead of a
// spoken one (nonVerbal), and picks a camera movement per scene — favoring a
// zoom-out/dolly-out reveal specifically for "both characters together"
// scenes (bothScene), since only those start from a reference image that
// already has both characters in it. Falls back to the caller's static
// prompt (e.g. buildNarrationScenePrompt/buildDialogueScenePrompt) and a
// "none" camera if the LLM call fails, so a hiccup here never blocks the
// whole video. Always returns { prompt, matchedExpression, cameraMotion }.
async function buildDynamicScenePrompt(opts) {
  const {
    characterName,
    characterDescription,
    lineText,
    expression,
    styleDescription,
    backgroundDescription,
    availableExpressions,
    nonVerbal,
    bothScene,
    fallback,
  } = opts;
  try {
    const res = await fetch("/api/build-scene-prompt", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        characterName,
        characterDescription,
        lineText,
        expression,
        styleDescription,
        backgroundDescription,
        availableExpressions,
        nonVerbal,
        bothScene,
      }),
    });
    const data = await res.json();
    if (!res.ok || !data.prompt) return { prompt: fallback, matchedExpression: null, cameraMotion: "none" };
    return { prompt: data.prompt, matchedExpression: data.matchedExpression || null, cameraMotion: data.cameraMotion || "none" };
  } catch {
    return { prompt: fallback, matchedExpression: null, cameraMotion: "none" };
  }
}

async function generateCartoonNarrationVideo() {
  if (!cartoonCharacterUrl) {
    setStatus("Generate a character design first.", "error");
    return;
  }
  const script = els.cartoonScript.value.trim();
  if (!script) {
    setStatus("Write a narration script first.", "error");
    return;
  }

  const totalSeconds = Number(els.cartoonLength.value);
  const modelId = els.cartoonVideoModel.value;
  const actionMotion = els.cartoonAction.value;
  const perScene = 5;
  const numScenes = Math.ceil(totalSeconds / perScene);

  const voiceId = els.cartoonVoiceManual.classList.contains("hidden") ? els.cartoonVoice.value : els.cartoonVoiceManual.value.trim();

  let chunks = chunkScriptIntoScenes(script, numScenes);
  if (chunks.length === 0) {
    setStatus("Couldn't split that script into scenes — check it has actual sentences.", "error");
    return;
  }

  const progress = (label) => {
    els.kidsProgress.classList.remove("hidden");
    els.kidsProgress.innerHTML = `<div class="hint">${escapeHtml(label)}</div>`;
  };
  const renderChunkProgress = (label, statuses) => {
    els.kidsProgress.innerHTML =
      `<div class="hint">${escapeHtml(label)}</div>` +
      chunks
        .map((c, i) => {
          const st = statuses[i] || "waiting";
          const icon = st === "done" ? "✓" : st === "failed" ? "✕" : st === "working" ? "…" : "·";
          return `<div class="hint">${icon} Scene ${i + 1}/${chunks.length}: ${escapeHtml(c.slice(0, 60))}</div>`;
        })
        .join("");
  };

  let sfxDescriptions = [];
  try {
    // 0. Strip any manual [sfx: ...] tags from the spoken text (so they're
    // never voiced by TTS) and resolve a sound effect — manual tag or
    // auto-detected — for each scene.
    progress("Checking scenes for sound effects…");
    setStatus("Checking scenes for sound effects…");
    const resolved = await resolveSfxForScenes(chunks);
    chunks = resolved.cleanTexts;
    sfxDescriptions = resolved.sfxDescriptions;

    // 1. Narration audio — one TTS clip per scene chunk (kept separate,
    // rather than one long track sliced up, since each chunk is already the
    // right length for its own scene).
    const audioStatuses = chunks.map(() => "waiting");
    renderChunkProgress("Generating narration audio…", audioStatuses);
    setStatus(`Generating ${chunks.length} line(s) of narration…`);

    let audioError = null;
    const audioUrls = await runWithConcurrency(chunks, 2, async (text, i) => {
      audioStatuses[i] = "working";
      renderChunkProgress("Generating narration audio…", audioStatuses);
      try {
        const url = await generateOneLine(text, voiceId);
        audioStatuses[i] = "done";
        renderChunkProgress("Generating narration audio…", audioStatuses);
        return url;
      } catch (err) {
        audioStatuses[i] = "failed";
        renderChunkProgress("Generating narration audio…", audioStatuses);
        if (!audioError) audioError = `Narration line ${i + 1} failed: ${err.message}`;
        return null;
      }
    });
    if (audioError || audioUrls.some((u) => !u)) throw new Error(audioError || "One or more narration lines failed.");

    // 2. Write a fresh scene prompt per line — has Pip actually act out what
    // the line describes, in a setting invented to match it, rather than the
    // same fixed backyard backdrop and a canned gesture every time.
    setStatus("Writing each scene…");
    const styleDescription = els.cartoonStyleDescription.value.trim();
    const backgroundDescription = els.cartoonBackgroundDescription.value.trim();
    const sceneResults = await runWithConcurrency(chunks, 3, async (text, i) =>
      buildDynamicScenePrompt({
        characterName: "Pip",
        characterDescription: "a friendly cartoon fox character",
        lineText: text,
        expression: null,
        styleDescription,
        backgroundDescription,
        fallback: buildNarrationScenePrompt(i),
      })
    );
    const scenePrompts = sceneResults.map((r) => r.prompt);
    const sceneCameraMotions = sceneResults.map((r) => r.cameraMotion);

    // 3. Animate the character for each scene.
    const videoStatuses = chunks.map(() => "waiting");
    renderChunkProgress("Animating character scenes…", videoStatuses);
    setStatus(`Generating ${chunks.length} animated scene(s)…`);

    let videoError = null;
    const sceneVideoUrls = await runWithConcurrency(chunks, 2, async (_, i) => {
      videoStatuses[i] = "working";
      renderChunkProgress("Animating character scenes…", videoStatuses);
      try {
        const res = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            modelId,
            prompt: scenePrompts[i],
            style: "cartoon",
            startImage: cartoonCharacterUrl,
            actionMotion,
            cameraMotion: sceneCameraMotions[i],
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
        renderChunkProgress("Animating character scenes…", videoStatuses);
        return url;
      } catch (err) {
        videoStatuses[i] = "failed";
        renderChunkProgress("Animating character scenes…", videoStatuses);
        if (!videoError) videoError = `Scene ${i + 1} animation failed: ${err.message}`;
        return null;
      }
    });
    if (videoError || sceneVideoUrls.some((u) => !u)) throw new Error(videoError || "One or more scenes failed to animate.");

    // 4. Lip-sync each scene to its own narration line.
    const syncStatuses = chunks.map(() => "waiting");
    renderChunkProgress("Lip-syncing each scene…", syncStatuses);
    setStatus("Lip-syncing each scene to its narration line…");

    let syncError = null;
    const syncedUrls = await runWithConcurrency(chunks.map((_, i) => i), 2, async (i) => {
      syncStatuses[i] = "working";
      renderChunkProgress("Lip-syncing each scene…", syncStatuses);
      try {
        const url = await lipsyncOneScene(sceneVideoUrls[i], audioUrls[i]);
        syncStatuses[i] = "done";
        renderChunkProgress("Lip-syncing each scene…", syncStatuses);
        return url;
      } catch (err) {
        syncStatuses[i] = "failed";
        renderChunkProgress("Lip-syncing each scene…", syncStatuses);
        if (!syncError) syncError = `Scene ${i + 1} lip sync failed: ${err.message}`;
        return null;
      }
    });
    if (syncError || syncedUrls.some((u) => !u)) {
      throw new Error(
        (syncError || "One or more scenes failed to lip-sync.") +
          " The animated (silent) scenes are still available: " +
          sceneVideoUrls.join(" | ")
      );
    }

    // 5. Generate any sound effects, mix them in, and stitch the final video.
    let finalUrl;
    if (sfxDescriptions.some(Boolean)) {
      setStatus("Generating sound effects…");
      const sfxAudioUrls = await generateSfxAudioClips(sfxDescriptions);
      setStatus("Mixing in sound effects and stitching the final video together…");
      finalUrl = await mixSfxAndStitch(syncedUrls, sfxAudioUrls, (p) => setStatus(`Stitching… ${Math.round(p * 100)}%`));
    } else {
      setStatus("Stitching the final video together…");
      finalUrl = await stitchVideoClips(syncedUrls, (p) => setStatus(`Stitching… ${Math.round(p * 100)}%`), {
        withAudio: true,
      });
    }

    els.kidsProgress.classList.add("hidden");
    upsertHistoryItem({
      id: "cartoon-narration-" + Date.now(),
      prompt: script.slice(0, 120),
      label: "Cartoon narration video",
      kind: "video",
      status: "succeeded",
      url: finalUrl,
      isBrowserStitched: true,
    });
    setStatus("Done — download it from the gallery before refreshing the page.", "success");
  } catch (err) {
    setStatus(err.message || "Something went wrong.", "error");
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
    const visualStyleClause = els.cartoonStyleDescription.value.trim() || DEFAULT_VISUAL_STYLE;
    const backgroundText = els.cartoonBackgroundDescription.value.trim();
    const backgroundClause = backgroundText
      ? `Use this exact setting for every single scene, do not invent a different one: ${backgroundText}.`
      : "Invent a specific, simple background matching that moment (2-4 concrete elements), varying the setting scene to scene instead of reusing one backdrop.";
    const topic =
      `A cartoon character (${els.cartoonCharacter.value.trim()}) performing a kids song with these lyrics: ${lyrics}. ` +
      "For each scene, have the character actually act out whatever that part of the lyrics describes — dancing, " +
      `pointing, jumping, interacting with objects — rather than just standing and singing. ${backgroundClause} ` +
      "Every scene must still be a medium shot, front-facing or three-quarter camera clearly showing the character's " +
      "whole upper body and face (never a close-up), with the character's mouth moving naturally and continuously " +
      `the whole time since each scene gets lip-synced to the song afterward, ${visualStyleClause}, cheerful ` +
      "preschool-TV-show mood, no other characters in frame.";
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

    // 5. Auto-detect sound effects from each scene's own description (these
    // scenes were AI-planned, not typed by the user, so there's no manual
    // [sfx: ...] tag support here — just detection).
    setStatus("Checking scenes for sound effects…");
    const sfxDescriptions = await detectSfxForScenes(scenes);

    // 6. Generate any sound effects, mix them in, and stitch the final video.
    let finalUrl;
    if (sfxDescriptions.some(Boolean)) {
      setStatus("Generating sound effects…");
      const sfxAudioUrls = await generateSfxAudioClips(sfxDescriptions);
      setStatus("Mixing in sound effects and stitching the final video together…");
      finalUrl = await mixSfxAndStitch(syncedUrls, sfxAudioUrls, (p) => setStatus(`Stitching… ${Math.round(p * 100)}%`));
    } else {
      setStatus("Stitching the final video together…");
      finalUrl = await stitchVideoClips(syncedUrls, (p) => setStatus(`Stitching… ${Math.round(p * 100)}%`), {
        withAudio: true,
      });
    }

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

// ---------- Cartoon Dialogue Video (two characters, expression images, cloned or preset voices) ----------

// This is a fixed fallback used only if the AI scene-prompt call
// (buildDynamicScenePrompt, below) fails — the primary path already sends
// whatever expression name was tagged (any name, not just these) straight to
// an LLM that handles it as free text, so this map only needs to cover a
// generic fallback rather than every possible expression.
const DIALOGUE_EXPRESSION_MOOD = {
  default: "talking naturally with warmth and enthusiasm",
  happy: "smiling brightly and talking with cheerful energy",
  surprised: "eyes wide with surprise, talking with excited emphasis",
};

function buildDialogueScenePrompt(characterName, expression) {
  const mood =
    DIALOGUE_EXPRESSION_MOOD[expression] ||
    (expression && expression !== "default" ? `showing a ${expression} expression while talking` : DIALOGUE_EXPRESSION_MOOD.default);
  const visualStyle = els.cartoonStyleDescription.value.trim() || DEFAULT_VISUAL_STYLE;
  const background = els.cartoonBackgroundDescription.value.trim() || DEFAULT_DIALOGUE_BACKGROUND;
  return (
    `${characterName}, a friendly cartoon character, stands in ${background}, ${mood}. ` +
    "Medium shot, front-facing camera — the whole upper body and face are clearly visible, not a tight close-up, " +
    "in the same friendly framing style as a preschool TV show. Mouth moving naturally and continuously in a clear " +
    `speaking rhythm. Blinks naturally. ${visualStyle}, simple clean background, inviting and cheerful mood, no other characters in frame.`
  );
}

// Parses "Name: text" / "Name (expression): text" lines, validating each
// speaker name against the two configured character names (or the reserved
// word "Both") up front so a typo fails fast instead of burning API calls
// before erroring out midway. A line wrapped in square brackets — "[Name:
// action]" or "[Name (expression): action]" — is a silent, non-verbal beat:
// no dialogue, so that scene skips TTS and lip-sync entirely and just plays
// the animated action (see generateCartoonDialogueVideo). "Both" is reserved
// for the two-characters-together reference image: "[Both: action]" is a
// silent two-character beat, and a normal speaking line can add "both" as an
// extra tag inside the parentheses — "Pip (both): ..." or "Pip (thinking,
// both): ..." — to use the together image for that one line while still
// having just that character speak. `explicitExpression` records whether the
// script itself tagged an expression, as opposed to defaulting to "default"
// — only untagged lines are eligible for automatic expression-matching later.
function parseDialogueScript(script, char1Name, char2Name) {
  const lines = script
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return [];

  const nameMap = {};
  nameMap[char1Name.trim().toLowerCase()] = 1;
  nameMap[char2Name.trim().toLowerCase()] = 2;

  const resolveSpeaker = (rawName, lineNo) => {
    const key = rawName.trim().toLowerCase();
    if (key === "both") return "both";
    const charNum = nameMap[key];
    if (!charNum) {
      throw new Error(`Line ${lineNo}: "${rawName.trim()}" doesn't match either character's name (${char1Name} or ${char2Name}), or "Both".`);
    }
    return charNum;
  };

  return lines.map((line, i) => {
    const silentMatch = line.match(/^\[\s*([^:()\]]+?)(?:\s*\(([^)]+)\))?\s*:\s*([^\]]+?)\s*\]\s*$/);
    if (silentMatch) {
      const [, rawName, rawExpr, action] = silentMatch;
      const charNum = resolveSpeaker(rawName, i + 1);
      return {
        charNum,
        expression: rawExpr ? rawExpr.trim().toLowerCase() : "default",
        explicitExpression: !!rawExpr,
        text: "",
        action: action.trim(),
        silent: true,
        bothScene: charNum === "both",
      };
    }

    const m = line.match(/^([^:()]+?)(?:\s*\(([^)]+)\))?\s*:\s*(.+)$/);
    if (!m) {
      throw new Error(`Line ${i + 1} isn't in "Name: text" format (or "[Name: action]" for a silent beat): "${line}"`);
    }
    const [, rawName, rawParen, text] = m;
    const charNum = resolveSpeaker(rawName, i + 1);
    if (charNum === "both") {
      throw new Error(
        `Line ${i + 1}: "Both" can't speak a line — use "[Both: action]" for a silent two-character beat, or tag a speaking ` +
          `character's line with "(both)" instead, e.g. "${char1Name} (both): ...".`
      );
    }

    // Parentheses can hold an expression name, the literal word "both", or
    // both comma-separated in either order, e.g. "(thinking, both)".
    let expression = "default";
    let explicitExpression = false;
    let bothScene = false;
    if (rawParen) {
      const tokens = rawParen
        .split(",")
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean);
      const rest = tokens.filter((t) => t !== "both");
      bothScene = rest.length !== tokens.length;
      if (rest.length > 0) {
        expression = rest[0];
        explicitExpression = true;
      }
    }

    return { charNum, expression, explicitExpression, text: text.trim(), action: null, silent: false, bothScene };
  });
}

async function generateCartoonDialogueVideo() {
  const char1Name = els.dialogueChar1Name.value.trim();
  const char2Name = els.dialogueChar2Name.value.trim();
  if (!char1Name || !char2Name) {
    setStatus("Give both characters a name first.", "error");
    return;
  }

  const script = els.dialogueScript.value.trim();
  if (!script) {
    setStatus("Write a dialogue script first.", "error");
    return;
  }

  let lines;
  try {
    lines = parseDialogueScript(script, char1Name, char2Name);
  } catch (err) {
    setStatus(err.message, "error");
    return;
  }
  if (lines.length === 0) {
    setStatus("Write a dialogue script first.", "error");
    return;
  }

  const defaultImgInputs = { 1: els.dialogueChar1ImgDefault, 2: els.dialogueChar2ImgDefault };
  if (!defaultImgInputs[1].files[0] || !defaultImgInputs[2].files[0]) {
    setStatus("Upload at least a default expression image for both characters.", "error");
    return;
  }

  // Voices — cloning (if selected) is expected to have already been done via
  // the dedicated Clone buttons before generation starts; here we just read
  // whichever source is selected per character.
  const resolveVoice = (charNum) => {
    if (dialogueVoiceSource[charNum] === "clone") {
      const id = dialogueClonedVoiceId[charNum];
      if (!id) throw new Error(`Clone character ${charNum}'s voice first (or switch it to a preset voice).`);
      return id;
    }
    const manualEl = charNum === 1 ? els.dialogueChar1VoiceManual : els.dialogueChar2VoiceManual;
    const presetEl = charNum === 1 ? els.dialogueChar1Voice : els.dialogueChar2Voice;
    return manualEl.classList.contains("hidden") ? presetEl.value : manualEl.value.trim();
  };

  let voiceIds;
  try {
    voiceIds = { 1: resolveVoice(1), 2: resolveVoice(2) };
  } catch (err) {
    setStatus(err.message, "error");
    return;
  }

  // Convert each uploaded expression image to a data URL once, up front
  // (rather than per-line) — Default plus however many custom-named
  // expressions were added — and fall back to the character's default image
  // for any expression tag that wasn't uploaded (typo, or just not covered).
  let charImages;
  let togetherImage = null;
  try {
    setStatus("Preparing character images…");
    charImages = { 1: {}, 2: {} };
    for (const charNum of [1, 2]) {
      charImages[charNum].default = await fileToResizedDataURL(defaultImgInputs[charNum].files[0]);
      for (const { name, file } of getCharacterExpressionRows(charNum)) {
        charImages[charNum][name] = await fileToResizedDataURL(file);
      }
    }
    if (els.dialogueBothImage.files[0]) {
      togetherImage = await fileToResizedDataURL(els.dialogueBothImage.files[0]);
    }
  } catch (err) {
    setStatus("Couldn't read one of the character images: " + (err.message || "unknown error"), "error");
    return;
  }

  // A "(both)"-tagged line or a "[Both: ...]" beat needs the together image —
  // check this before spending any generation calls, same reasoning as the
  // expression-tag check below.
  if (!togetherImage && lines.some((l) => l.bothScene)) {
    setStatus('Upload the "Both characters together" reference image first — your script uses "(both)" or "[Both: ...]".', "error");
    return;
  }

  const imageFor = (charNum, expr, bothScene) => {
    if (bothScene && togetherImage) return togetherImage;
    return charImages[charNum][expr] || charImages[charNum].default;
  };
  const nameFor = (charNum) => (charNum === "both" ? `${char1Name} and ${char2Name}` : charNum === 1 ? char1Name : char2Name);

  // Fail loudly on an unrecognized expression tag rather than silently
  // falling back to Default — better to catch a typo before spending any
  // generation calls than to quietly get the wrong pose. Skipped for
  // "both"-scene lines, since those use the together image regardless of any
  // expression tag rather than selecting one of a character's own images.
  const unknownTags = [];
  lines.forEach((l, i) => {
    if (l.charNum === "both" || l.bothScene) return;
    if (l.explicitExpression && !charImages[l.charNum][l.expression]) {
      const have = Object.keys(charImages[l.charNum]).filter((k) => k !== "default");
      unknownTags.push(
        `Line ${i + 1}: "${l.expression}" isn't an uploaded expression for ${nameFor(l.charNum)} (you have: default${
          have.length ? ", " + have.join(", ") : ""
        }).`
      );
    }
  });
  if (unknownTags.length > 0) {
    setStatus("Fix these expression tags before generating — " + unknownTags.join(" "), "error");
    return;
  }

  const modelId = els.cartoonVideoModel.value;
  const actionMotion = els.cartoonAction.value;
  const styleDescription = els.cartoonStyleDescription.value.trim();
  const backgroundDescription = els.cartoonBackgroundDescription.value.trim();

  const statuses = lines.map(() => "waiting");
  const renderProgress = (label) => {
    els.kidsProgress.classList.remove("hidden");
    els.kidsProgress.innerHTML =
      `<div class="hint">${escapeHtml(label)}</div>` +
      lines
        .map((l, i) => {
          const st = statuses[i] || "waiting";
          const icon = st === "done" ? "✓" : st === "failed" ? "✕" : st === "working" ? "…" : "·";
          const preview = l.silent ? `(silent) ${l.action}` : l.text;
          return `<div class="hint">${icon} ${escapeHtml(nameFor(l.charNum))}: ${escapeHtml(preview.slice(0, 60))}</div>`;
        })
        .join("");
  };

  try {
    // 1. Strip any manual [sfx: ...] tags from each line (so they're never
    // spoken by TTS) and resolve a sound effect — manual tag or
    // auto-detected — for each line. Silent beats have no spoken text, so
    // their action description is what gets checked/cleaned instead.
    setStatus("Checking lines for sound effects…");
    const sfxSourceTexts = lines.map((l) => (l.silent ? l.action : l.text));
    const { cleanTexts, sfxDescriptions } = await resolveSfxForScenes(sfxSourceTexts);
    lines.forEach((l, i) => {
      if (l.silent) l.action = cleanTexts[i];
      else l.text = cleanTexts[i];
    });

    // 2. TTS for each spoken line, in each speaker's voice — silent beats
    // have nothing to voice, so they're skipped here entirely.
    renderProgress("Generating dialogue audio…");
    setStatus(`Generating ${lines.filter((l) => !l.silent).length} line(s) of dialogue audio…`);
    let audioError = null;
    const audioUrls = await runWithConcurrency(lines, 2, async (line, i) => {
      if (line.silent) return null;
      statuses[i] = "working";
      renderProgress("Generating dialogue audio…");
      try {
        const url = await generateOneLine(line.text, voiceIds[line.charNum]);
        statuses[i] = "done";
        renderProgress("Generating dialogue audio…");
        return url;
      } catch (err) {
        statuses[i] = "failed";
        renderProgress("Generating dialogue audio…");
        if (!audioError) audioError = `Line ${i + 1} (${nameFor(line.charNum)}) failed: ${err.message}`;
        return null;
      }
    });
    if (audioError || audioUrls.some((u, i) => !u && !lines[i].silent)) {
      throw new Error(audioError || "One or more dialogue lines failed to generate audio.");
    }

    // 3. Write a fresh scene prompt per line — has the speaking character
    // actually act out what the line describes, in a setting matching it
    // (or a fixed one, if given), rather than a generic "stands and talks"
    // pose every time. For a line the script didn't explicitly tag with an
    // expression, this also auto-picks whichever uploaded expression best
    // fits the moment.
    setStatus("Writing each scene…");
    const sceneResults = await runWithConcurrency(lines, 3, async (line, i) => {
      const availableExpressions = line.charNum === "both" ? [] : Object.keys(charImages[line.charNum]).filter((k) => k !== "default");
      return await buildDynamicScenePrompt({
        characterName: nameFor(line.charNum),
        characterDescription: null,
        lineText: line.silent ? line.action : line.text,
        expression: line.expression,
        styleDescription,
        backgroundDescription,
        availableExpressions,
        nonVerbal: line.silent,
        bothScene: line.bothScene,
        fallback: buildDialogueScenePrompt(nameFor(line.charNum), line.expression),
      });
    });
    sceneResults.forEach((result, i) => {
      const line = lines[i];
      if (
        line.charNum !== "both" &&
        !line.explicitExpression &&
        result.matchedExpression &&
        charImages[line.charNum][result.matchedExpression]
      ) {
        line.expression = result.matchedExpression;
      }
    });
    const scenePrompts = sceneResults.map((r) => r.prompt);
    const sceneCameraMotions = sceneResults.map((r) => r.cameraMotion);

    // 4. Animate each character/expression for each line.
    statuses.fill("waiting");
    renderProgress("Animating each scene…");
    setStatus(`Generating ${lines.length} animated scene(s)…`);
    let videoError = null;
    const sceneVideoUrls = await runWithConcurrency(lines, 2, async (line, i) => {
      statuses[i] = "working";
      renderProgress("Animating each scene…");
      try {
        const res = await fetch("/api/generate", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            modelId,
            prompt: scenePrompts[i],
            style: "cartoon",
            styleOverride: styleDescription,
            startImage: imageFor(line.charNum, line.expression, line.bothScene),
            actionMotion,
            cameraMotion: sceneCameraMotions[i],
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
        statuses[i] = "done";
        renderProgress("Animating each scene…");
        return url;
      } catch (err) {
        statuses[i] = "failed";
        renderProgress("Animating each scene…");
        if (!videoError) videoError = `Scene ${i + 1} (${nameFor(line.charNum)}) failed: ${err.message}`;
        return null;
      }
    });
    if (videoError || sceneVideoUrls.some((u) => !u)) throw new Error(videoError || "One or more scenes failed to animate.");

    // 5. Lip-sync each spoken line's scene to its own audio. Silent beats
    // have no audio to sync to, so they just use the raw animated clip as-is
    // (see step 6 for how they still end up with an audio track for stitching).
    statuses.fill("waiting");
    renderProgress("Lip-syncing each scene…");
    setStatus("Lip-syncing each scene to its line…");
    let syncError = null;
    const syncedUrls = await runWithConcurrency(lines.map((_, i) => i), 2, async (i) => {
      if (lines[i].silent) return sceneVideoUrls[i];
      statuses[i] = "working";
      renderProgress("Lip-syncing each scene…");
      try {
        const url = await lipsyncOneScene(sceneVideoUrls[i], audioUrls[i]);
        statuses[i] = "done";
        renderProgress("Lip-syncing each scene…");
        return url;
      } catch (err) {
        statuses[i] = "failed";
        renderProgress("Lip-syncing each scene…");
        if (!syncError) syncError = `Scene ${i + 1} lip sync failed: ${err.message}`;
        return null;
      }
    });
    if (syncError || syncedUrls.some((u) => !u)) {
      throw new Error(
        (syncError || "One or more scenes failed to lip-sync.") +
          " The animated (silent) scenes are still available: " +
          sceneVideoUrls.join(" | ")
      );
    }

    // 6. Generate any sound effects, mix them in, and stitch the final video.
    // Silent beats never got a voice track, so they need mixSfxAndStitch's
    // per-scene audio handling even when no scene has a sound effect.
    const anySilent = lines.some((l) => l.silent);
    let finalUrl;
    if (sfxDescriptions.some(Boolean) || anySilent) {
      const sfxAudioUrls = sfxDescriptions.some(Boolean) ? await generateSfxAudioClips(sfxDescriptions) : lines.map(() => null);
      if (sfxDescriptions.some(Boolean)) setStatus("Generating sound effects…");
      setStatus("Mixing in sound effects and stitching the final video together…");
      finalUrl = await mixSfxAndStitch(syncedUrls, sfxAudioUrls, (p) => setStatus(`Stitching… ${Math.round(p * 100)}%`), {
        baseHasAudio: lines.map((l) => !l.silent),
      });
    } else {
      setStatus("Stitching the final video together…");
      finalUrl = await stitchVideoClips(syncedUrls, (p) => setStatus(`Stitching… ${Math.round(p * 100)}%`), {
        withAudio: true,
      });
    }

    els.kidsProgress.classList.add("hidden");
    upsertHistoryItem({
      id: "cartoon-dialogue-" + Date.now(),
      prompt: script.slice(0, 120),
      label: "Cartoon dialogue video",
      kind: "video",
      status: "succeeded",
      url: finalUrl,
      isBrowserStitched: true,
    });
    setStatus("Done — download it from the gallery before refreshing the page.", "success");
  } catch (err) {
    setStatus(err.message || "Something went wrong.", "error");
  }
}

els.generateBtn.addEventListener("click", async () => {
  els.generateBtn.disabled = true;
  try {
    if (mode === "lipsync") await generateLipsync();
    else if (mode === "kids" && kidsSubMode === "song") await generateKidsSong();
    else if (mode === "kids" && kidsSubMode === "cartoon" && cartoonContentType === "narration") await generateCartoonNarrationVideo();
    else if (mode === "kids" && kidsSubMode === "cartoon" && cartoonContentType === "dialogue") await generateCartoonDialogueVideo();
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
applyCartoonContentTypeUI();
applyDialogueVoiceSourceUI(1);
applyDialogueVoiceSourceUI(2);
applyVideoAudioSourceUI();
renderGallery();
