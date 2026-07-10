# Reels Multipost

A small Electron desktop app for posting short vertical videos (Shorts/Reels) to
**YouTube, TikTok, Instagram, Facebook, X, Threads and Mastodon** from one window: pick
a video, write the title/caption/hashtags once, tick the platforms, hit Post.

There's also a **WhatsApp (text only)** target that sends the caption to your own
phone — handy for pasting into apps where captions don't carry over (e.g. finishing
a TikTok draft on your phone).

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
  - **Threads** — optional topic tag (attached to the post as a chip)
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
- **X** — OAuth 1.0a signed requests, chunked v1.1 media upload for the video
  (INIT/APPEND/FINALIZE + status polling), then `POST /2/tweets`
- **Threads** — Threads API on `graph.threads.net`, with its own app credentials
  and login (separate from the Meta/Instagram flow). The OAuth redirect must be
  HTTPS, so the local callback server runs on a self-signed cert (one-time browser
  warning). Publishing mirrors Instagram: create a container from a public video
  URL (served through the same tunnel), poll until processed, then publish.
  An optional topic is sent as `topic_tag`. No custom video thumbnail — the
  Threads API doesn't accept one, so Threads auto-picks a frame
- **Mastodon** — simplest of all: a per-instance access token (no OAuth browser
  flow), direct multipart upload to `/api/v2/media` (no public URL/tunnel needed),
  poll while the video processes, then `POST /api/v1/statuses`. The captured frame
  is sent as the media `thumbnail`
- **WhatsApp (text only)** — no API: opens WhatsApp Desktop through a
  `whatsapp://send` deep link with the caption pre-filled to your own chat, and you
  press Send. Because you send it manually in the real client, it stays clear of
  WhatsApp's automation rules. Text only — deep links can't attach the video (add it
  yourself before sending if you want it)

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
| X | [X Developer Portal](https://developer.x.com) | App with **Read and write** permission; OAuth 1.0a API key + secret and access token + secret (all four pasted in settings) |
| Threads | [Meta for Developers](https://developers.facebook.com) | Same app as Meta, with the **Access the Threads API** use case (`threads_basic` + `threads_content_publish`), redirect `https://localhost:8713/callback`, your Threads account added as a **Threads Tester** (and the invite accepted); paste the Threads app ID + secret in settings |
| Mastodon | your instance's **Preferences → Development** | A new application with `read` + `write` scopes; paste its access token + your instance URL (e.g. `mastodon.social`) in settings |
| WhatsApp | — (no developer app) | WhatsApp Desktop installed and signed in; just your own phone number in international format (digits only, e.g. `31612345678`) |

Notes from the trenches:

- **TikTok**: an unaudited app can only upload **drafts** (you publish them from
  the TikTok app inbox — captions don't carry over). Direct post requires
  passing TikTok's app review/audit. Sandbox credentials work without review.
- **Meta**: the app has to be switched to **Live** (published) mode for posting
  to actually work — dev mode isn't enough, even for your own accounts. Instagram
  covers are set via frame timestamp; Facebook Reels accept a real thumbnail image.
- **X/Twitter**: uses pay-per-use pricing (~$0.015 per post, no monthly fee) —
  load a small prepaid balance in the developer console before posting. Note: a
  post containing a **link jumps to ~$0.20** (13× more), so keep URLs out of the
  caption (or drop them in a reply) to stay on the cheap rate. OAuth
  1.0a keys never expire, so there's no browser login or token refresh. No custom
  video thumbnail via the API (X auto-generates one; change it in the X media
  library if you care). Default 280-char post limit — Premium accounts should
  allow up to 25,000 chars via the API, but this hasn't been tested here (the app
  sends the full caption either way, so an over-limit post would just error).
- **Threads**: uses its own app ID/secret and login, even though it lives under the
  same Meta app. Adding yourself as a Threads Tester in the App Dashboard isn't
  enough — you also have to **accept the invite** inside Threads (Settings → Account
  → Website permissions), or the API rejects `threads_basic`. Being Live/published
  doesn't grant the permissions for non-testers; that would need App Review.
  Threads allows **only one topic per post**, and a `#hashtag` in the text counts as
  a competing topic — so when you set a Topic, the app **strips the `#` symbols** from
  the caption/hashtags (the words stay as plain text) and sends the topic as a proper
  tag instead. Leave the Topic empty and your hashtags post normally.
- **Mastodon**: the easiest to set up — no developer portal, no OAuth flow. Create an
  app in your instance's Preferences → Development with `read` + `write` scopes and copy
  its access token. Because it's decentralized, you also supply your **instance URL**.
  Default **500-char** limit and video size cap are per-instance settings. Custom video
  thumbnails **are** supported (unlike Threads/X).
- **WhatsApp**: it doesn't post anything — it just pops WhatsApp Desktop open with
  the caption ready, so you tap Send and copy it on your phone. Pairs well with the
  TikTok draft flow above (video's already in the draft; this gets you the caption).
  You still have to select a video in the app before the Post button enables, even
  though WhatsApp only uses the text.

## Where your data lives

Everything sensitive is stored per-user, outside the repo:

- `%APPDATA%/reels-multipost/settings.json` — API credentials
- `%APPDATA%/reels-multipost/tokens/` — OAuth tokens
- `%APPDATA%/reels-multipost/presets.json` — your presets

## Status

Personal project, built for my own posting workflow (sports data videos).
Expect sharp edges. Issues and ideas welcome, but no promises.
