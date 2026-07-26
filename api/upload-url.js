// Issues a one-time upload URL from fal's own storage/CDN. This exists so the
// browser can send large files (video/audio for lip sync) directly to fal,
// instead of embedding them as base64 inside a request to one of our own
// serverless functions — Vercel's serverless functions have a hard body-size
// limit (~4.5MB) that has nothing to do with how big a file fal itself can
// accept, so routing big files through our own backend was the wrong shape
// to begin with.
//
// Verified against fal's own docs/client source (fal-js's storage.ts):
// POST https://rest.fal.ai/storage/upload/initiate returns { upload_url,
// file_url } — upload_url is a one-time URL the browser PUTs the raw file
// bytes to directly (no FAL_KEY needed for that step); file_url is the real
// https:// URL to use afterwards as a model's video_url/audio_url input.
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

  const { contentType, fileName } = body;
  if (!contentType || !fileName) {
    res.status(400).json({ error: "contentType and fileName are required." });
    return;
  }

  try {
    const initRes = await fetch("https://rest.fal.ai/storage/upload/initiate?storage_type=fal-cdn-v3", {
      method: "POST",
      headers: {
        Authorization: `Key ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ content_type: contentType, file_name: fileName }),
    });

    const text = await initRes.text();
    let data;
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      data = {};
    }

    if (!initRes.ok || !data.upload_url || !data.file_url) {
      res.status(initRes.ok ? 502 : initRes.status).json({
        error: data.detail || data.message || "Couldn't get an upload URL from fal.",
      });
      return;
    }

    res.status(200).json({ uploadUrl: data.upload_url, fileUrl: data.file_url });
  } catch (err) {
    res.status(500).json({ error: err.message || "Unexpected server error." });
  }
};
