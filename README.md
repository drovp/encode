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

## Advanced

You can see exactly the ffmpeg parameters used in each operation's log section, or check the `src/lib/{video|image|audio}.ts` files to see how they're constructed. If you see something that is not optimal, or have any ideas how to improve things, [create an issue](https://github.com/drovp/encode/issues)!.
