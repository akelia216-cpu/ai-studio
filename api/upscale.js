const { getInputSchema, firstSupportedField, createPrediction } = require("./_fal");

const UPSCALERS = {
  image: {
    falModel: "fal-ai/esrgan",
    build(schema) {
      const imageField = firstSupportedField(schema, ["image"]) || "image";
      const scaleField = firstSupportedField(schema, ["scale"]);
      const faceField = firstSupportedField(schema, ["face_enhance"]);
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
    build(schema) {
      const videoField = firstSupportedField(schema, ["video", "video_url"]) || "video";
      const resField = firstSupportedField(schema, ["target_resolution", "resolution"]);
      const fpsField = firstSupportedField(schema, ["target_fps", "fps"]);
      return (url) => {
        const input = { [videoField]: url };
        if (resField) input[resField] = "1080p";
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
