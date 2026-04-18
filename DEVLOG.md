# Development Log — Koralabs Video Platform

A chronological record of design decisions, technical challenges, and implementation notes across the full project lifecycle.

---

## October 2025 — Project Setup, Docker, and GCP Infrastructure

### What was built
- Established the three-service monorepo structure: `koralabs-web-client` (Next.js), `video-api-service` (Firebase Cloud Functions), `video-processing-service` (Node.js/Express on Cloud Run)
- Wrote Dockerfiles for the processing service, including FFmpeg installation from the official Debian package repositories
- Provisioned core GCP infrastructure: two Cloud Storage buckets (`koralabs-raw-videos` for uploads, `koralabs-processed-videos` for transcoded output and thumbnails), a Pub/Sub topic (`video-upload-notifications`) with a push subscription pointing at the Cloud Run service endpoint, and a Firestore database instance (`koralabs-video-web-client`) in europe-west2
- Deployed the processing service to Cloud Run with 4 vCPUs and 8GB RAM — elevated allocations required because FFmpeg is CPU-bound during multi-resolution transcoding

### Technical decisions and rationale
- Chose europe-west2 (London) as the primary region for all services to minimise latency for the expected user base
- Separated raw and processed buckets so raw uploads can be deleted after processing without touching the served media files
- Used a push subscription rather than a pull subscription so Cloud Run scales to zero when idle — with pull, a persistent subscriber process would be required
- Docker multi-stage build was considered but deferred; FFmpeg is installed in a single stage to keep the Dockerfile simple at this early stage

### Challenges encountered and how they were resolved
- Initial Cloud Run deployments timed out during FFmpeg transcoding because the default 60-second request timeout was too short for even a short video. Resolved by setting `--timeout=900` (15 minutes) on the Cloud Run service
- Pub/Sub push delivery required a public HTTPS endpoint; used Cloud Run's auto-provisioned HTTPS URL and set it as the push endpoint in the GCP console

---

## October–November 2025 — Upload Pipeline and Signed URL Generation

### What was built
- Implemented the `generateUploadUrl` Firebase Function, which: creates a Firestore document for the video (status `"uploading"`), generates a v4 signed URL for the raw bucket with a 15-minute expiry, and optionally generates a second signed URL for thumbnail upload
- Built the client-side `uploadVideo` function in `functions.ts` using `XMLHttpRequest` instead of `fetch` — `fetch` does not expose upload progress events, whereas XHR's `upload.onprogress` event provides `loaded` and `total` byte counts for a real-time progress bar
- Upload modal in the studio page renders a progress bar driven by `onprogress`, updating a percentage state on every event tick

### Technical decisions and rationale
- Direct browser-to-GCS upload via signed URL avoids routing multi-gigabyte video files through the Firebase Functions runtime, which has a payload size limit and would be both slow and costly
- v4 signed URLs were used over v2 because v4 supports `extensionHeaders` for `Cache-Control`, allowing processed files to be cached with `public, max-age=31536000, immutable`
- The 15-minute URL expiry is a deliberate security constraint — long-lived signed URLs could be shared and used by unauthorised parties

### Challenges encountered and how they were resolved
- XHR CORS errors on the raw bucket: Cloud Storage signed URL uploads require `Content-Type` to be set in both the signed URL request and the actual PUT request headers. Fixed by including `contentType` in the signed URL generation options and setting `xhr.setRequestHeader('Content-Type', file.type)` before sending
- Thumbnail uploads required a separate signed URL because the thumbnail file is a different path and content type from the video — added an optional `thumbnailExtension` parameter to `generateUploadUrl` that conditionally generates a second URL

---

## November 2025 — Firebase Authentication and User Creation

### What was built
- Integrated Firebase Authentication with Google as the sole identity provider
- Implemented `createUser` as a `functions.v1.auth.user().onCreate()` trigger — fires on every new sign-in and creates a Firestore document in the `users` collection with `email`, `displayName`, `photoUrl`, and `subscriberCount: 0`
- Implemented `mirrorAvatarToGcs`: fetches the Google profile photo URL, resizes the image to 256×256 JPEG at quality 90 using Sharp, uploads the result to `avatars/{uid}.jpg` in the processed bucket, and stores the GCS URL in the user document

