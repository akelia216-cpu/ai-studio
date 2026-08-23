// Mood-matched instrumental background music (feature-audit doc item 7):
// plain text-prompted music, no lyrics or genre tags required — unlike this
// app's existing song model (fal-ai/ace-step, see generate-song.js), which
// needs typed lyrics to produce a full song. Fills the gap where you just
// want a plain instrumental score under a video.
//
// Model: fal-ai/stable-audio-25/text-to-audio. Schema confirmed live via
// fal's own docs (2026-08): required prompt; seconds_total controls
// duration (default 190s — clamped here to a much shorter, video-clip-sized
// range). Not yet live-tested (fal balance was zero at the time this was
// added).
const { getInputSchema, firstSupportedField, createPrediction } = require("./_fal");

const MUSIC_MODEL = "fal-ai/stable-audio-25/text-to-audio";

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

  const { prompt, durationSeconds, seed } = body;
  if (!prompt || !prompt.trim()) {
    res.status(400).json({ error: "Describe the mood/style of music you want." });
    return;
  }

  try {
    const schema = await getInputSchema(token, MUSIC_MODEL);
    const promptField = firstSupportedField(schema, ["prompt"]) || "prompt";
    const durationField = firstSupportedField(schema, ["seconds_total", "duration"]);
    const seedField = firstSupportedField(schema, ["seed"]);

    const input = { [promptField]: prompt.trim() };
    if (durationField) input[durationField] = durationSeconds ? Math.max(1, Math.min(190, Number(durationSeconds))) : 30;
    if (seedField && seed !== undefined && seed !== null && seed !== "") input[seedField] = Number(seed);

    const { ok, status, data } = await createPrediction(token, MUSIC_MODEL, input);
    if (!ok) {
      res.status(status).json({ error: data?.detail || "Music generation request was rejected." });
      return;
    }
    res.status(200).json({ id: data.id, status: data.status, output: data.output || null });
  } catch (err) {
    res.status(500).json({ error: err.message || "Unexpected server error." });
  }
};
