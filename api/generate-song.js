const { getInputSchema, firstSupportedField, createPrediction } = require("./_fal");

// IMPORTANT: this must be the base "fal-ai/ace-step" endpoint, NOT
// "fal-ai/ace-step/prompt-to-audio" — that similarly-named variant has no
// "lyrics" field at all. Its only text input is a single "prompt" field
// that the model uses to INVENT its own tags and lyrics from scratch, so
// whatever the user actually typed as lyrics would never reach the model as
// literal sung lyrics — it'd just get silently sent as a bogus "lyrics"
// field this endpoint's schema doesn't define, while the real "prompt"
// field only received the style/caption text. Verified against the live
// schemas for both endpoints (2026-07): "fal-ai/ace-step" is the one with
// real, separate "lyrics" (literal lyrics to sing) and "tags" (comma-
// separated genre tags, required) fields, matching what this file actually
// intends to send.
const SONG_MODEL = "fal-ai/ace-step";

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
    // "tags" first — that's this model's real, required style/genre field
    // (a comma-separated genre list). "caption"/"prompt" are kept as
    // fallbacks only in case a future model swap uses different naming.
    const captionField = firstSupportedField(schema, ["tags", "caption", "prompt"]) || "tags";
    const durationField = firstSupportedField(schema, ["duration"]);
    // fal-ai/ace-step doesn't expose a language field at all — this stays
    // null for this model and the vocalLanguage input is simply unused,
    // same graceful-degradation pattern as every other optional field here.
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
