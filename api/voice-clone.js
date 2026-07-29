// Clones a voice from a short audio sample so it can be reused as a custom
// voice for TTS lines — used by the Cartoon Dialogue Video feature to give
// each character their own voice.
//
// Verified against fal's own API docs (fal-ai/minimax/voice-clone):
// POST body needs { audio_url } (the sample must be at least 10 seconds).
// The result comes back as { custom_voice_id }, a string id that can be
// passed straight into fal-ai/minimax/speech-02-hd's voice_setting.voice_id
// field (api/tts.js already does this for any voiceId string it's given —
// MiniMax's own docs confirm cloned voice ids work the same way as their
// preset voice ids in that field).
const { getInputSchema, firstSupportedField, createPrediction } = require("./_fal");

const VOICE_CLONE_MODEL = "fal-ai/minimax/voice-clone";

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

  const { audioUrl } = body;
  if (!audioUrl) {
    res.status(400).json({ error: "audioUrl is required — upload a sample clip first." });
    return;
  }

  try {
    const schema = await getInputSchema(token, VOICE_CLONE_MODEL);
    const audioField = firstSupportedField(schema, ["audio_url"]) || "audio_url";
    const input = { [audioField]: audioUrl };

    const { ok, status, data } = await createPrediction(token, VOICE_CLONE_MODEL, input);
    if (!ok) {
      res.status(status).json({ error: data?.detail || "Voice cloning request was rejected." });
      return;
    }

    res.status(200).json({ id: data.id, status: data.status, output: data.output || null });
  } catch (err) {
    res.status(500).json({ error: err.message || "Unexpected server error." });
  }
};
