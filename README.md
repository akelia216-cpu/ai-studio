# AI Studio

A tiny personal web app for generating images and videos with AI. No build step,
no framework — a static page plus serverless functions that talk to
[fal.ai](https://fal.ai), which hosts many image/video models
(Flux, SDXL, Minimax, Kling, Luma) behind one API.

## 1. Get a fal.ai API key

1. Go to https://fal.ai and sign up (free to create an account; you pay only
   per generation — most images are a fraction of a cent to a few cents,
   video is more, roughly $0.10–$0.50 per clip depending on the model).
2. Go to https://fal.ai/dashboard/keys and create a key.
3. Add a payment method under https://fal.ai/dashboard/billing (required
   before the API will run requests).

## 2. Deploy to Vercel (free)

The easiest path is through GitHub:

1. Create a new GitHub repo and push this folder to it.
2. Go to https://vercel.com, sign in, click "Add New… → Project", and import
   that repo.
3. In the "Environment Variables" step, add:
   - `FAL_KEY` = the key from step 1.
4. Click Deploy. Vercel needs no build command — it's a static site plus a
   handful of API functions.

Alternatively, from your own machine with the [Vercel CLI](https://vercel.com/docs/cli):

```
npm i -g vercel
cd ai-studio
vercel        # follow the prompts, first deploy
vercel env add FAL_KEY   # paste your key when asked
vercel --prod
```

## 3. Use it

Open the deployed URL. Pick Image, Video, or Lip Sync, write a prompt, choose
a model and aspect ratio, and hit Generate. Images usually finish in a few
seconds; video can take one to a few minutes. Your generation history is kept
in your browser's local storage (per device/browser — it's not shared across
devices or backed up anywhere).

