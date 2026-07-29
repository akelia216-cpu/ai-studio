const { getInputSchema, firstSupportedField, createPrediction } = require("./_fal");

// Two lip-sync models are supported. Both happen to use the exact same
// field names (video_url / audio_url) — confirmed by fetching each one's
// live fal.ai schema directly (2026-07) rather than guessing — so no extra
// per-model field-mapping logic is needed below; the existing
// schema-introspection helpers already handle whichever *optional* fields
// each one supports on its own (e.g. LatentSync's guidance_scale/
// inference_steps, which Kling's schema simply doesn't declare at all).
//
// fal-ai/kling-video/lipsync/audio-to-video (verified schema):
//   required: video_url, audio_url — no other fields.
//   Source video: .mp4/.mov, <=100MB, 2-10s long, 720p or 1080p only,
//   width/height 720-1920px. Source audio: 2-60s long, <=5MB.
//   This is a real constraint worth knowing: a scene clip outside that
//   duration/resolution/size range will get rejected by fal itself, not by
//   a bug in this file.
const LIPSYNC_MODELS = {
  kling: {
    label: "Kling native lip-sync",
    falModel: "fal-ai/kling-video/lipsync/audio-to-video",
  },
  latentsync: {
    label: "LatentSync (original)",
    falModel: "fal-ai/latentsync",
  },
};
const DEFAULT_LIPSYNC_MODEL = "kling";

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

  const { video, audio, model } = body; // model: "kling" | "latentsync", optional
  if (!video || !audio) {
    res.status(400).json({
      error: "Lip sync needs both a source video (a person talking/moving on camera) and an audio clip.",
    });
    return;
  }

  const chosenKey = LIPSYNC_MODELS[model] ? model : DEFAULT_LIPSYNC_MODEL;
  const chosen = LIPSYNC_MODELS[chosenKey];

  try {
    const schema = await getInputSchema(token, chosen.falModel);
    // fal's convention for file/URL inputs is almost always a "_url" suffixed
    // field name — try that first, falling back to the bare name.
    const videoField = firstSupportedField(schema, ["video_url", "video"]) || "video_url";
    const audioField = firstSupportedField(schema, ["audio_url", "audio"]) || "audio_url";
    const guidanceField = firstSupportedField(schema, ["guidance_scale"]);
    const stepsField = firstSupportedField(schema, ["inference_steps"]);

    const input = { [videoField]: video, [audioField]: audio };
    if (guidanceField) input[guidanceField] = 2.0;
    if (stepsField) input[stepsField] = 20;

    const { ok, status, data } = await createPrediction(token, chosen.falModel, input);
    if (!ok) {
      res.status(status).json({ error: data?.detail || "Lip sync request was rejected." });
      return;
    }

    res.status(200).json({ id: data.id, status: data.status, output: data.output || null, usedModel: chosenKey });
  } catch (err) {
    res.status(500).json({ error: err.message || "Unexpected server error." });
  }
};