### Technical decisions and rationale
- Google profile photo URLs from Firebase Auth contain tracking parameters and can change when users update their profile picture. Mirroring to GCS ensures the avatar URL is stable and served from our own CDN rather than Google's
- Storing `subscriberCount` denormalised on the user document avoids a collection-count query every time a channel page loads — it is updated atomically via `FieldValue.increment(±1)` on subscribe/unsubscribe events

### Challenges encountered and how they were resolved
- The first attempt at avatar mirroring used `node-fetch` to download the Google photo, but the URL returned a 302 redirect to the actual image. The final implementation follows one level of redirects by listening for `res.statusCode === 301 || 302` and recursively calling the download helper with `res.headers.location`
- `displayName` was initially stored as the raw Google account name. Later discovered that some users had not set a display name in their Google account, resulting in `null` values. Added a fallback: `authUser.displayName ?? authUser.email?.split('@')[0] ?? 'User'`
- A `backfillUserDisplayNames` admin function was written retroactively to patch existing user documents that had been created before the fallback was added

---

## November 2025 — Initial Video Processing Service (360p MP4)

### What was built
- Express server on Cloud Run that receives Pub/Sub push messages, decodes the base64 JSON payload to extract the filename, and runs an FFmpeg transcoding pipeline
- Initial output: single-resolution 360p MP4 file using `fluent-ffmpeg` with `-vf scale=640:360 -c:v libx264 -crf 23 -preset fast -c:a aac -b:a 128k`
- Processing pipeline: download raw video from GCS → transcode → upload MP4 to processed bucket → update Firestore document with `status: "processed"` and `videoUrl` → delete raw file
- Firestore status tracking: document transitions through `uploading → processing → processed` (or `error` on failure)

### Technical decisions and rationale
- CRF 23 chosen as the baseline quality setting — it produces visually lossless output for most content while keeping file sizes significantly smaller than fixed-bitrate encoding
- `preset fast` over `preset medium` or `slow`: the processing time reduction outweighs the marginal file size increase for this use case
- Decided to delete the raw file after successful processing to avoid double-storing large video files and incurring unnecessary storage costs

### Challenges encountered and how they were resolved
- Cloud Run's ephemeral filesystem (`/tmp`) has limited space. Large source videos caused disk-full errors during simultaneous download and transcode. Resolved by streaming the GCS download directly to disk rather than buffering in memory, and by cleaning up intermediate files in a `finally` block even if transcoding fails
- Pub/Sub messages are retried on non-200 responses. If the processing service crashed mid-transcode, the message was redelivered and transcoding started again from scratch. Added idempotency checking: if the Firestore document already has `status: "processed"`, the handler exits early

---

## November–December 2025 — Next.js Frontend: Home, Watch, and Studio Pages

### What was built
- Home page (`/`): fetches all published videos via `getVideos`, renders a responsive grid of video cards with thumbnail, title, uploader name, view count, and upload date
- Watch page (`/watch?v=<id>`): custom HTML5 video player built from scratch — no third-party UI libraries. Includes play/pause, seek bar with buffered progress indicator, volume/mute, fullscreen, and playback speed controls
- Studio page (`/studio`): lists the authenticated user's videos with processing status, upload modal, and metadata editing fields
- Navbar: Google sign-in button, upload icon, profile avatar

### Technical decisions and rationale
- Client-side rendering for all pages — every page requires the authenticated user's identity at runtime (like status, subscription status, upload ownership), making SSR impractical without complex cookie-based token forwarding
- Custom video player rather than a third-party component (e.g., Video.js, Plyr) to maintain full control over the UI and to avoid loading large player libraries for functionality that wasn't needed yet
- CSS Modules (`.module.css` co-located with each page) for scoped styling without CSS-in-JS runtime overhead

### Challenges encountered and how they were resolved
- The watch page initially called `getVideos()` and filtered the result client-side to find the video by ID — extremely inefficient as the video library grew. Replaced with a dedicated `getVideoById` Firebase Function that performs a direct Firestore document lookup, reducing the initial data fetch from 50+ documents to exactly one. Page load time dropped from ~38 seconds to under 500ms
- Upload date display: Firestore timestamps are `Timestamp` objects, not JS `Date` instances. Added a `parseUploadDate` helper that extracts the creation timestamp from the Firestore document ID (which encodes a Unix timestamp in the first 8 hex characters) as a fallback when the `createdAt` field is absent

---

