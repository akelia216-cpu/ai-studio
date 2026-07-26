// Central registry of fal.ai models this app drives. `candidates` lists
// possible schema field names for each logical feature — the backend
// checks each model's *live* schema (see _fal.js) and only sends a
// field if the model actually declares it, so this list can be a superset
// without risking a rejected request.
//
// fal.ai splits some video models into separate text-to-video vs
// image-to-video endpoints (unlike Replicate, which used one endpoint with
// an optional image field) — `falModelImageToVideo`, when present, is used
// instead of `falModel` whenever a start/source image is supplied.

const MODELS = {
  // ---- Images ----
  "flux-schnell": {
    label: "Flux Schnell (fast)",
    kind: "image",
    falModel: "fal-ai/flux/schnell",
    defaults: { num_images: 1 },
    candidates: {
      aspectRatio: ["aspect_ratio"],
      imageSize: ["image_size"],
      seed: ["seed"],
      negativePrompt: ["negative_prompt"],
    },
  },
  "flux-1.1-pro": {
    label: "Flux 1.1 Pro (high quality)",
    kind: "image",
    falModel: "fal-ai/flux-pro/v1.1",
    defaults: {},
    candidates: {
      aspectRatio: ["aspect_ratio"],
      imageSize: ["image_size"],
      seed: ["seed"],
      negativePrompt: ["negative_prompt"],
    },
  },
  sdxl: {
    label: "Stable Diffusion XL",
    kind: "image",
    falModel: "fal-ai/fast-sdxl",
    defaults: {},
    candidates: {
      aspectRatio: ["aspect_ratio"],
      imageSize: ["image_size"],
      seed: ["seed"],
      negativePrompt: ["negative_prompt"],
    },
  },

  // ---- Video ----
  "minimax-video-01": {
    label: "Minimax Video-01",
    kind: "video",
    falModel: "fal-ai/minimax/video-01",
    falModelImageToVideo: "fal-ai/minimax/video-01/image-to-video",
    defaults: { prompt_optimizer: true },
    candidates: {
      startImage: ["image_url", "first_frame_image", "start_image", "image"],
      endImage: ["last_frame_image", "end_image", "tail_image"],
      referenceImage: ["subject_reference"],
      seed: ["seed"],
    },
    supportsCameraObject: false,
  },
  "kling-v1.6-standard": {
    label: "Kling v1.6 Standard",
    kind: "video",
    falModel: "fal-ai/kling-video/v1.6/standard/text-to-video",
    falModelImageToVideo: "fal-ai/kling-video/v1.6/standard/image-to-video",
    defaults: { duration: "5" },
    candidates: {
      aspectRatio: ["aspect_ratio"],
      startImage: ["image_url", "start_image", "first_frame_image", "image"],
      endImage: ["tail_image_url", "end_image", "tail_image", "last_frame_image"],
      referenceImage: ["subject_reference", "character_reference"],
      seed: ["seed"],
    },
    supportsCameraObject: true, // Kling's camera_control {type, config} shape
  },
  "luma-ray-flash-2": {
    label: "Luma Ray Flash 2",
    kind: "video",
    falModel: "fal-ai/luma-dream-machine/ray-2-flash",
    falModelImageToVideo: "fal-ai/luma-dream-machine/ray-2-flash/image-to-video",
    defaults: { loop: false },
    candidates: {
      aspectRatio: ["aspect_ratio"],
      startImage: ["image_url", "start_image_url", "start_image", "image"],
      endImage: ["end_image_url", "end_image"],
      referenceImage: ["subject_reference", "character_reference"],
      seed: ["seed"],
    },
    supportsCameraObject: false,
  },
};

// Preset -> fal.ai `image_size` enum, used for models whose schema exposes
// image_size (a named preset) instead of a plain aspect_ratio string.
const ASPECT_TO_IMAGE_SIZE = {
  "1:1": "square_hd",
  "16:9": "landscape_16_9",
  "9:16": "portrait_16_9",
};

