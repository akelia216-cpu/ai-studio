// Generates a short sound-effect audio clip from a text description (e.g.
// "a rock hitting a wooden fence") — used to add action sounds (throws,
// crashes, footsteps, splashes, etc.) into generated video scenes.
//
// Verified against fal's own docs for fal-ai/elevenlabs/sound-effects/v2:
// POST body takes { text, duration_seconds } — duration_seconds is optional,
// a float from 0.5 to 22 seconds (fal auto-picks a duration if omitted).
// Output comes back as { audio: { url } }. The non-"/v2" endpoint is
// deprecated, so this always targets /v2.
const { getInputSchema, firstSupportedField, createPrediction } = require("./_fal");

const SFX_MODEL = "fal-ai/elevenlabs/sound-effects/v2";

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

  const { text, durationSeconds } = body;
  if (!text || !text.trim()) {
    res.status(400).json({ error: "text is required — describe the sound effect." });
    return;
  }

  try {
    const schema = await getInputSchema(token, SFX_MODEL);
    const textField = firstSupportedField(schema, ["text"]) || "text";
    const durationField = firstSupportedField(schema, ["duration_seconds"]);

    const input = { [textField]: text.trim() };
    if (durationField && durationSeconds) {
      // fal's schema allows 0.5-22s — clamp defensively so a bad value from
      // the client can't get rejected outright.
      input[durationField] = Math.min(22, Math.max(0.5, Number(durationSeconds)));
    }

    const { ok, status, data } = await createPrediction(token, SFX_MODEL, input);
    if (!ok) {
      res.status(status).json({ error: data?.detail || "Sound effect request was rejected." });
      return;
    }

    res.status(200).json({ id: data.id, status: data.status, output: data.output || null });
  } catch (err) {
    res.status(500).json({ error: err.message || "Unexpected server error." });
  }
};
