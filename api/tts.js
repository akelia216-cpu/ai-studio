const { getInputSchema, firstSupportedField, createPrediction } = require("./_fal");

// Bumped 2026-08 from "speech-02-hd" — confirmed live via fal's openapi
// schema endpoint that "speech-2.8-hd" exists and, critically, its
// voice_id field's examples list still includes every voice this app uses
// by name (Decent_Boy, Patient_Man, Wise_Woman, etc. — the full roster is
// unchanged), so this is a safe drop-in upgrade that doesn't require
// touching voices.js's voice list or any saved character voice selection.
// Schema-verified only, not yet tested against a real generation — the
// fal.ai key on this project had zero balance at the time this was changed.
const TTS_MODEL = "fal-ai/minimax/speech-2.8-hd";

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
    // Verified against fal's own docs: this model's voice selector is NOT a
    // flat "voice_id" field — it's nested under "voice_setting.voice_id".
    // fal also doesn't publish an enum of valid voice IDs for this field,
    // which is why /api/voices can't offer a dropdown; the user types one in.
    const hasVoiceSetting = !!(schema.properties && Object.prototype.hasOwnProperty.call(schema.properties, "voice_setting"));
    const flatVoiceField = firstSupportedField(schema, ["voice_id", "voice"]);
    // fal defaults to hex-encoded audio bytes (no playable URL) unless asked
    // for one explicitly — without this, the app would have nothing to point
    // an <audio>/<video> tag at even on a fully successful generation.
    const outputFormatField = firstSupportedField(schema, ["output_format"]);

    const input = { [textField]: text.trim() };
    if (outputFormatField) input[outputFormatField] = "url";
    if (voiceId) {
      if (hasVoiceSetting || (!flatVoiceField && schema.unavailable)) {
        input.voice_setting = { voice_id: voiceId };
      } else if (flatVoiceField) {
        input[flatVoiceField] = voiceId;
      } else {
        input.voice_setting = { voice_id: voiceId };
      }
    }

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