## January 2026 — Migration from MP4 to HLS Adaptive Streaming

### What was built
- Replaced the single-resolution MP4 pipeline with a multi-resolution HLS pipeline
- Defined four resolution tiers in `HLS_VARIANTS`: 1080p at 5,000 kbps, 720p at 2,800 kbps, 480p at 1,400 kbps, 360p at 800 kbps
- `getVideoHeight` uses `ffprobe` to probe the source video's dimensions before transcoding — only generates variants at or below the source height, with 360p always included as a baseline
- `transcodeResolutionToHLS` runs FFmpeg with these key options:
  ```
  -vf scale=-2:{height}
  -c:v libx264 -crf 23 -preset fast
  -g 144 -keyint_min 144
  -force_key_frames expr:gte(t,n_forced*6)
  -c:a aac
  -hls_time 6 -hls_list_size 0 -hls_playlist_type vod
  -hls_segment_filename {videoId}_{label}_%03d.ts
  ```
- `transcodeToHLS` orchestrates all resolution passes sequentially, then generates a master playlist (`{videoId}_master.m3u8`) listing variants in ascending order (360p → 1080p)
- All `.ts` segments and `.m3u8` playlists are uploaded to GCS under a `{videoId}/` folder prefix for clean organisation
- Integrated `hls.js` on the client: if `Hls.isSupported()`, instantiate an Hls instance and call `loadSource(hlsMasterUrl)` + `attachMedia(videoElement)`. On Safari, which supports HLS natively, set `video.src = hlsMasterUrl` directly

### Technical decisions and rationale
- `scale=-2:{height}` rather than `scale={width}:{height}`: the `-2` modifier scales the width proportionally while ensuring it is divisible by 2, which libx264 requires — eliminates aspect-ratio distortion for non-16:9 source videos
- 6-second segment duration: the industry standard balance between switching responsiveness (shorter segments = faster quality adaptation) and encoding overhead (each segment has header overhead; very short segments also increase HTTP request frequency)
- GOP size 144 at 24fps = exactly 6 seconds, matching `hls_time 6`. The `force_key_frames expr:gte(t,n_forced*6)` expression forces an IDR keyframe at every 6-second boundary regardless of the video's natural scene cuts, ensuring each segment starts independently seekable
- Master playlist written in ascending quality order so that `hls.js` level index 0 maps to the lowest quality — important for the ABR configuration that follows

### Challenges encountered and how they were resolved
- First attempt used `scale={width}:{height}` with hardcoded dimensions from the `HLS_VARIANTS` table. Source videos with non-16:9 aspect ratios (e.g., portrait phone recordings) produced black bars. Fixed by switching to `-2:{height}` and removing the hardcoded width
- Upload to GCS required making each file public after upload (`bucket.file(dest).makePublic()`) so the CDN URL is accessible without signed authentication. Initially forgot this step, causing 403 errors during playback

---

## January–February 2026 — HLS ABR Configuration: testBandwidth Discovery

### What was built
- Fine-tuned the hls.js ABR algorithm configuration to achieve reliable conservative-start behaviour:
  ```typescript
  startLevel: -1,                      // Hand control to ABR, don't override
  abrEwmaDefaultEstimate: 150000,      // 150 kbps default → always starts at 360p
  abrBandWidthFactor: 0.75,            // Downswitch if bandwidth < 75% of current bitrate
  abrBandWidthUpFactor: 0.55,          // Only upswitch if bandwidth > 1.82× target bitrate
  abrMaxWithRealBitrate: true,         // Use actual measured bitrates, not estimates
  abrEwmaFastVoD: 3,
  abrEwmaSlowVoD: 9,
  maxBufferLength: 30,
  maxMaxBufferLength: 60,
  testBandwidth: false,                // CRITICAL — see below
  ```
- After `MANIFEST_PARSED`, force level 0 and immediately hand control back to ABR by setting `hls.currentLevel = 0` then `hls.currentLevel = -1` — ensures the first segment loads at 360p regardless of any internal estimates
- Added a quality selector UI allowing manual override of the hls.js level

### Technical decisions and rationale
- `abrEwmaDefaultEstimate: 150000` (150 kbps) is deliberately far below the 360p bitrate (800 kbps). hls.js uses EWMA of observed download speeds; starting with a very low estimate forces it to begin at the lowest quality level and ramp up based on evidence rather than optimism
- `abrBandWidthUpFactor: 0.55` means the player only upswitches if estimated bandwidth exceeds 1/0.55 = 1.82× the target bitrate — a conservative safety margin that prevents premature upswitching followed by an immediate buffering event

