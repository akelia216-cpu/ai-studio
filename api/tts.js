const { getInputSchema, firstSupportedField, createPrediction } = require("./_fal");

const TTS_MODEL = "fal-ai/minimax/speech-02-hd";

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

  const { text, voiceId } = body;
  if (!text || !text.trim()) {
    res.status(400).json({ error: "Text is required." });
    return;
  }

  try {
    const schema = await getInputSchema(token, TTS_MODEL);
    const textField = firstSupportedField(schema, ["text"]) || "text";
    const voiceField = firstSupportedField(schema, ["voice_id", "voice"]);

    const input = { [textField]: text.trim() };
    if (voiceField && voiceId) input[voiceField] = voiceId;

    const { ok, status, data } = await createPrediction(token, TTS_MODEL, input);
    if (!ok) {
      res.status(status).json({ error: data?.detail || "Text-to-speech request was rejected." });
      return;
    }

    res.status(200).json({ id: data.id, status: data.status, output: data.output || null });
  } catch (err) {
    res.status(500).json({ error: err.message || "Unexpected server error." });
  }
};
