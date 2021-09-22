# @drovp/encode

[Drovp](https://drovp.app) plugin for encoding video, audio, and images into common formats.

Supports resizing by setting size limits.

Uses [ffmpeg](https://ffmpeg.org/) under the hood.

### Used encoders:

- **Video**: libx264 (MP4/MKV), libx265 (MP4/MKV), libvpx (WEB/MKVM), libvpx-vp9 (WEBM/MKV)
	+ libopus for audio track
- **Images**: jpeg2000 (JPG), libwebp (WEBP)
- **Audio**: libmp3lame (MP3), libopus (OGG)

NOTE: Animated GIFs are encoded as video, while GIFs with only 1 frame are encoded as images.

## Advanced

You can see exactly the ffmpeg parameters used in each operation's log section, or check the `src/lib/{video|image|audio}.ts` files to see how they're constructed. If you see something that is not optimal, or have any ideas how to improve things, [create an ise](https://github.com/drovp/encode/issues)!.
