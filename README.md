# Reels Multipost

A small Electron desktop app for posting short vertical videos (Shorts/Reels) to
**YouTube, TikTok, Instagram and Facebook** from one window: pick a video, write the
title/caption/hashtags once, tick the platforms, hit Post.

Built as a personal tool — it runs entirely on your own machine with your own
platform API credentials. No third-party posting service, no subscription, no
server.

## Features

- Post to all selected platforms **in parallel**, with per-platform status lines
- **Presets**: save title/caption/hashtags + platform selection + all platform
  options under a name ("F1 results", "Match recap", …) and apply them in one click
- **Thumbnail from video frame**: scrub the preview, capture the current frame —
  used as the YouTube thumbnail, Instagram cover (`thumb_offset`) and Facebook
  Reels thumbnail
- Per-platform options:
  - **YouTube** — playlist, privacy, tags, category
  - **TikTok** — draft (inbox) or direct post, privacy, comment/duet/stitch toggles
  - **Facebook** — publish immediately or save as Page draft
- OAuth connect/disconnect per account from the settings screen
- All credentials and tokens stored in your OS user profile, never in the project

## How it works

Plain Electron (no framework). Each platform is a module in `src/platforms/`
behind a common interface (`isConfigured()`, `connect()`, `post()`); the UI is
static HTML/JS in `public/`.

- **YouTube** — official `googleapis` client, resumable upload
- **TikTok** — Content Posting API (`FILE_UPLOAD`), desktop OAuth with TikTok's
  hex-encoded PKCE
- **Facebook** — Reels Publishing API with binary upload to a Page
- **Instagram** — Content Publishing API; since Instagram only accepts a public
  video URL, the app briefly serves the file through an
  [ngrok](https://ngrok.com) tunnel (or a Cloudflare quick tunnel as fallback)
  while Meta fetches it

## Getting started

```
npm install
npm start        # or double-click dev.bat on Windows
```

Then open ⚙ Settings and add credentials for the platforms you want. You need
your **own** developer app per platform — they're free, but each portal has its
own ceremony:

| Platform | Where | What you need |
|---|---|---|
| YouTube | [Google Cloud Console](https://console.cloud.google.com) | Project with YouTube Data API v3 enabled, OAuth desktop client ID + secret |
| TikTok | [TikTok for Developers](https://developers.tiktok.com) | App with Login Kit + Content Posting API, desktop redirect URI `http://127.0.0.1:8712/callback` |
| Instagram + Facebook | [Meta for Developers](https://developers.facebook.com) | One business app with the Instagram + Pages use cases, a Facebook Login for Business configuration ID, IG professional account linked to a FB Page |
| Instagram hosting | [ngrok](https://ngrok.com) | Free account; either configure the ngrok agent on your machine or paste an authtoken in settings |

Notes from the trenches:

- **TikTok**: an unaudited app can only upload **drafts** (you publish them from
  the TikTok app inbox — captions don't carry over). Direct post requires
  passing TikTok's app review/audit. Sandbox credentials work without review.
- **Meta**: the app can stay in dev mode forever for your own accounts — no app
  review needed. Instagram covers are set via frame timestamp; Facebook Reels
  accept a real thumbnail image.
- **X/Twitter**: not implemented (free API tier is too restrictive to bother, so far).

## Where your data lives

Everything sensitive is stored per-user, outside the repo:

- `%APPDATA%/reels-multipost/settings.json` — API credentials
- `%APPDATA%/reels-multipost/tokens/` — OAuth tokens
- `%APPDATA%/reels-multipost/presets.json` — your presets

## Status

Personal project, built for my own posting workflow (sports data videos).
Expect sharp edges. Issues and ideas welcome, but no promises.
