const { getInputSchema, firstSupportedField, createPrediction } = require("./_fal");

const SONG_MODEL = "fal-ai/ace-step/prompt-to-audio";

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

  const { lyrics, caption, durationSeconds, vocalLanguage } = body;
  if (!lyrics || !lyrics.trim()) {
    res.status(400).json({ error: "Lyrics are required." });
    return;
  }
  if (!caption || !caption.trim()) {
    res.status(400).json({ error: "A style/mood description is required." });
    return;
  }

  try {
    const schema = await getInputSchema(token, SONG_MODEL);
    const lyricsField = firstSupportedField(schema, ["lyrics"]) || "lyrics";
    const captionField = firstSupportedField(schema, ["caption", "prompt", "tags"]) || "caption";
    const durationField = firstSupportedField(schema, ["duration"]);
    const langField = firstSupportedField(schema, ["vocal_language", "language"]);

    const input = {
      [lyricsField]: lyrics.trim(),
      [captionField]: caption.trim(),
    };
    if (durationField && durationSeconds) input[durationField] = Number(durationSeconds);
    if (langField) input[langField] = vocalLanguage || "en";

    const { ok, status, data } = await createPrediction(token, SONG_MODEL, input);
    if (!ok) {
      res.status(status).json({ error: data?.detail || "Song request was rejected." });
      return;
    }

    res.status(200).json({ id: data.id, status: data.status, output: data.output || null });
  } catch (err) {
    res.status(500).json({ error: err.message || "Unexpected server error." });
  }
};