### Challenges encountered and how they were resolved
- **The `testBandwidth` bug**: With the default `testBandwidth: true`, hls.js downloads a probe fragment from the *highest quality level* on startup to estimate bandwidth. This caused 1080p to load first on every page view regardless of actual network conditions — the exact opposite of the intended behaviour. Setting `testBandwidth: false` resolved this immediately. This was the most frustrating bug in the project; the parameter name is not obviously related to ABR start behaviour and was only discovered by reading the hls.js source code
- **Start level override not sticking**: Setting `startLevel: 0` directly was overridden internally by hls.js on some builds. The workaround of setting `currentLevel = 0` then `currentLevel = -1` in the `MANIFEST_PARSED` event handler proved more reliable — it loads one 360p segment, then hands ABR control back, allowing natural ramp-up

---

## February 2026 — Sharp Thumbnail Compression Pipeline

### What was built
- `generateThumbnailVariants` Firebase Function: downloads the original uploaded thumbnail from GCS, uses Sharp to produce two compressed variants:
  - **Small** (`thumbnails/small/{videoId}.jpg`): 640×360, JPEG quality 80 — used for video card grids
  - **Medium** (`thumbnails/medium/{videoId}.jpg`): 1280×720, JPEG quality 85 — used for the watch page poster image
- Both variants generated in parallel via `Promise.all([sharp(...).toBuffer(), sharp(...).toBuffer()])`
- Videos store `thumbnailSmallUrl` and `thumbnailMediumUrl` alongside the original `thumbnailUrl` in Firestore; the original is never served to browsers
- `processThumbnail` is called client-side after thumbnail upload completes (non-fatal: wrapped in try/catch so upload failure doesn't block video creation)
- `refreshUserAvatar` and `backfillUserAvatars` admin functions added to retroactively mirror avatars for existing users

### Technical decisions and rationale
- Sharp chosen over canvas or Jimp: it is a libvips wrapper, significantly faster than pure-JS image processing, and well-suited to Cloud Functions' ephemeral execution model
- `fit: 'cover'` on resize ensures thumbnails fill the target dimensions exactly, cropping rather than letterboxing — matches the aspect-ratio-fill behaviour used by YouTube and other platforms

### Challenges encountered and how they were resolved
- Initial implementation processed the thumbnail synchronously inside `generateUploadUrl`, adding 1–2 seconds to the upload flow. Moved to a separate `processThumbnail` function called asynchronously after the upload completes — the user sees the original thumbnail immediately while the compressed variants are generated in the background
- Discovered that original uploaded thumbnails averaged 1.8MB (users uploading high-resolution JPEGs directly from phone cameras). After compression: small variant averages 45KB, medium averages 68KB — a 95–97% reduction. Total thumbnail data on the homepage (12 cards) dropped from ~21.6MB to ~540KB

---

## February 2026 — Performance Optimisations

### What was built
- Replaced `getVideos()` + client-side filter on the watch page with a dedicated `getVideoById` Firestore document lookup — reduced initial data fetch from 50+ documents to exactly one document
- Lazy comment loading via `IntersectionObserver`: comments are only fetched when the comments section scrolls within 200px of the viewport. Eliminates Firestore reads for users who watch videos without scrolling to comments
- Parallelised watch page initialisation: uploader profile (`getUserById`), like status (`getLikeStatus`), and subscription status (`getSubscriptionStatus`) now execute concurrently via `Promise.all` instead of sequential `await` calls
- Deferred `recordView`: view count is only incremented after 3 seconds of actual playback via `setTimeout`, preventing inflated counts from page loads, back-navigation, and page refreshes without viewing

### Technical decisions and rationale
- The 3-second deferred view threshold approximates YouTube's "counted as a view" heuristic — long enough to filter accidental navigations, short enough to count genuine views
- `IntersectionObserver` with 200px root margin provides a comfortable pre-load margin so comments appear ready by the time the user actually scrolls to them, without loading them at page mount

### Challenges encountered and how they were resolved
- The original watch page load time of ~38 seconds was traced entirely to the `getVideos()` call, which fetches every video document in Firestore. The fix was straightforward once the cause was identified via Chrome DevTools Performance profiling — the call was so obviously wrong in retrospect that it became a lesson in profiling before optimising

---

## February 2026 — Social Features: Comments, Likes, Subscriptions, View Counting

### What was built
- **Comments**: `addComment`, `getComments`, `deleteComment`, `editComment` Firebase Functions. Comments stored as a subcollection under each video document. Edit shows an inline textarea replacing the comment text; delete requires ownership check (`comment.uid === request.auth.uid`)
- **Pinned comments**: `pinComment` and `unpinComment` functions — only the video owner can pin. Pinned comment is fetched separately and rendered at the top of the list with a distinct "Pinned" banner
- **Likes/dislikes**: `toggleLike` uses a Firestore transaction to atomically update both the `likes/{uid}` subcollection document and the video's `likeCount`/`dislikeCount` aggregate fields. Like and dislike are mutually exclusive — switching from like to dislike removes the like and adds the dislike in a single transaction
- **Subscriptions**: `toggleSubscription` updates a `subscriptions/{uid}` subcollection on the target channel's user document and increments/decrements `subscriberCount` via `FieldValue.increment`
- **Notifications**: `createNotification` helper fires asynchronously (not awaited in the main request handler) when a user receives a comment on their video, a like on their video, or a new subscriber. Notifications stored in `notifications/{uid}` subcollection with `type`, `fromUid`, `videoId`, `read: false`, and `createdAt`

### Technical decisions and rationale
- Using Firestore transactions for like toggling ensures there are no race conditions between concurrent like/unlike operations on popular videos
- Notifications are triggered outside the main request/response cycle to avoid adding latency to the triggering operation (e.g., posting a comment should not wait for notification creation to complete)

### Challenges encountered and how they were resolved
- Compound Firestore queries (e.g., `where('uid', '==', uid).orderBy('createdAt', 'desc')`) require composite indexes that are not created automatically. Hit `FAILED_PRECONDITION` errors in production; resolved by adding the necessary indexes via the Firebase console. As a workaround for queries where composite indexes were impractical, results are fetched unordered and sorted JavaScript-side

---

## February–March 2026 — Content Discovery: Tags, Search, Watch History

### What was built
- **Tags**: string array field on video documents; homepage filter pills use `.where('tags', 'array-contains', category)` Firestore query
- **Search**: debounced client-side search that filters the already-fetched video list by matching against `video.title.toLowerCase()`. Returns results as the user types without additional Firestore queries
- **Watch history**: `recordWatchHistory` creates or upserts a document in the `watchHistory` collection keyed by `{uid}_{videoId}`. `getWatchHistory` returns the user's viewing records ordered by timestamp
- **Up Next sidebar**: fetches all videos, retrieves watch history IDs, excludes videos watched in the last 24 hours, shuffles the remaining pool, and returns the top 5. The shuffle ensures varied recommendations across page loads
- **History page** (`/history`): displays the authenticated user's watch history with timestamps, with a "Clear history" button calling `clearWatchHistory`

### Technical decisions and rationale
- Client-side search was chosen over server-side full-text search (e.g., Algolia, Elasticsearch) to avoid additional service complexity. For a dataset of this size, filtering in-memory is instantaneous
- Deprioritising recently watched videos (24-hour window) rather than excluding them entirely means long-session users still see familiar content if the library is small

### Challenges encountered and how they were resolved
- Watch history queries using `orderBy('watchedAt', 'desc')` combined with `where('uid', '==', uid)` required a composite index. Created the index; Firestore's error message includes a direct link to the console to create it, which was helpful

---

## March 2026 — Channel Pages, Navbar Profile Dropdown, Loading Skeletons, 404 and Empty States

### What was built
- **Channel pages** (`/channel/[uid]`): displays the channel owner's avatar, display name, subscriber count, and their uploaded public videos via `getUserVideos`. Subscribe/unsubscribe button with real-time count update
- **Navbar profile dropdown**: clicking the user avatar reveals a dropdown with display name, links to Studio and Watch History, and a Sign Out button. Display names replace raw email addresses throughout the UI
- **Loading skeletons**: animated grey placeholder elements on the home page (card grid) and watch page (player area and sidebar) shown while Firestore data is loading — prevents blank white screens that disorient users
- **404 page**: custom `not-found.tsx` with a message and link back to the home page
- **Empty states**: contextual messages throughout the app — no videos on a channel, empty playlist, no search results, no watch history

### Technical decisions and rationale
- Display names were a late addition because early development used `user.email` wherever a name was needed. Once real users were considered, showing email addresses publicly was clearly unacceptable. Required updating multiple rendering paths across the home page, watch page, and channel page

### Challenges encountered and how they were resolved
- `getUserVideos` initially returned all videos without filtering by `status: 'processed'`, causing in-progress uploads to appear on channel pages. Added a `.where('status', '==', 'processed')` filter to the Firestore query

---

## March 2026 — Video Chapters

### What was built
- `parseChapters` client-side helper: matches timestamp patterns (`0:00 Title`, `1:30:45 Title`) from the video description using a regex, validates that at least two timestamps exist with the first at 0:00 and each subsequent timestamp strictly increasing, and converts timestamps to seconds
- Progress bar renders tick marks at each chapter boundary: `chapters.slice(1)` mapped to absolutely-positioned divs at `(ch.time / duration) * 100%`
- Current chapter highlighted in a collapsible chapter list below the description; clicking a chapter calls `videoRef.current.currentTime = ch.time`
- Chapter title displayed in the player controls area when chapters are present

### Technical decisions and rationale
- Client-side parsing means no additional Firebase Function or database field is required — chapters are derived from the description text on every render. The slight CPU cost of regex parsing is negligible
- Requiring the first chapter at 0:00 follows YouTube's convention and prevents a confusing gap before the first chapter marker

### Challenges encountered and how they were resolved
- The chapter regex needed to handle both `M:SS` and `H:MM:SS` timestamp formats. Initial implementation only handled `M:SS`, causing multi-hour videos with hour-prefixed timestamps to be silently ignored. Fixed with a combined regex that optionally captures an hours group

---

## March 2026 — Notifications System

### What was built
- Bell icon in the navbar with an unread badge showing the count of unread notifications
- `getNotifications` Firebase Function: returns the last 50 notifications for the authenticated user, ordered by `createdAt` descending
- `markNotificationsRead` Firebase Function: batch-updates all unread notifications to `read: true`, clears the badge
- Notification triggers in the API layer: `addComment` fires a notification to the video owner if the commenter is a different user; `toggleLike` fires a notification to the video owner when a like is added; `toggleSubscription` fires a notification to the channel owner when a new subscriber is added
- Client polls for notifications every 60 seconds via `setInterval` in the navbar component

### Technical decisions and rationale
- Polling every 60 seconds rather than a Firestore real-time listener was chosen to keep the client implementation simple — a persistent listener consumes a Firestore read for every document change, whereas polling reads the collection once per minute regardless of activity
- Notifications are triggered outside the main request handler (`void createNotification(...)` rather than `await`) so comment/like/subscribe operations are not slowed by the notification write

### Challenges encountered and how they were resolved
- Self-notification: a user commenting on their own video initially triggered a notification to themselves. Added a guard: `if (video.uid !== request.auth.uid)` before calling `createNotification`

---

## March 2026 — Playlists

### What was built
- Full playlist CRUD: `createPlaylist`, `deletePlaylist`, `addToPlaylist`, `removeFromPlaylist`, `reorderPlaylist`, `updatePlaylistVisibility`
- Playlists stored in a top-level `playlists` collection with `uid`, `title`, `videoIds: string[]`, `visibility: 'public' | 'private'`, and `createdAt`
- Playlist page (`/playlist/[playlistId]`): lists the playlist's videos in order, allows drag-to-reorder via the HTML5 Drag and Drop API (`dragstart`, `dragover`, `drop` events on list items), remove-from-playlist, delete-playlist, and toggle-visibility controls
- Watch page shows a playlist sidebar when a `playlistId` query parameter is present: current position indicator (`3 / 7`), Previous/Next navigation buttons, and auto-advance to the next video when the current video's `ended` event fires
- Studio page shows the user's playlists alongside their videos, with a "New Playlist" modal

### Technical decisions and rationale
- Storing `videoIds` as an ordered array on the playlist document (rather than a separate ordered subcollection) makes reordering a single document write rather than multiple ordered document updates, and keeps the playlist fetchable in one Firestore read
- `reorderPlaylist` validates that the new video ID array contains the same IDs as the existing array (just reordered) before writing, preventing accidental data loss from client-side bugs

### Challenges encountered and how they were resolved
- Drag-to-reorder had a visual glitch where the dragged item would briefly appear at its original position after a drop before the state update rendered. Fixed by updating the `videos` state array optimistically on `drop` and only calling `reorderPlaylist` after the optimistic update, so the UI is already correct by the time the server call completes

---

## March 2026 — Video Duration Overlay and GCS Bucket Folder Organisation

### What was built
- `getVideoDuration` uses `ffprobe` on the downloaded raw video to return the duration in seconds (rounded to the nearest integer), stored as `duration` in the Firestore video document
- Thumbnail cards render the duration as a bottom-right overlay badge, formatted as `M:SS` or `H:MM:SS`
- All HLS files (`.ts` segments and `.m3u8` playlists) are now uploaded to GCS under a `{videoId}/` prefix, e.g. `{videoId}/{videoId}_720p_001.ts`. The `transcodeToHLS` function passes this prefix to the upload helper

### Technical decisions and rationale
- GCS doesn't have true directories (it's a flat object store), but prefix-based folder organisation makes the bucket navigable via the GCP console and avoids namespace collisions between videos with similar names
- Duration stored in Firestore rather than derived client-side because `ffprobe` is only available server-side in the processing pipeline

