const { getInputSchema, firstSupportedField, createPrediction } = require("./_fal");

const LIPSYNC_MODEL = "fal-ai/latentsync";

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

  const { video, audio } = body;
  if (!video || !audio) {
    res.status(400).json({
      error: "Lip sync needs both a source video (a person talking/moving on camera) and an audio clip.",
    });
    return;
  }

  try {
    const schema = await getInputSchema(token, LIPSYNC_MODEL);
    // Verified against fal's own docs (fal.ai/models/fal-ai/latentsync/api):
    // required fields are "video_url" and "audio_url" (both strings — fal
    // accepts base64 data URIs directly here, no separate upload step
    // needed). Optional: "guidance_scale" (float, default 1) and
    // "seed" (int). We prefer the "_url" names and only fall back to the
    // bare names if a future schema change actually removes them.
    const videoField = firstSupportedField(schema, ["video_url", "video"]) || "video_url";
    const audioField = firstSupportedField(schema, ["audio_url", "audio"]) || "audio_url";
    const guidanceField = firstSupportedField(schema, ["guidance_scale"]);
    const stepsField = firstSupportedField(schema, ["inference_steps"]);

    const input = { [videoField]: video, [audioField]: audio };
    if (guidanceField) input[guidanceField] = 2.0;
    if (stepsField) input[stepsField] = 20;

    const { ok, status, data } = await createPrediction(token, LIPSYNC_MODEL, input);
    if (!ok) {
      res.status(status).json({ error: data?.detail || "Lip sync request was rejected." });
      return;
    }

    res.status(200).json({ id: data.id, status: data.status, output: data.output || null });
  } catch (err) {
    res.status(500).json({ error: err.message || "Unexpected server error." });
  }
};
