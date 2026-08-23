// Content-aware video-to-audio (feature-audit doc item 8, bonus find): looks
// at the actual video and generates matching sound/ambience, no text
// description required (prompt is just an optional nudge). AI Studio
// already has manual/auto sound-effect detection per scene (see
// detect-sfx.js/sound-effect.js) — this is a stronger drop-in
// alternative/supplement that doesn't need the video's script text at all.
//
// Model: fal-ai/mmaudio-v2. Schema confirmed live via fal's own docs
// (2026-08): required video_url, prompt (prompt can be empty — the video
// itself drives most of the output). Not yet live-tested (fal balance was
// zero at the time this was added).
const { getInputSchema, firstSupportedField, createPrediction } = require("./_fal");

const AMBIENT_MODEL = "fal-ai/mmaudio-v2";

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

  const { video, prompt, negativePrompt, duration, seed } = body;
  if (!video) {
    res.status(400).json({ error: "A source video is required." });
    return;
  }

  try {
    const schema = await getInputSchema(token, AMBIENT_MODEL);
    const videoField = firstSupportedField(schema, ["video_url", "video"]) || "video_url";
    const promptField = firstSupportedField(schema, ["prompt"]) || "prompt";
    const negField = firstSupportedField(schema, ["negative_prompt"]);
    const durationField = firstSupportedField(schema, ["duration"]);
    const seedField = firstSupportedField(schema, ["seed"]);

    const input = { [videoField]: video, [promptField]: (prompt && prompt.trim()) || "" };
    if (negField && negativePrompt && negativePrompt.trim()) input[negField] = negativePrompt.trim();
    if (durationField && duration) input[durationField] = Number(duration);
    if (seedField && seed !== undefined && seed !== null && seed !== "") input[seedField] = Number(seed);

    const { ok, status, data } = await createPrediction(token, AMBIENT_MODEL, input);
    if (!ok) {
      res.status(status).json({ error: data?.detail || "Video-to-audio request was rejected." });
      return;
    }
    res.status(200).json({ id: data.id, status: data.status, output: data.output || null });
  } catch (err) {
    res.status(500).json({ error: err.message || "Unexpected server error." });
  }
};