### Challenges encountered and how they were resolved
- Duration was initially only stored when all resolutions completed. Changed to probe duration first, before any transcoding begins, so duration is available in Firestore even if the processing job is interrupted mid-transcode

---

## March–April 2026 — Processing Progress Bar in Studio

### What was built
- Processing service updates the video's Firestore document with `progress` (0–100 integer) and `processingStage` (string) at key milestones: `0 / 'downloading'`, `10 / 'transcoding'`, increments per resolution completed (scaled between 10 and 90), `95 / 'uploading'`, `100 / 'processed'`
- `onResolutionComplete` callback in `transcodeToHLS` fires after each resolution variant completes, allowing fine-grained progress reporting during the longest phase
- Studio page polls Firestore every 5 seconds for videos with `status !== 'processed'`, updating the progress bar and stage label in real time
- Processing cards in the studio show a labelled progress bar (e.g., "Transcoding — 60%") that disappears once processing completes

### Technical decisions and rationale
- Polling every 5 seconds is a reasonable interval for a process that takes 1–10 minutes — frequent enough to feel responsive, infrequent enough not to burn Firestore read quota
- Stage labels (`downloading`, `transcoding`, `uploading`, `processed`) are stored as human-readable strings rather than numeric codes so they can be displayed directly in the UI without a lookup table

