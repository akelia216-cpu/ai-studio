// Takes an EXISTING video and re-renders it in a new visual style while
// keeping the original motion — e.g. turn a live-action clip into a cartoon,
// or apply a new setting/outfit/style to a person's performance without
// re-shooting it. Nothing else in this app can do this: every other video
// feature here starts from either a text prompt or a single still image
// (fal's image-to-video endpoints) — there was no "take a video, keep its
// motion, change everything else" path before this.
//
// Model: fal-ai/wan-vace-14b (Wan VACE 14B — "Video All-in-one Creation and
// Editing"). Confirmed live via fal's own docs/schema (2026-08): this is NOT
// a dedicated "style transfer" endpoint — fal doesn't have one of those — but
// its `task` parameter includes "depth" and "pose", which are the standard
// ControlNet-style trick for this: the source video is reduced to a motion
// signal (a per-frame depth map, or a per-frame skeletal pose), and the model
// generates an entirely new video guided by that motion signal plus a fresh
// text prompt. That's exactly "restyle this clip, keep the movement" in
// practice, just not labeled that on the tin. depth preserves the fullest
// motion/composition signal (camera moves, background depth, all subjects);
// pose preserves only humanoid skeletal motion, which is more forgiving when
// the new style has a very different look (e.g. photoreal -> cartoon) since
// it isn't also fighting to match depth/silhouette.
//
// Schema fields (from fal's endpoint docs, matching this app's existing
// _fal.js schema-introspection pattern — verified live, not yet exercised
// against a real generation since the fal.ai key on this project had zero
// balance at the time this was added):
//   prompt (string, required), video_url (string, required — the source
//   clip), task (enum: depth|pose|inpainting|outpainting|reframe),
//   negative_prompt, resolution (enum incl. 480p/720p), aspect_ratio (enum
//   incl. auto/16:9/1:1/9:16), seed. num_frames/frames_per_second/
//   guidance_scale/num_inference_steps/sampler are left at fal's defaults —
//   not exposed here to keep the UI in line with every other feature's
//   scope in this app.
//
// (Object segmentation used to be folded into this file as an "action:
// segment" branch to save a serverless-function slot on Vercel's Hobby
// plan; now split back out into api/segment-video.js since the project's
// Vercel plan was upgraded and that constraint no longer applies.)
const { getInputSchema, firstSupportedField, createPrediction } = require("./_fal");

const RESTYLE_MODEL = "fal-ai/wan-vace-14b";

const RESTYLE_TASKS = {
  depth: "depth",
  pose: "pose",
};
const DEFAULT_TASK = "depth";

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST" });
    return;
  }

  const token = process.env.FAL_KEY;
  if (!token) {
    res.status(500).json({ error: "Server is missing FAL_KEY." });
    return;
  }

  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }
  body = body || {};

  const { video, prompt, task, negativePrompt, aspectRatio, resolution, seed } = body;

  if (!video) {
    res.status(400).json({ error: "A source video is required — this restyles an existing clip, it doesn't generate a new one from scratch." });
    return;
  }
  if (!prompt || !prompt.trim()) {
    res.status(400).json({ error: "Describe the new style/look you want (e.g. \"vibrant cartoon illustration style\")." });
    return;
  }

  const chosenTask = RESTYLE_TASKS[task] ? task : DEFAULT_TASK;

  try {
    const schema = await getInputSchema(token, RESTYLE_MODEL);
    const videoField = firstSupportedField(schema, ["video_url", "video"]) || "video_url";
    const promptField = firstSupportedField(schema, ["prompt"]) || "prompt";
    const taskField = firstSupportedField(schema, ["task"]);
    const negField = firstSupportedField(schema, ["negative_prompt"]);
    const ratioField = firstSupportedField(schema, ["aspect_ratio"]);
    const resField = firstSupportedField(schema, ["resolution"]);
    const seedField = firstSupportedField(schema, ["seed"]);

    const input = { [videoField]: video, [promptField]: prompt.trim() };
    if (taskField) input[taskField] = chosenTask;
    if (negField && negativePrompt && negativePrompt.trim()) input[negField] = negativePrompt.trim();
    if (ratioField && aspectRatio) input[ratioField] = aspectRatio;
    if (resField && resolution) input[resField] = resolution;
    if (seedField && seed !== undefined && seed !== null && seed !== "") input[seedField] = Number(seed);

    const { ok, status, data } = await createPrediction(token, RESTYLE_MODEL, input);
    if (!ok) {
      res.status(status).json({ error: data?.detail || "Video restyle request was rejected." });
      return;
    }

    res.status(200).json({ id: data.id, status: data.status, output: data.output || null, usedTask: chosenTask });
  } catch (err) {
    res.status(500).json({ error: err.message || "Unexpected server error." });
  }
};
