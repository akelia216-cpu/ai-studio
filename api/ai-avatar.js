const { getInputSchema, firstSupportedField, createPrediction } = require("./_fal");

// fal-ai/kling-video/ai-avatar/v2/standard — Kling's "AI Avatar" model. Takes
// a single still reference image + an audio clip and returns the FINISHED
// talking clip in one call: there is no separate "animate the scene, then
// lip-sync it" step the way the rest of this app's video pipeline works.
// This is why Dialogue mode's spoken lines call this endpoint directly
// instead of going through /api/generate + /api/lipsync.
//
// Why this model specifically: it was verified — via a live, isolated test
// call outside the app (a real character portrait + a real TTS clip run
// straight through this endpoint) — to complete cleanly with no "no face
// detected" failure on a non-photorealistic, non-human cartoon-animal face,
// which is the exact failure mode the old two-step pipeline could hit on
// tightly-cropped or heavily stylized character art. That same test showed
// it drives expression/reaction more reliably than full multi-step physical
// staging (e.g. "crouch down and pick something up" came through as an
// object-in-hand + excited reaction, not a literal crouch/reach/grab
// animation) — so callers should keep prompts for this model focused on
// expression and reaction rather than complex staged actions.
//
// Standard tier specifically (not Pro) — confirmed sufficient quality in
// that same test, at roughly half Pro's per-second cost.
//
// Schema (confirmed live): required image_url, audio_url; optional prompt.
// No camera-motion field of any kind exists on this endpoint — callers
// should never attempt to apply CAMERA_PRESETS here.
const AI_AVATAR_MODEL = "fal-ai/kling-video/ai-avatar/v2/standard";

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

  const { image, audio, prompt } = body; // image/audio: data: URI or URL
  if (!image || !audio) {
    res.status(400).json({
      error: "Avatar generation needs both a character reference image and an audio clip.",
    });
    return;
  }

  try {
    const schema = await getInputSchema(token, AI_AVATAR_MODEL);
    const imageField = firstSupportedField(schema, ["image_url", "image"]) || "image_url";
    const audioField = firstSupportedField(schema, ["audio_url", "audio"]) || "audio_url";
    const promptField = firstSupportedField(schema, ["prompt"]) || "prompt";

    const input = { [imageField]: image, [audioField]: audio };
    // Prompt is optional on this model, but every caller in this app has one
    // (the scene-prompt LLM output), so it's sent whenever present.
    if (prompt && prompt.trim()) input[promptField] = prompt.trim();

    const { ok, status, data } = await createPrediction(token, AI_AVATAR_MODEL, input);
    if (!ok) {
      res.status(status).json({ error: data?.detail || "Avatar generation request was rejected." });
      return;
    }

    res.status(200).json({ id: data.id, status: data.status, output: data.output || null });
  } catch (err) {
    res.status(500).json({ error: err.message || "Unexpected server error." });
  }
};