### Challenges encountered and how they were resolved
- Firestore's `onSnapshot` real-time listener was considered as an alternative to polling. It was rejected because it requires a persistent WebSocket connection per document being watched, which is expensive if multiple uploads are processing simultaneously. Polling is simpler and scales linearly with the polling interval rather than with the number of active listeners

---

## April 2026 — HLS Segment Tuning: 6-Second Segments and GOP Alignment

### What was built
- Locked `hls_time` to 6 seconds as the definitive segment duration following research into industry standards
- Set GOP parameters: `-g 144 -keyint_min 144` (144 frames at 24fps = 6 seconds) + `-force_key_frames expr:gte(t,n_forced*6)`
- Verified that all generated segments start with an IDR keyframe by inspecting the output with `ffprobe -show_frames` and confirming `key_frame=1` on the first frame of each `.ts` file

### Technical decisions and rationale
- 6-second segments are the Apple HLS specification's recommended VOD segment duration and are used by the majority of commercial streaming platforms. Shorter segments (2–4s) increase HTTP request overhead; longer segments (10–15s) slow quality adaptation
- The `force_key_frames` expression is necessary because libx264's natural keyframe placement follows scene detection — without forcing, segments that start mid-GOP cannot be independently decoded and seeking to arbitrary positions produces visual artefacts

