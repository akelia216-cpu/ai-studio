const { getInputSchema, firstSupportedField, resolveNestedProperty } = require("./_fal");

// Kept in sync with tts.js — see that file's comment for why this was
// bumped from "speech-02-hd" to "speech-2.8-hd" (confirmed live: same voice
// roster via voice_id's "examples" list, so this file's existing
// enum-or-examples fallback logic below picks it up with no other changes
// needed).
const TTS_MODEL = "fal-ai/minimax/speech-2.8-hd";

// Heuristic split of the model's own voice catalog into "kid-sounding" vs
// "adult-sounding" buckets, based on naming patterns Minimax uses in its
// voice IDs (e.g. "Decent_Boy", "Lively_Girl", "Sweet_Girl_2").
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

    // Try a flat top-level field first (some models expose voice_id/voice
    // directly); if that's not there, this model (Minimax's speech-02-hd)
    // actually nests it inside a "voice_setting" object — check every
    // object-typed top-level property for a voice_id/voice field before
    // giving up. This matches how api/tts.js already builds its request
    // (verified against the same live schema — see that file's comment).
    let field = firstSupportedField(schema, ["voice_id", "voice"]);
    let fieldSchema = field ? schema.properties[field] : null;
    let nestedUnder = null;

    if (!field) {
      for (const propName of Object.keys(schema.properties || {})) {
        const nested = resolveNestedProperty(schema, propName);
        if (!nested) continue;
        const nestedField = firstSupportedField(nested, ["voice_id", "voice"]);
        if (nestedField) {
          field = nestedField;
          fieldSchema = nested.properties[nestedField];
          nestedUnder = propName;
          break;
        }
      }
    }

    // fal doesn't always publish a strict "enum" for a field like this —
    // Minimax documents it via "examples" instead, which is a real (if not
    // guaranteed-exhaustive) list of valid voice IDs straight from their own
    // schema, not a guess on our part.
    const values = fieldSchema && Array.isArray(fieldSchema.enum)
      ? fieldSchema.enum
      : fieldSchema && Array.isArray(fieldSchema.examples)
      ? fieldSchema.examples
      : null;

    if (!field || !values || values.length === 0) {
      res.status(200).json({
        available: false,
        voiceField: nestedUnder ? `${nestedUnder}.${field}` : field || null,
        note: "This model didn't publish a fixed voice list — enter a voice ID manually (check the model's page on fal.ai for valid names).",
      });
      return;
    }

    const kid = values.filter((v) => KID_PATTERN.test(v));
    const adult = values.filter((v) => !KID_PATTERN.test(v));

    res.status(200).json({
      available: true,
      voiceField: nestedUnder ? `${nestedUnder}.${field}` : field,
      kid,
      adult,
      // Only true when the list came from an "examples" hint rather than a
      // strict enum — i.e. fal doesn't guarantee this is every valid voice
      // ID, just the documented ones. The UI can use this to hint that a
      // manually-typed voice ID is still worth trying beyond this list.
      isExampleList: !Array.isArray(fieldSchema.enum),
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "Unexpected server error." });
  }
};
