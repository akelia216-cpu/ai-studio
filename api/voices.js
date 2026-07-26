const { getInputSchema, firstSupportedField } = require("./_fal");

const TTS_MODEL = "fal-ai/minimax/speech-02-hd";

// Heuristic split of the model's own voice catalog into "kid-sounding" vs
// "adult-sounding" buckets, based on naming patterns Minimax uses in its
// voice IDs (e.g. "English_Strong-WilledBoy", "Korean_CheerfulLittleSister").
// We never hardcode the actual voice IDs — they come live from the model's
// schema, so this keeps working if Minimax adds/renames voices later.
const KID_PATTERN = /boy|girl|kid|child|teen|little|baby|junior/i;

module.exports = async function handler(req, res) {
  const token = process.env.FAL_KEY;
  if (!token) {
    res.status(500).json({ error: "Server is missing FAL_KEY." });
    return;
  }

  try {
    const schema = await getInputSchema(token, TTS_MODEL);
    const field = firstSupportedField(schema, ["voice_id", "voice"]);

    if (!field || !schema.properties[field] || !Array.isArray(schema.properties[field].enum)) {
      res.status(200).json({
        available: false,
        voiceField: field || null,
        note: "This model didn't publish a fixed voice list — enter a voice ID manually (check the model's page on fal.ai for valid names).",
      });
      return;
    }

    const all = schema.properties[field].enum;
    const kid = all.filter((v) => KID_PATTERN.test(v));
    const adult = all.filter((v) => !KID_PATTERN.test(v));

    res.status(200).json({ available: true, voiceField: field, kid, adult });
  } catch (err) {
    res.status(500).json({ error: err.message || "Unexpected server error." });
  }
};