### Challenges encountered and how they were resolved
- Discovered that `-keyint_min 144` alone is insufficient — it sets a minimum GOP size but does not override the encoder's scene-change detection, which inserts extra keyframes. The `force_key_frames` expression is the correct way to guarantee regular keyframe placement in FFmpeg

---

## April 2026 — Admin Panel, Backfill Functions, and Avatar Refresh

### What was built
- Admin panel in the studio (`/studio?admin=true`) accessible only to users whose UID is listed in the `admins` Firestore collection
- `requireAdmin(uid)` helper checked by `adminGetAllVideos` and `adminDeleteVideo` Firebase Functions
- `adminDeleteVideo`: deletes all GCS files for the video (HLS segments, playlists, thumbnail variants), the Firestore video document, and all subcollection documents (comments, likes)
- `backfillUserDisplayNames`: iterates all `users` documents, looks up each user in Firebase Auth, and patches `displayName` for any document that has a null value
- `backfillUserAvatars`: iterates all `users` documents and re-mirrors avatars for any user whose `photoUrl` still points to a Google CDN URL rather than the project's GCS bucket

### Technical decisions and rationale
- Admin UID lookup in Firestore (rather than hardcoding UIDs in the Functions source) means admin access can be granted/revoked without redeploying the Functions
- Backfill functions are essential whenever a schema change or bug fix requires patching existing data — the pattern of iterating all documents in a collection and conditionally updating is robust enough to be reused for any future data migrations