// Model used to edit/compose an existing image (e.g. a product photo, or a
// cartoon character's reference image) into a new scene, keeping its
// subject recognizable — used whenever a styled request supplies a
// reference photo.
const UGC_IMAGE_EDIT_MODEL = "fal-ai/flux-pro/kontext";

// Appended to the user's prompt for each named style, to push the output
// toward that look rather than a generic AI-generated one.
const UGC_STYLE_CLAUSES = {
  image: {
    ugc: "authentic user-generated-content style photo, shot on a smartphone camera, natural imperfect lighting, candid unposed framing, realistic skin texture, no studio lighting, no text overlays",
    cartoon:
      "vibrant kids-cartoon illustration, bold clean black outlines, bright flat saturated colors, simple friendly shapes, big expressive eyes, cel-shaded coloring, children's animated show character design, no text",
  },
  video: {
    ugc: "authentic user-generated-content style video, shot on a smartphone camera, handheld natural camera movement, natural lighting, candid unscripted feel, realistic and unpolished",
    cartoon:
      "vibrant kids-cartoon animation, bold clean outlines, bright flat saturated colors, cel-shaded look, smooth bouncy expressive motion, children's animated show style",
  },
};

// Kid-friendly action presets — appended to a video prompt so a character
// (cartoon or otherwise) performs a recognizable, energetic action. There's
// no dedicated "make it dance" API parameter on any of these models; this is
// purely prompt text, which text/image-conditioned video models do respond
// to reasonably well.
const ACTION_PRESETS = {
  none: { label: "None / let the scene decide", clause: null },
  dance: { label: "Dancing", clause: "dancing energetically with big joyful bouncy movements" },
  jump: { label: "Jumping", clause: "jumping up and down excitedly with a big happy smile" },
  wave: { label: "Waving", clause: "waving cheerfully at the camera with both arms" },
  spin: { label: "Spinning/twirling", clause: "spinning and twirling around playfully" },
  clap: { label: "Clapping", clause: "clapping along to the beat with a big smile" },
  sing: { label: "Singing", clause: "singing joyfully with animated, exaggerated mouth movement" },
  bounce: { label: "Bouncing", clause: "bouncing up and down in place to the rhythm" },
  run: { label: "Running in place", clause: "running and marching in place energetically" },
};

// Camera motion presets shown in the UI. Each maps to either a Kling-style
// camera_control config (used when the chosen model supports it) or a
// plain-English clause appended to the prompt (used for every other model —
// text-conditioned video models generally respond to this reasonably well).
const CAMERA_PRESETS = {
  none: { label: "None", clause: null, kling: null },
  "zoom-in": { label: "Zoom in", clause: "slow cinematic zoom in", kling: { zoom: -5 } },
  "zoom-out": { label: "Zoom out", clause: "slow cinematic zoom out", kling: { zoom: 5 } },
  "pan-left": { label: "Pan left", clause: "camera pans left", kling: { horizontal_movement: -5 } },
  "pan-right": { label: "Pan right", clause: "camera pans right", kling: { horizontal_movement: 5 } },
  "orbit-left": { label: "Orbit left", clause: "camera orbits left around the subject", kling: { tilt: -5 } },
  "orbit-right": { label: "Orbit right", clause: "camera orbits right around the subject", kling: { tilt: 5 } },
  "tilt-up": { label: "Tilt up", clause: "camera tilts upward", kling: { pan: 5 } },
  "tilt-down": { label: "Tilt down", clause: "camera tilts downward", kling: { pan: -5 } },
  "dolly-in": { label: "Dolly in", clause: "camera dollies in, moving closer to the subject", kling: { vertical_movement: 5 } },
  "dolly-out": { label: "Dolly out", clause: "camera dollies out, moving away from the subject", kling: { vertical_movement: -5 } },
};

module.exports = {
  MODELS,
  CAMERA_PRESETS,
  ACTION_PRESETS,
  UGC_IMAGE_EDIT_MODEL,
  UGC_STYLE_CLAUSES,
  ASPECT_TO_IMAGE_SIZE,
};
