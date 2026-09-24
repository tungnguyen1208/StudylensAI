# Dev 1 to Dev 2 handoff - Caption transcript, contract 0.4.0

## Runtime sequence

`ON -> Timedtext captionTracks -> Transcript DOM fallback -> Backend caption capture -> ACTIVATION_ENABLED -> Session -> Segment -> quiz`.

Dev 1 never calls FastAPI. FastAPI is called by the Backend only after Dev 2
has frozen a valid transcript segment for quiz generation.

## Caption transport boundary

The Content Script reads only YouTube metadata, Timedtext and the transcript
DOM. It sends normalized cue-only data through the internal Extension bridge:

`Content Script -> Service Worker -> ASP.NET Core Backend`.

The Service Worker validates that the sender tab is still the same
`youtube.com/watch?v=<youtubeVideoId>` page before it sends the request. This
keeps the Backend request under the extension origin, avoids YouTube-page CORS
failures, and rejects stale A -> B uploads. The internal bridge is not a
public Dev 1 -> Dev 2 contract and exposes neither an arbitrary URL nor raw
page data.

## Events Dev 2 consumes

- `VIDEO_CONTEXT_CHANGED` is sent once before the old session is completed.
- `ACTIVATION_ENABLED` is sent exactly once for a video only after Backend has
  returned `transcriptCapture.status: available` with source `youtubeCaption`.
- `ACTIVATION_DISABLED` is reserved for explicit learner OFF.
- `OPERATION_STATUS_CHANGED` with `operation: transcriptUpload` communicates
  pending, successful, unavailable, insufficient, and retryable Backend error
  states. No audio, provider key, answer key, or raw DOM payload is present.

## TranscriptCaptureRef seam

`TranscriptCaptureRef` is unchanged structurally: `transcriptCaptureId`,
`youtubeVideoId`, `language`, `source`, `status`, `availableCueCount`, and
`version`. Its only runtime source in 0.4.0 is `youtubeCaption`.

When status is `unavailable` or `insufficient`, Dev 2 must not create a
session, timer, segment, or quiz. Global learner ON remains active so the
replacement flow can start when the learner navigates to another video.
