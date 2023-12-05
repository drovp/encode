# @drovp/encode

[Drovp](https://drovp.app) plugin for encoding video, audio, and images into common formats with optional editing and or concatenation support.

Creates Drovp profiles into which you can drop any media files (video, image, and audio) and have them encoded into desired formats.

Uses [ffmpeg](https://ffmpeg.org/) and [sharp](https://www.npmjs.com/package/sharp) under the hood.

### Features

<p align="center">
  <img src="https://user-images.githubusercontent.com/47283320/183287870-b10dab65-bd03-4cba-bc9d-0b995c689bbb.png" />
</p>

-   Media editor to instruct the encoder how to edit the output. Supports cropping, cutting, concatenating, rotation, flipping, ... Can be spawned on drop by drop basis with editor modifier, or configured to always appear for current profile.
-   All configuration is designed to be agnostic to the resolution/type/size of the input files.
-   Resizing by setting size limits, or max desired megapixels, or both.
-   Ability to skip encoding of files that are already compressed enough with **Skip thresholds**.
-   Optionally discard inefficient encodes that didn't compress the file enough.

### Supported codecs/formats

Input files can be anything [ffmpeg](https://ffmpeg.org/) or [sharp](https://www.npmjs.com/package/sharp) recognize, which is pretty much anything.

Currently supported output codecs/formats are:

-   **Video**: H.264 (`mp4`/`mkv`), H.265 (`mp4`/`mkv`), VP8 (`webm`/`mp4`/`mkv`), VP9 (`webm`/`mp4`/`mkv`), AV1 (`webm`/`mp4`/`mkv`), GIF (`gif`)
    -   With Opus or Vorbis for audio track
-   **Images**: `jpg` (mozjpeg), `webp`, `avif`, `png`
-   **Audio**: `mp3`, `ogg` (Opus), `flac`, `wav`

NOTE: Animated GIFs are treated as video, while GIFs with only 1 frame as images.

### Resizing

Built in powerful output dimension controls:

-   resize based on a single dimension constraint (other dimension will be calculated to maintain aspect ratio)
-   `fill`, `cover`, `contain`, `inside`, and `outside` modes when both dimension constraints are defined
-   resize to fit a desired number of megapixels

All options above can be combined, encode will calculate output dimensions to ensure they are all satisfied, with max megapixels limit having priority over dimension limits.

### Skip threshold

An ability to configure data density threshold to skip encoding of files that are already compressed enough. Speeds up jobs where you need to compress huge amounts of files of unknown compression.

Threshold is configured by setting relative data density units per each item type:

-   Video: bytes per pixel per second
-   Audio: bytes per channel per second
-   Image: bytes per pixel

### Min savings recovery

When you've configured encode to replace original files, you can use **Min savings** to ensure the file savings are significant enough to warrant the loss of quality due to re-encode. When the output is not at least a configured percent smaller than the original, it'll be automatically discarded and original kept in place.

## Advanced

You can see exactly the ffmpeg parameters used in each operation's log section, or check the `src/lib/{video|image|audio}.ts` files to see how they're constructed. If you see something that is not optimal, or have any ideas how to improve things, [create an issue](https://github.com/drovp/encode/issues)!.
