# Voice2Vision

Voice2Vision is a static HTML app for visualising spoken descriptions as flowing particle shapes. It listens through the browser microphone, turns the latest descriptive phrase into a hidden AI-generated height map, and samples that image so brighter regions attract more particles while darker regions stay sparse.

## Features

- Browser-only app: `index.html`, `styles.css`, and `app.js`.
- Live speech recognition in Chromium browsers via the Web Speech API.
- Microphone level drives subtle particle motion while someone reads.
- Pollinations image generation endpoint creates the hidden height-map source.
- The AI image is never shown; it is only sampled in memory on a canvas.
- Manual text prompt fallback for browsers without speech recognition.
- Local procedural fallback if the image generator is unavailable.

## Run locally

Use a local web server so microphone permissions work reliably:

```bash
python -m http.server 5173
```

Then open `http://localhost:5173`.

## Deploy on GitHub Pages

1. Push this repository to GitHub.
2. Open the repository settings.
3. Go to **Pages**.
4. Select the main branch and the repository root.
5. Open the published HTTPS URL.

Microphone access requires `https://` or `localhost`.

## Generator notes

The app uses Pollinations because it offers a direct no-key image endpoint:

```txt
https://image.pollinations.ai/prompt/{prompt}
```

The app prompts it for a high-contrast black-and-white height map, then samples pixel brightness. If you add an API key in the settings panel for a Pollinations account, use only a browser-safe publishable key beginning with `pk_`; never put a secret `sk_` key in a public GitHub repository.

Some browsers block direct pixel reads from generated cross-origin images. If the direct request is rejected, the app retries through the free Images.weserv.nl image cache so the canvas can safely read pixel brightness without a custom backend.

## Reading aloud

For book visualisation, start listening and read normally. The app waits for a short pause, extracts the recent descriptive words, and reshapes the particles. If a passage has dialogue or abstract narration, type a stronger scene cue manually and press **Shape particles** or `Ctrl`/`Cmd` + `Enter`.
