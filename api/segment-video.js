// Object segmentation/tracking (feature-audit doc item 10 — building-block
// only, lowest priority per the doc, but included since it's real/verified
// and cheap to build). Useful for isolating a character/object from its
// background for compositing or a selective effect.
//
// Model: fal-ai/sam2/video (Meta's Segment Anything 2). Confirmed live via
// fal's own docs: required video_url; `prompts` is a list of point prompts
// ({ x, y, label: 1 for foreground, frame_index }) marking the object to
// track. This app's UI only supports a single foreground click on the first
// frame (frame_index: 0) — SAM2's schema supports much more (box prompts,
// background points, multi-frame prompts) but one click is enough to
// exercise "isolate this object" as the doc frames the feature, and keeps
// the UI to a simple click-to-mark instead of a full annotation tool. Not
// yet live-tested (fal balance was zero at the time this was added).
const { getInputSchema, firstSupportedField, createPrediction } = require("./_fal");

const SEGMENT_MODEL = "fal-ai/sam2/video";

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

  const { video, x, y } = body;
  if (!video) {
    res.status(400).json({ error: "A source video is required." });
    return;
  }
  if (x === undefined || y === undefined) {
    res.status(400).json({ error: "Click a point on the frame to mark the object to track." });
    return;
  }

  try {
    const schema = await getInputSchema(token, SEGMENT_MODEL);
    const videoField = firstSupportedField(schema, ["video_url", "video"]) || "video_url";
    const promptsField = firstSupportedField(schema, ["prompts"]) || "prompts";

    const input = {
      [videoField]: video,
      [promptsField]: [{ x: Math.round(Number(x)), y: Math.round(Number(y)), label: 1, frame_index: 0 }],
    };

    const { ok, status, data } = await createPrediction(token, SEGMENT_MODEL, input);
    if (!ok) {
      res.status(status).json({ error: data?.detail || "Segmentation request was rejected." });
      return;
    }
    res.status(200).json({ id: data.id, status: data.status, output: data.output || null });
  } catch (err) {
    res.status(500).json({ error: err.message || "Unexpected server error." });
  }
};