### Challenges encountered and how they were resolved
- `adminDeleteVideo` initially left orphaned thumbnail files because the thumbnail paths were not consistently named. Fixed by storing `thumbnailPath` (the original GCS path) in the Firestore document at upload time and using it directly in the delete function, rather than reconstructing the path from the video ID

---

## April 2026 — Share Button, Pinned Comments, Upload Progress Bar

### What was built
- **Share button** on the watch page: copies the current page URL to the clipboard via `navigator.clipboard.writeText`, shows a toast notification ("Link copied!") that auto-dismisses after 2 seconds
- **Pinned comments**: `pinComment` and `unpinComment` Firebase Functions set a `pinned: boolean` field on the comment document. The watch page fetches pinned comments separately from the main comments list and renders them at the top with a "📌 Pinned by creator" banner
- **Upload progress bar**: the studio upload modal now shows a visual progress bar driven by the XHR `upload.onprogress` event. The bar fills from 0% to 100% as the file uploads, then transitions to a "Processing..." state while the video processing pipeline runs

### Technical decisions and rationale
- `navigator.clipboard` requires a secure context (HTTPS or localhost) — not a concern for this deployment but worth noting for local development
- Only one comment can be pinned per video at a time: `pinComment` first queries for any existing pinned comment and calls `unpinComment` on it before pinning the new one, maintaining the single-pinned-comment invariant

### Challenges encountered and how they were resolved
- The upload progress bar initially jumped to 100% immediately for small files because the XHR completed before the first `onprogress` event fired. Fixed by treating the upload phase as 0–90% of the progress bar and reserving 90–100% for the server-side processing confirmation, so the bar always advances smoothly

---

## April 2026 — Final Testing, Deployment, and Performance Profiling

### What was built
- Full end-to-end testing across all features: upload, transcoding, adaptive streaming, authentication, comments, likes, playlists, notifications, watch history, chapters, search, admin panel
- Deployment of all three services: Firebase Functions (`firebase deploy --only functions`), video processing service (`gcloud run deploy`), web client (`gcloud run deploy`)
- Performance profiling session in Chrome DevTools:
  - **Thumbnail bandwidth**: original uploads averaged 1.8MB; small variant averages 45KB, medium 68KB — 95–97% reduction per image
  - **Page load**: watch page 38.62s → 2–3s after `getVideoById` fix and parallel initialisation
  - **Adaptive streaming under throttle**: Slow 3G (400 kbps) — player stayed at 360p, no buffering events. Custom 1,050 kbps profile — switched from 360p to 480p within 8 seconds, correctly did not attempt 720p. No throttle (50 Mbps broadband) — reached 1080p within 10 seconds

### Technical decisions and rationale
- Deployment sequencing: Functions first (since the web client depends on the function endpoints being available), then processing service, then web client
- Profiling was conducted in an incognito window to avoid cached responses skewing the results

### Challenges encountered and how they were resolved
- Final deployment of the processing service failed because the Docker image referenced an FFmpeg version that had been removed from the Debian package repository. Fixed by pinning to a specific FFmpeg version in the Dockerfile
- Cloud Run cold-start latency (~2–5 seconds for the processing service) is observable as a delay between a video being uploaded and the Pub/Sub message being processed. This is acceptable for a VOD platform where users expect asynchronous processing, and the studio progress bar makes the delay visible and expected
