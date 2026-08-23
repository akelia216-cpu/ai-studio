// Brush-based inpainting (feature-audit doc item 3) — lets a user paint
// over part of a generated/uploaded image (fix a hand, change a background
// detail, swap an object) instead of regenerating the whole image from
// scratch. Needed real new frontend UI too (a mask-painting canvas, see
// index.html/app.js's inpaint mode) since AI Studio had no brush/mask tool
// before this.
//
// Model: fal-ai/flux-lora/inpainting. Schema confirmed live via fal's own
// docs (2026-08): required image_url (source image), mask_url (a same-size
// image where the area to change is painted, conventionally white-on-black
// or opaque-on-transparent — fal's own docs don't pin down which channel it
// reads, so the frontend's mask canvas paints solid white on a fully
// transparent background, the more common convention across fal's
// inpainting models), and prompt. Not yet live-tested (fal balance was zero
// at the time this was added).
const { getInputSchema, firstSupportedField, createPrediction } = require("./_fal");

const INPAINT_MODEL = "fal-ai/flux-lora/inpainting";

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

  const { image, mask, prompt } = body;
  if (!image || !mask) {
    res.status(400).json({ error: "Both a source image and a painted mask are required." });
    return;
  }
  if (!prompt || !prompt.trim()) {
    res.status(400).json({ error: "Describe what should appear in the painted area." });
    return;
  }

  try {
    const schema = await getInputSchema(token, INPAINT_MODEL);
    const imageField = firstSupportedField(schema, ["image_url", "image"]) || "image_url";
    const maskField = firstSupportedField(schema, ["mask_url", "mask_image_url", "mask"]) || "mask_url";
    const promptField = firstSupportedField(schema, ["prompt"]) || "prompt";
    const strengthField = firstSupportedField(schema, ["strength"]);

    const input = { [imageField]: image, [maskField]: mask, [promptField]: prompt.trim() };
    if (strengthField) input[strengthField] = 0.9;

    const { ok, status, data } = await createPrediction(token, INPAINT_MODEL, input);
    if (!ok) {
      res.status(status).json({ error: data?.detail || "Inpainting request was rejected." });
      return;
    }
    res.status(200).json({ id: data.id, status: data.status, output: data.output || null });
  } catch (err) {
    res.status(500).json({ error: err.message || "Unexpected server error." });
  }
};
