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
    const videoField = firstSupportedField(schema, ["video"]) || "video";
    const audioField = firstSupportedField(schema, ["audio"]) || "audio";
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
