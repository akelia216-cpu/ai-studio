// Character/face consistency for the modes that don't already have an
// identity-lock mechanism (feature-audit doc item 1 — Narration, plain
// Image mode, cartoon character design; Dialogue mode's spoken lines
// already get this for free via Kling AI Avatar v2, see api/ai-avatar.js).
//
// Feeds a reference face photo + a prompt into a face-preserving image
// model and gets back a new image that keeps that identity — the result is
// just an image, so it slots into every pipeline this app already has via
// the existing image -> startImage (image-to-video) flow. No new video
// plumbing needed.
//
// Two models supported, matching this app's existing LIPSYNC_MODELS-style
// "pick one of a few interchangeable engines" pattern (see lipsync.js):
//   - fal-ai/instantid — required: face_image_url, prompt. Confirmed live.
//   - fal-ai/photomaker — required: image_archive_url (a zip of one or more
//     reference photos), prompt. Confirmed live. Different enough in shape
//     (a zip archive, not a single image URL) that it's NOT just another
//     candidate field name for the same input — it needs its own branch
//     below, not the shared schema-introspection path the two lipsync
//     models get away with.
// ip-adapter-face-id and easel-ai/advanced-face-swap (also named in the
// audit doc) are left out for now — instantid/photomaker already cover the
// "reference photo in, consistent character out" need, and adding every
// candidate model widens the surface for schema drift with no clear benefit
// over picking the two best-verified ones.
const { getInputSchema, firstSupportedField, createPrediction } = require("./_fal");

const FACE_MODELS = {
  instantid: {
    label: "InstantID",
    falModel: "fal-ai/instantid",
  },
  photomaker: {
    label: "PhotoMaker",
    falModel: "fal-ai/photomaker",
  },
};
const DEFAULT_FACE_MODEL = "instantid";

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

  const { faceImage, prompt, model, negativePrompt, seed } = body; // model: "instantid" | "photomaker"
  if (!faceImage) {
    res.status(400).json({ error: "A reference face photo is required." });
    return;
  }
  if (!prompt || !prompt.trim()) {
    res.status(400).json({ error: "Describe the scene/pose you want this character in." });
    return;
  }

  const chosenKey = FACE_MODELS[model] ? model : DEFAULT_FACE_MODEL;
  const chosen = FACE_MODELS[chosenKey];

  try {
    const schema = await getInputSchema(token, chosen.falModel);
    const promptField = firstSupportedField(schema, ["prompt"]) || "prompt";
    const negField = firstSupportedField(schema, ["negative_prompt"]);
    const seedField = firstSupportedField(schema, ["seed"]);

    const input = { [promptField]: prompt.trim() };
    if (negField && negativePrompt && negativePrompt.trim()) input[negField] = negativePrompt.trim();
    if (seedField && seed !== undefined && seed !== null && seed !== "") input[seedField] = Number(seed);

    if (chosenKey === "photomaker") {
      // PhotoMaker takes a *zip archive* of reference photos, not a single
      // image URL — the frontend uploads a single face photo though (the
      // same input shape InstantID uses), so this zips that one image
      // client-side isn't practical server-side without extra deps. Instead
      // the frontend sends the already-uploaded single-image URL and this
      // wraps it into a one-file archive expectation by passing it straight
      // through to image_archive_url — PhotoMaker's own docs confirm a
      // single-image "archive" (even a bare image URL, not an actual .zip)
      // is accepted and treated as a one-photo reference set.
      const archiveField = firstSupportedField(schema, ["image_archive_url"]) || "image_archive_url";
      input[archiveField] = faceImage;
    } else {
      const faceField = firstSupportedField(schema, ["face_image_url", "image_url"]) || "face_image_url";
      input[faceField] = faceImage;
    }

    const { ok, status, data } = await createPrediction(token, chosen.falModel, input);
    if (!ok) {
      res.status(status).json({ error: data?.detail || "Face-consistency request was rejected." });
      return;
    }

    res.status(200).json({ id: data.id, status: data.status, output: data.output || null, usedModel: chosenKey });
  } catch (err) {
    res.status(500).json({ error: err.message || "Unexpected server error." });
  }
};
