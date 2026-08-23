// Auto-captioning/transcription (feature-audit doc item 9): word/segment-
// level transcription with optional speaker diarization. AI Studio already
// knows its own TTS script text for narration/dialogue, so this matters
// less for AI-Studio-generated content, but is useful for burned-in
// captions or transcribing audio/video from elsewhere.
//
// Model: fal-ai/whisper. Schema confirmed live via fal's own docs (2026-08):
// required audio_url (also accepts video files per fal's own format list).
// The result is a JSON object ({ text, chunks: [...] }), not a media file —
// see _fal.js's extractOutput, which JSON-stringifies that shape through
// the same generic "output" field every other prediction uses. Not yet
// live-tested (fal balance was zero at the time this was added).
const { getInputSchema, firstSupportedField, createPrediction } = require("./_fal");

const TRANSCRIBE_MODEL = "fal-ai/whisper";

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

  const { audio, diarize } = body;
  if (!audio) {
    res.status(400).json({ error: "An audio (or video) file is required." });
    return;
  }

  try {
    const schema = await getInputSchema(token, TRANSCRIBE_MODEL);
    const audioField = firstSupportedField(schema, ["audio_url", "audio"]) || "audio_url";
    const chunkField = firstSupportedField(schema, ["chunk_level"]);
    const diarizeField = firstSupportedField(schema, ["diarize"]);

    const input = { [audioField]: audio };
    if (chunkField) input[chunkField] = "word";
    if (diarizeField && diarize) input[diarizeField] = true;

    const { ok, status, data } = await createPrediction(token, TRANSCRIBE_MODEL, input);
    if (!ok) {
      res.status(status).json({ error: data?.detail || "Transcription request was rejected." });
      return;
    }
    res.status(200).json({ id: data.id, status: data.status, output: data.output || null });
  } catch (err) {
    res.status(500).json({ error: err.message || "Unexpected server error." });
  }
};
