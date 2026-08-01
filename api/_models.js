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
  // Added 2026-08 — confirmed live via fal's own openapi schema endpoint
  // (fal-ai/flux-2-pro returns a real "Flux2ProInput" schema with
  // image_size/prompt/output_format/seed, same shape as the other Flux
  // entries above, so the existing aspectRatio/imageSize candidates cover
  // it without change). Newest Flux generation available on fal as of this
  // check — Flux 1.1 Pro above is kept as a cheaper/older option, not
  // removed. NOTE: schema-verified only, not yet tested against a real
  // generation — the fal.ai key on this project had zero balance at the
  // time this was added, so image-quality output hasn't been confirmed live.
  "flux-2-pro": {
    label: "Flux 2 Pro (newest)",
    kind: "image",
    falModel: "fal-ai/flux-2-pro",
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
  // Added 2026-08 — Minimax's video line moved on from "video-01" to
  // "Hailuo-02" (standard/pro), confirmed live via fal's openapi schema
  // endpoint. Hailuo-02's image-to-video Input schema uses "image_url" for
  // the source frame (same field name video-01 already used), so the
  // existing candidates list is reused as-is. Schema-verified only — see
  // the flux-2-pro note above re: no live generation test yet possible.
  "minimax-hailuo-02-standard": {
    label: "Minimax Hailuo-02 Standard (newer)",
    kind: "video",
    falModel: "fal-ai/minimax/hailuo-02/standard/text-to-video",
    falModelImageToVideo: "fal-ai/minimax/hailuo-02/standard/image-to-video",
    defaults: { prompt_optimizer: true },
    candidates: {
      startImage: ["image_url", "first_frame_image", "start_image", "image"],
      endImage: ["last_frame_image", "end_image", "tail_image"],
      referenceImage: ["subject_reference"],
      seed: ["seed"],
    },
    supportsCameraObject: false,
  },
  "minimax-hailuo-02-pro": {
    label: "Minimax Hailuo-02 Pro (newer, higher quality)",
    kind: "video",
    falModel: "fal-ai/minimax/hailuo-02/pro/text-to-video",
    falModelImageToVideo: "fal-ai/minimax/hailuo-02/pro/image-to-video",
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
    // Verified against this endpoint's live schema (2026-07): the
    // "v1.6/standard" text-to-video/image-to-video variants used here do NOT
    // expose a "camera_control" field at all (only cfg_scale/prompt/
    // duration/negative_prompt, plus image_url on the i2v one) — that
    // structured control exists on some other Kling variant/version, not
    // this one. Left false so generate.js's schema check (which already
    // gates on `schema.properties.camera_control` existing) doesn't imply
    // structured support this endpoint doesn't have; camera motion for this
    // model always goes through the plain prompt-text clause fallback, which
    // already works correctly on its own.
    supportsCameraObject: false,
  },
  // Added 2026-08 — three Kling generations newer than v1.6 (v2.0 Master,
  // v2.1, v2.5 Turbo skipped as intermediate/lesser options; v2.6 Pro and
  // v3 are the two confirmed-live tiers worth surfacing). Confirmed live via
  // fal's openapi schema endpoint for both the text-to-video and
  // image-to-video variant of each. IMPORTANT verified difference from
  // v1.6: the image-input field on v2.6/v3 is "start_image_url", NOT
  // "image_url" — v1.6's candidates list above doesn't have that entry
  // because v1.6 doesn't use it, so it's listed first here for these three.
  // Neither v2.6 nor v3's Input schema exposes a "camera_control" field
  // either (checked the same way as v1.6 above), so supportsCameraObject
  // stays false and camera motion still goes through the prompt-text clause
  // fallback for these too. v3's schema also exposes "generate_audio" and
  // "elements" (multi-character reference) fields this app doesn't wire up
  // yet — left alone for now, not required for existing functionality.
  // Schema-verified only — see the flux-2-pro note above re: no live
  // generation test yet possible (fal balance was at zero).
  "kling-v2.6-pro": {
    label: "Kling v2.6 Pro (newer)",
    kind: "video",
    falModel: "fal-ai/kling-video/v2.6/pro/text-to-video",
    falModelImageToVideo: "fal-ai/kling-video/v2.6/pro/image-to-video",
    defaults: { duration: "5" },
    candidates: {
      startImage: ["start_image_url", "image_url", "start_image", "first_frame_image", "image"],
      endImage: ["end_image_url", "tail_image_url", "end_image", "tail_image", "last_frame_image"],
      seed: ["seed"],
    },
    supportsCameraObject: false,
  },
  "kling-v3-standard": {
    label: "Kling v3 Standard (newest)",
    kind: "video",
    falModel: "fal-ai/kling-video/v3/standard/text-to-video",
    falModelImageToVideo: "fal-ai/kling-video/v3/standard/image-to-video",
    defaults: { duration: "5" },
    candidates: {
      startImage: ["start_image_url", "image_url", "start_image", "first_frame_image", "image"],
      endImage: ["end_image_url", "tail_image_url", "end_image", "tail_image", "last_frame_image"],
      seed: ["seed"],
    },
    supportsCameraObject: false,
  },
  "kling-v3-pro": {
    label: "Kling v3 Pro (newest, higher quality)",
    kind: "video",
    falModel: "fal-ai/kling-video/v3/pro/text-to-video",
    falModelImageToVideo: "fal-ai/kling-video/v3/pro/image-to-video",
    defaults: { duration: "5" },
    candidates: {
      startImage: ["start_image_url", "image_url", "start_image", "first_frame_image", "image"],
      endImage: ["end_image_url", "tail_image_url", "end_image", "tail_image", "last_frame_image"],
      seed: ["seed"],
    },
    supportsCameraObject: false,
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