- **Text to image**: Image mode, just write a prompt.
- **Image to video**: Video mode → "Image → Video" toggle → upload a source
  photo and describe the motion you want in the prompt (e.g. "she turns and
  smiles at the camera, hair blowing in the wind").
- **UGC content**: check "UGC / authentic style" in either Image or Video
  mode. Optionally upload a reference/product photo — for images it gets
  edited into the new scene so it stays recognizable; for video it's used as
  a character reference on models that support one. Pair it with the Lip
  Sync tab to put a scripted voiceover on a UGC talking-style video.
- **30 second – 2 minute videos**: in Video mode, change "Length" from
  "Short clip" to a Storyboard length. Write a topic instead of a shot
  description (e.g. "the history of the Roman aqueducts" or "a UGC-style
  review of a new coffee maker") and hit Generate.
- **Kids content (stories with a kid + adult voice, or songs)**: the "Kids &
  Songs" tab. For a spoken story, write a script with lines like `Kid: ...`
  and `Adult: ...` and pick a voice for each — the kid and adult lines are
  generated separately and stitched into one audio track. For a song, write
  lyrics and a style description and pick whether it should sound kid-voiced,
  adult-voiced, a duet, or a children's choir.
- **A cartoon character dancing/jumping/singing along to a song**: "Kids &
  Songs" → "Cartoon Song Video". Describe a character, generate its design,
  write lyrics + style, pick a main action (or "mixed" for variety), pick a
  length, and hit Generate. It builds a full video of your character
  performing the song — see "The extra layers on top" below for exactly how,
  and its real limitations (this one's the most experimental feature here).

## Models included

| Preset | Type | Notes |
|---|---|---|
| Flux Schnell | Image | Fastest, very good quality, cheapest |
| Flux 1.1 Pro | Image | Slower, best overall quality |
| Stable Diffusion XL (Fast SDXL) | Image | Classic, reliable |
| Minimax Video-01 | Video | Good general text-to-video, splits into separate text/image-to-video endpoints on fal |
| Kling v1.6 Standard | Video | Strong motion coherence, supports camera control |
| Luma Ray Flash 2 (Dream Machine) | Video | Fast turnaround |
| ESRGAN | Upscale (image) | Runs on any generated image via the "Upscale" button |
| Topaz Video Upscale | Upscale (video) | Runs on any generated video via the "Upscale" button |
| LatentSync | Lip sync | Syncs a talking-head video to a new audio track |
| any-llm (Llama 3.2 3B Instruct) | Prompt enhancement | Rewrites your prompt with more visual detail |
| Flux Pro Kontext | UGC image editing | Used automatically when "UGC style" + a reference photo are set, so the photo's subject stays recognizable in the new scene |
| Minimax Speech-02 HD | Text to speech | Powers the Kids story voices — its full voice catalog is fetched live and split into "kid-sounding" vs "adult-sounding" by name pattern |
| ACE-Step | Song generation | Generates a full song with sung vocals directly from lyrics + a style description, up to several minutes in one call — no reference audio needed |
| LatentSync (again) | Cartoon lip sync | Also used per-scene in Cartoon Song Video, syncing each animated scene's mouth to its slice of the song |

The backend fetches each model's live input schema from fal.ai before every
request, so it only ever sends fields a model actually supports — if you
swap in a different model slug in `api/_models.js`, you don't need to know
its exact parameter names, just list the plausible candidates and the app
figures out which ones stick.

A note on this fal.ai integration specifically: fal's per-model schema
endpoint couldn't be directly inspected while building this (it's blocked to
automated fetching), so the schema parser was written defensively — generic,
structure-tolerant, and falls back to a safe minimal request rather than
crashing if a model's schema doesn't look as expected. It's worth a live test
run with your real key early on so any field-name mismatches surface
immediately rather than deep into a long pipeline like Cartoon Song Video.

### The extra layers on top

- **Prompt enhancement** — the "✨ Enhance prompt with AI" button rewrites
  your prompt with more visual/cinematic detail using a small LLM, and lets
  you review/edit the result before generating.
- **Camera motion** — pick a movement (zoom, pan, orbit, dolly, tilt) in
  Video mode. Kling gets it as a native camera control; other models get it
  woven into the prompt text, which most video models respond to reasonably
  well even without a dedicated parameter.
- **Keyframes** — upload a start and/or end frame image in Video mode to
  anchor the shot. This is the closest equivalent to Runway-style
  first/last-frame control that's available through these APIs; true
  region-by-region "motion brush" painting isn't exposed by any third-party
  video API today (Runway keeps that entirely inside its own app), so it
  isn't something this app — or any app built on these APIs — can offer.
- **Upscaling** — every finished image or video gets an "Upscale" button
  that runs it through ESRGAN (images) or Topaz Video Upscale (video) and
  adds the sharper result as a new gallery item.
- **Lip sync** — the Lip Sync tab takes a short video of someone talking or
  moving plus an audio clip, and re-times their mouth to match the new
  audio. It needs an actual video as the source (not a still photo).
- **Seed & negative prompt** — under "Advanced," set a seed for repeatable
  results, or a negative prompt to steer image models away from unwanted
  elements (skipped automatically on models that don't support it).
- **UGC style** — pushes the prompt toward a casual, smartphone-shot,
  unpolished look instead of a glossy AI-generated one. With a reference
  photo attached, image mode switches to Flux Pro Kontext so the uploaded
  subject (a product, a face) stays recognizable in the new scene; video
  mode passes it as a character/subject reference if the chosen model
  supports one, and tells you if it doesn't.
- **Long-form video (30s–2min)** — no single fal.ai video model generates
  more than about 5-10 seconds in one call, so a "Storyboard" length works
  by: (1) a small LLM breaks your topic into a numbered shot list sized to
  fit the target duration, (2) each shot is generated as its own short clip
  (2 at a time, with one automatic retry on failure), (3) all the clips are
  downloaded and concatenated into a single file entirely in your browser
  using [ffmpeg.wasm](https://ffmpegwasm.netlify.app/) (loaded from a CDN —
  nothing to install), producing one continuous video. Turning on "UGC
  style" plus a reference photo carries the same consistent
  character/subject across every scene where the model supports it. This is
  meaningfully slower and more expensive than a single clip (roughly
  scene-count × per-clip time and cost — the length picker tells you the
  estimate before you commit), and if any single scene fails after its retry
  the whole storyboard is stopped rather than left half-built, since there's
  no server-side job to resume from. The stitched result only exists in your
  browser tab — download it from its gallery card before refreshing the
  page, or it's gone.
- **Kids stories & songs** — spoken stories are built line-by-line: each
  line in your script becomes its own short text-to-speech clip (in the
  matching kid or adult voice), then all the lines are stitched into one
  audio track in your browser, the same way storyboard video scenes are
  stitched. Songs are different — ACE-Step generates a complete song
  (vocals + instrumentation) from your lyrics and style description in a
  single call, so no stitching step is needed there, but there's no
  discrete "voice picker" the way TTS has; instead, the "Singer voice"
  choice adds a descriptive clause to the style prompt (e.g. "sung by a
  cheerful child's voice"), which steers but doesn't guarantee the result —
  regenerate with a different phrasing if the first take doesn't sound
  right. The kid/adult voice split for stories is a name-pattern heuristic
  over Minimax's live voice list (anything with "Boy," "Girl," "Kid,"
  "Teen," etc. in its name), not a documented "this is a child's voice"
  flag, so skim the dropdown once to confirm the picks sound right for your
  use case.
- **Cartoon Song Video** — this is the most involved pipeline in the app,
  chaining five separate steps: (1) generate a cartoon-style character
  image; (2) generate the full song; (3) an LLM plans one scene per ~5
  seconds of the song, each scene description keeping the character
  consistent; (4) each scene is animated as an image-to-video clip starting
  from the character image, biased toward your chosen action (dance, jump,
  wave, etc.) — there's no "make it dance" API parameter on any of these
  models, so the action is woven into each scene's prompt text, meaning
  results vary more than a scripted animation would; (5) the song is sliced
  into matching ~5-second pieces in your browser and each scene is
  individually lip-synced to its slice, then all the lip-synced scenes are
  stitched into one final video with their audio intact.
  Because scene video length and song-slice length aren't frame-identical
  (each video model has its own actual output duration), scene cuts can
  drift slightly out of sync with the beat by the end of a longer video —
  this is a real limit of assembling independently-generated clips rather
  than rendering one continuous timeline, not a bug to report. It's also the
  most expensive and slowest feature here: a 30-second video means roughly
  1 character image + 1 song + 6 scene animations + 6 lip-syncs — about 14
  AI generations — and a 2-minute video means around 50. Start with 30
  seconds to see how it turns out before committing to a longer one. If any
  single scene's animation or lip-sync fails twice, the whole run stops and
  tells you which scene, with the intermediate clips still linked in the
  error message so nothing already generated is wasted. This pipeline
  hasn't been tested end-to-end against live output (that needs your own
  API key) — if a step errors, send the message along and it can be
  adjusted.

### Known limits

- File uploads (keyframe images, lip-sync video/audio) are sent as inline
  base64/data URIs and capped around 4MB to stay under typical serverless
  request-size limits. Keep lip-sync clips to a few seconds. If you outgrow
  this, the fix is to upload through fal's own storage/upload API instead
  and pass a URL — ask your AI assistant to wire that in if you need it.
- Model line-ups on fal.ai change over time. If a preset ever 404s, check
  fal.ai/models for the current model slug and update `api/_models.js`.
- This fal.ai port carries more inherent uncertainty than a from-scratch
  build against fully-verified docs, since the exact schema JSON shape for
  each model couldn't be directly fetched and inspected while writing it.
  The defensive fallbacks (never hardcoding a field name, tolerating a
  missing/malformed schema) should keep most requests working even where a
  guess was wrong, but a live test pass with your key is the way to be sure.

## Local development

You need the [Vercel CLI](https://vercel.com/docs/cli) since the `/api`
functions need Vercel's dev server to run:

```
npm i -g vercel
vercel dev
```

Then create a `.env` file (not committed) with `FAL_KEY=...` before running
`vercel dev`, or export it in your shell.
