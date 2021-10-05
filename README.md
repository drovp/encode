# @drovp/encode

[Drovp](https://drovp.app) plugin for encoding video, audio, and images into common formats.

Supports resizing by setting size limits.

Uses [ffmpeg](https://ffmpeg.org/) under the hood.

### Used encoders:

- **Video**: libx264 (`mp4`/`mkv`), libx265 (`mp4`/`mkv`), libvpx (`webm`/`mkv`), libvpx-vp9 (`webm`/`mkv`)
	+ libopus for audio track
- **Images**: jpeg2000 (`jpg`), libwebp (`webp`)
- **Audio**: libmp3lame (`mp3`), libopus (`ogg`)

NOTE: Animated GIFs are encoded as video, while GIFs with only 1 frame are encoded as images.

### Resizing

Built in powerful output dimensions control settings:

- resize based on a single dimension constraint (other dimension will be calculated to maintain aspect ratio)
- resize based on desired number of megapixels
- cover, contain, or stretch modes when both dimension constraints are defined

### Skip threshold

An ability to configure data density threshold to skip encoding of files that are already compressed enough. Speeds up jobs where you need to compress huge amounts of files of unknown compression.

### Min savings recovery

A setting to control min file size savings of the output. When the output is not at least a configured percent smaller, it'll be automatically discarded and original kept in place.

## Advanced

You can see exactly the ffmpeg parameters used in each operation's log section, or check the `src/lib/{video|image|audio}.ts` files to see how they're constructed. If you see something that is not optimal, or have any ideas how to improve things, [create an issue](https://github.com/drovp/encode/issues)!.
