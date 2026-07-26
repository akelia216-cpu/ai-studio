const { MODELS, CAMERA_PRESETS, ACTION_PRESETS, UGC_IMAGE_EDIT_MODEL, UGC_STYLE_CLAUSES, ASPECT_TO_IMAGE_SIZE } = require("./_models");
const { getInputSchema, firstSupportedField, createPrediction } = require("./_fal");

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Use POST" });
    return;
  }

  const token = process.env.FAL_KEY;
  if (!token) {
    res.status(500).json({
      error:
        "Server is missing FAL_KEY. Set it in your Vercel project's Environment Variables and redeploy.",
    });
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

  const {
    modelId,
    prompt,
    aspectRatio,
    cameraMotion, // key into CAMERA_PRESETS, video only
    actionMotion, // key into ACTION_PRESETS, video only — "make the character dance/jump/etc"
    negativePrompt,
    seed,
    startImage, // data: URI or URL — video: keyframe / image-to-video source
    endImage, // data: URI or URL, video only
    style, // "standard" | "ugc" | "cartoon"
    referenceImage, // data: URI or URL — product/character photo for a styled request
  } = body;

  if (!prompt || !prompt.trim()) {
    res.status(400).json({ error: "Prompt is required." });
    return;
  }

  const model = MODELS[modelId];
  if (!model) {
    res.status(400).json({ error: `Unknown model: ${modelId}` });
    return;
  }

  const hasStyle = style === "ugc" || style === "cartoon";
  const appliedFeatures = {};

  // For a styled image with a reference/product/character photo, switch to
  // an image-editing model that can keep that photo's subject recognizable
  // instead of the plain text-to-image model the user picked.
  let effectiveModel = model.falModel;
  let usingEditModel = false;
  if (hasStyle && model.kind === "image" && referenceImage) {
    effectiveModel = UGC_IMAGE_EDIT_MODEL;
    usingEditModel = true;
  }

  // fal.ai splits some video models into separate text-to-video vs
  // image-to-video endpoints — switch as soon as a source image is given.
  if (!usingEditModel && model.kind === "video" && startImage && model.falModelImageToVideo) {
    effectiveModel = model.falModelImageToVideo;
  }

  const schema = await getInputSchema(token, effectiveModel);
  const candidates = model.candidates || {};

  let finalPrompt = prompt.trim();
  if (hasStyle && UGC_STYLE_CLAUSES[model.kind] && UGC_STYLE_CLAUSES[model.kind][style]) {
    finalPrompt = `${finalPrompt}, ${UGC_STYLE_CLAUSES[model.kind][style]}`;
  }

  const input = usingEditModel ? { prompt: finalPrompt } : { ...model.defaults, prompt: finalPrompt };

  // Aspect ratio — some models take a plain aspect_ratio string, others a
  // named image_size preset (e.g. "square_hd", "landscape_16_9").
  if (aspectRatio) {
    const ratioField = firstSupportedField(schema, candidates.aspectRatio || ["aspect_ratio"]);
    const sizeField = firstSupportedField(schema, candidates.imageSize || ["image_size"]);
    if (ratioField) {
      input[ratioField] = aspectRatio;
    } else if (sizeField && ASPECT_TO_IMAGE_SIZE[aspectRatio]) {
      input[sizeField] = ASPECT_TO_IMAGE_SIZE[aspectRatio];
    }
  }

  // Seed
  if (seed !== undefined && seed !== null && seed !== "") {
    const field = firstSupportedField(schema, candidates.seed || ["seed"]);
    if (field) input[field] = Number(seed);
  }

  // Negative prompt (images)
  if (negativePrompt && negativePrompt.trim() && !usingEditModel) {
    const field = firstSupportedField(schema, candidates.negativePrompt || []);
    if (field) input[field] = negativePrompt.trim();
  }

  // Reference/product photo — for the image-edit model this IS the image
  // being edited; for video models it maps to a subject-reference style
  // field if the chosen model supports one.
  if (referenceImage) {
    if (usingEditModel) {
      const field = firstSupportedField(schema, ["image_url", "input_image", "image"]) || "image_url";
      input[field] = referenceImage;
      appliedFeatures.referenceImage = true;
    } else if (model.kind === "video") {
      const field = firstSupportedField(schema, candidates.referenceImage || []);
      if (field) {
        input[field] = referenceImage;
        appliedFeatures.referenceImage = true;
      } else {
        appliedFeatures.referenceImage = false;
      }
    }
  }

  // Keyframes / image-to-video source (video only)
  if (startImage && model.kind === "video") {
    const field = firstSupportedField(schema, candidates.startImage || []);
    if (field) {
      input[field] = startImage;
      appliedFeatures.startImage = true;
    } else {
      appliedFeatures.startImage = false;
    }
  }
  if (endImage && model.kind === "video") {
    const field = firstSupportedField(schema, candidates.endImage || []);
    if (field) {
      input[field] = endImage;
      appliedFeatures.endImage = true;
    } else {
      appliedFeatures.endImage = false;
    }
  }

  // Camera motion (video only)
  if (model.kind === "video" && cameraMotion && cameraMotion !== "none" && CAMERA_PRESETS[cameraMotion]) {
    const preset = CAMERA_PRESETS[cameraMotion];
    if (model.supportsCameraObject && schema.properties && schema.properties.camera_control) {
      input.camera_control = { type: "simple", config: preset.kling };
      appliedFeatures.cameraMotion = "structured";
    } else if (preset.clause) {
      input.prompt = `${finalPrompt}, ${preset.clause}`;
      finalPrompt = input.prompt;
      appliedFeatures.cameraMotion = "prompt";
    }
  }

  // Action preset — e.g. "make the character dance/jump" (video only). This
  // is always woven into the prompt text since no model here exposes a
  // structured "action" parameter.
  if (model.kind === "video" && actionMotion && actionMotion !== "none" && ACTION_PRESETS[actionMotion]) {
    const preset = ACTION_PRESETS[actionMotion];
    if (preset.clause) {
      input.prompt = `${finalPrompt}, ${preset.clause}`;
      finalPrompt = input.prompt;
      appliedFeatures.actionMotion = true;
    }
  }

  try {
    const { ok, status, data } = await createPrediction(token, effectiveModel, input);

    if (!ok) {
      res.status(status).json({
        error: data?.detail || data?.error || data?.message || "fal.ai rejected the request.",
      });
      return;
    }

    res.status(200).json({
      id: data.id,
      status: data.status,
      output: data.output || null,
      appliedFeatures,
      finalPrompt,
      usedModel: effectiveModel,
    });
  } catch (err) {
    res.status(500).json({ error: err.message || "Unexpected server error." });
  }
};
