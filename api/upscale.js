const { getInputSchema, firstSupportedField, createPrediction } = require("./_fal");

const UPSCALERS = {
  image: {
    falModel: "fal-ai/esrgan",
    // Verified against fal's own docs (fal.ai/models/fal-ai/esrgan/api):
    // required field is "image_url" (a string URL); optional fields include
    // "scale" (float, default 2), "tile", "face" (bool), "model", and
    // "output_format". No guessing here — this is the documented schema.
    build(schema) {
      const imageField = firstSupportedField(schema, ["image_url", "image"]) || "image_url";
      const scaleField = firstSupportedField(schema, ["scale"]);
      const faceField = firstSupportedField(schema, ["face"]);
      return (url) => {
        const input = { [imageField]: url };
        if (scaleField) input[scaleField] = 2;
        if (faceField) input[faceField] = false;
        return input;
      };
    },
  },
  video: {
    falModel: "fal-ai/topaz/upscale/video",
    // Verified against fal's live schema (2026-07): this model has no
    // resolution-string field at all — its only scale control is
    // "upscale_factor", a NUMBER from 1-4 (a multiplier: 2 doubles
    // width/height), not a "1080p"-style string. The two were previously
    // conflated (one candidate list, one hardcoded "1080p" value), which
    // meant every real request here sent a string into a numeric field and
    // got rejected by fal outright — this always failed, silently blamed on
    // "Upscale request was rejected" rather than the actual mismatch.
    build(schema) {
      const videoField = firstSupportedField(schema, ["video_url", "video"]) || "video_url";
      const resolutionField = firstSupportedField(schema, ["target_resolution", "resolution"]);
      const factorField = firstSupportedField(schema, ["upscale_factor"]);
      const fpsField = firstSupportedField(schema, ["target_fps", "fps"]);
      return (url) => {
        const input = { [videoField]: url };
        if (resolutionField) input[resolutionField] = "1080p";
        else if (factorField) input[factorField] = 2; // numeric multiplier, not a resolution string
        if (fpsField) input[fpsField] = 30;
        return input;
      };
    },
  },
};

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

  const { url, kind } = body;
  if (!url) {
    res.status(400).json({ error: "Missing the source image/video URL to upscale." });
    return;
  }

  const upscaler = UPSCALERS[kind];
  if (!upscaler) {
    res.status(400).json({ error: `Unsupported kind: ${kind}` });
    return;
  }

  try {
    const schema = await getInputSchema(token, upscaler.falModel);
    const input = upscaler.build(schema)(url);

    const { ok, status, data } = await createPrediction(token, upscaler.falModel, input);
    if (!ok) {
      res.status(status).json({ error: data?.detail || "Upscale request was rejected." });
      return;
    }

    res.status(200).json({ id: data.id, status: data.status, output: data.output || null });
  } catch (err) {
    res.status(500).json({ error: err.message || "Unexpected server error." });
  }
};
