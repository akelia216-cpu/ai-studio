const { MODELS, CAMERA_PRESETS, ACTION_PRESETS, UGC_IMAGE_EDIT_MODEL, UGC_IMAGE_EDIT_MULTI_MODEL, UGC_STYLE_CLAUSES, ASPECT_TO_IMAGE_SIZE, pickClosestRatio } = require("./_models");
const { getInputSchema, firstSupportedField, enumValuesForField, createPrediction } = require("./_fal");

// (Brush-based inpainting used to be folded into this file as an "action:
// inpaint" branch to save a serverless-function slot on Vercel's Hobby
// plan; now split back out into api/inpaint.js since the project's Vercel
// plan was upgraded and that constraint no longer applies.)

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
    styleOverride, // optional custom style clause — replaces the built-in "cartoon" style text when given
    referenceImages, // array of data: URIs/URLs — product/character reference photos for a styled request (up to 4)
    referenceImage, // legacy singular form, still accepted — treated as a one-item referenceImages array
  } = body;

  // Support both the current plural field and the older singular one so
  // nothing calling this with the old shape breaks. Callers can supply
  // multiple reference photos now (e.g. a character from two angles, or a
  // product plus a person) — see refImages usage below for what each
  // destination model does with more than one.
  const refImages = (Array.isArray(referenceImages) ? referenceImages : referenceImage ? [referenceImage] : []).filter(Boolean).slice(0, 4);

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

  // For a styled image with one or more reference/product/character photos,
  // switch to an image-editing model that can keep those photos' subject(s)
  // recognizable instead of the plain text-to-image model the user picked.
  //
  // A model that ships its own editing endpoint uses that one, so picking a
  // model in the dropdown actually means something even when reference photos
  // are attached. Only models without one fall back to the flux/kontext pair
  // below. This matters beyond tidiness: BFL's moderation layer on the
  // kontext models hard-blocks photorealistic prompts describing a real
  // person and silently returns a solid black image, so always rerouting to
  // kontext made those requests fail no matter which model was selected.
  //
  // Among the kontext fallbacks, more than one reference photo needs a
  // genuinely different endpoint rather than an extra field on the same one
  // (fal-ai/flux-pro/kontext takes a single image_url; its /multi sibling
  // takes an image_urls array) — see _models.js's comment on
  // UGC_IMAGE_EDIT_MULTI_MODEL.
  let effectiveModel = model.falModel;
  let usingEditModel = false;
  if (hasStyle && model.kind === "image" && refImages.length > 0) {
    effectiveModel = model.falModelEdit || (refImages.length > 1 ? UGC_IMAGE_EDIT_MULTI_MODEL : UGC_IMAGE_EDIT_MODEL);
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
  if (hasStyle) {
    // A custom style description (e.g. matching a specific character's own
    // art style) always wins over the built-in style clause when given.
    const clause = (styleOverride && styleOverride.trim()) || (UGC_STYLE_CLAUSES[model.kind] && UGC_STYLE_CLAUSES[model.kind][style]);
    if (clause) finalPrompt = `${finalPrompt}, ${clause}`;
  }

  const input = usingEditModel ? { prompt: finalPrompt } : { ...model.defaults, prompt: finalPrompt };

  // The flux-pro/kontext family defaults to safety_tolerance: 2 on fal's
  // 1(strictest)-5(most permissive) scale when the field is left unset, so
  // this raises it to the top of that documented range whenever the chosen
  // edit endpoint exposes the field at all (Seedream's, for one, doesn't —
  // hence the schema check rather than setting it unconditionally).
  //
  // Worth being clear about what this does and doesn't buy: it was tried
  // first as the fix for a UGC-style request that came back "succeeded" with
  // a solid black image, and it did NOT resolve it. BFL runs a separate,
  // non-bypassable moderation pass on photorealistic prompts describing a
  // real person, and safety_tolerance has no effect on that one. The actual
  // fix for that case is the edit-endpoint routing above (staying on the
  // user's selected model, off BFL entirely); this stays because a more
  // permissive setting is still the right default for the kontext path.
  if (usingEditModel) {
    const safetyField = firstSupportedField(schema, ["safety_tolerance"]);
    if (safetyField) input[safetyField] = 5;
  }

  // Aspect ratio — some models take a plain aspect_ratio string, others a
  // named image_size preset (e.g. "square_hd", "landscape_16_9").
  if (aspectRatio) {
    const ratioField = firstSupportedField(schema, candidates.aspectRatio || ["aspect_ratio"]);
    const sizeField = firstSupportedField(schema, candidates.imageSize || ["image_size"]);
    if (ratioField) {
      // Having the field doesn't mean accepting every value for it — most of
      // these models declare a fixed enum, and they differ. Send the closest
      // ratio the model actually allows rather than the raw request, which
      // 422s on any model whose list is missing it (Flux 2 Pro has no 4:5).
      const allowed = enumValuesForField(schema, ratioField);
      const resolved = pickClosestRatio(aspectRatio, allowed);
      if (resolved) {
        input[ratioField] = resolved;
        if (resolved !== aspectRatio) appliedFeatures.aspectRatioSubstituted = { requested: aspectRatio, used: resolved };
      }
    } else if (sizeField) {
      const allowed = enumValuesForField(schema, sizeField);
      const named = ASPECT_TO_IMAGE_SIZE[aspectRatio];
      // Same idea for the named-size field: only send a preset the model
      // lists (when it lists any at all).
      if (named && (!allowed || allowed.includes(named))) input[sizeField] = named;
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

  // Reference/product photo(s) — for the image-edit model these ARE the
  // image(s) being edited; for video models the first one maps to a
  // subject-reference/identity field if the chosen model supports one.
  //
  // Kling v3's `elements` identity-binding gets first shot at it (feature-
  // audit doc item 11): it's a stronger identity-lock mechanism than the
  // plain subject_reference field other models fall back to below, and it's
  // image-to-video only (confirmed live via fal's docs), so it only applies
  // once effectiveModel has already switched to falModelImageToVideo (i.e.
  // startImage was also supplied). The model itself decides whether to
  // actually inject the identity based on the prompt referencing
  // "@Element1" — fal's docs confirm that's how the binding is invoked — so
  // this appends that reference to the prompt when the user hasn't already
  // written it in themselves. Elements is the one destination that actually
  // uses more than the first reference photo: fal's docs confirm up to 3
  // extra angle shots go in `reference_image_urls` alongside the main
  // `frontal_image_url`.
  if (refImages.length > 0) {
    if (usingEditModel) {
      // Which shape the photos go in is decided by the endpoint's own schema
      // rather than by which endpoint it is — some edit models take an
      // image_urls array even for a single photo (Seedream v4), others take a
      // single image_url (flux-pro/kontext). Asking the schema keeps this
      // working as more edit endpoints get added to the registry.
      const arrayField = firstSupportedField(schema, ["image_urls"]);
      if (arrayField) {
        input[arrayField] = refImages;
      } else {
        const field = firstSupportedField(schema, ["image_url", "input_image", "image"]) || "image_url";
        input[field] = refImages[0];
      }
      appliedFeatures.referenceImage = true;
    } else if (model.kind === "video" && model.supportsElements && effectiveModel === model.falModelImageToVideo && schema.properties && schema.properties.elements) {
      const element = { frontal_image_url: refImages[0] };
      if (refImages.length > 1) element.reference_image_urls = refImages.slice(1, 4);
      input.elements = [element];
      if (!/@Element1\b/.test(finalPrompt)) {
        finalPrompt = `${finalPrompt}, featuring @Element1`;
        input.prompt = finalPrompt;
      }
      appliedFeatures.identityElement = true;
    } else if (model.kind === "video") {
      // Every other video model here only has a single subject-reference
      // field (no fal endpoint in this app's registry takes a *list* of
      // reference photos outside of Kling's elements above), so only the
      // first photo is used — the rest are silently unused rather than
      // erroring, same as any other "model doesn't support this" case.
      const field = firstSupportedField(schema, candidates.referenceImage || []);
      if (field) {
        input[field] = refImages[0];
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
