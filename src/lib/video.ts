import * as OS from 'os';
import * as Path from 'path';
import {promises as FSP} from 'fs';
import {ffmpeg, runFFmpegAndCleanup} from './ffmpeg';
import {makeResize, ResizeOptions} from './dimensions';
import {formatSize, eem, MessageError, resizeRegion, cutCuts, msToIsoTime} from './utils';
import {VideoMeta, VideoStream, AudioStream} from 'ffprobe-normalized';
import {SaveAsPathOptions} from '@drovp/save-as-path';
import {ProcessorUtils} from '@drovp/types';
import {SetRequired} from 'type-fest';

const {round, max, abs, floor} = Math;

const IS_WIN = process.platform === 'win32';

export interface TwoPassData {
	args: [(string | number)[], (string | number)[]];
	logFiles: string[];
}

interface SegmentVideo {
	id: string;
	meta: VideoStream;
}

interface SegmentAudio {
	id: string;
	meta: SetRequired<Partial<AudioStream>, 'channels'>;
}

interface Segment {
	video: SegmentVideo;
	audio: SegmentAudio[];
	duration: number;
}

export interface VideoOptions {
	resize: ResizeOptions;

	codec: 'h264' | 'h265' | 'vp8' | 'vp9' | 'av1' | 'gif';

	h264: {
		mode: 'quality' | 'bitrate' | 'size';
		crf: number; // 0: lossless, 51: worst
		bitrate: number; // KB per second per million pixels (bitrate mode)
		size: number; // target size in Mpx
		preset: 'ultrafast' | 'superfast' | 'veryfast' | 'faster' | 'fast' | 'medium' | 'slow' | 'slower' | 'veryslow';
		tune: '' | 'film' | 'animation' | 'grain' | 'stillimage' | 'fastdecode' | 'zerolatency';
		twoPass: boolean;
		profile: 'auto' | 'baseline' | 'main' | 'high';
		preferredOutputFormat: 'mkv' | 'mp4';
	};

	h265: {
		mode: 'quality' | 'bitrate' | 'size';
		crf: number; // 0: lossless, 51: worst
		bitrate: number; // KB per second per million pixels (bitrate mode)
		size: number; // target size in Mpx
		preset: 'ultrafast' | 'superfast' | 'veryfast' | 'faster' | 'fast' | 'medium' | 'slow' | 'slower' | 'veryslow';
		tune: '' | 'grain' | 'zerolatency' | 'fastdecode';
		twoPass: boolean;
		// prettier-ignore
		profile: 'auto' | 'main' | 'main-intra' | 'mainstillpicture' | 'main444-8' | 'main444-intra' | 'main444-stillpicture' | 'main10' | 'main10-intra' | 'main422-10' | 'main422-10-intra' | 'main444-10' | 'main444-10-intra' | 'main12' | 'main12-intra' | 'main422-12' | 'main422-12-intra' | 'main444-12' | 'main444-12-intra';
		preferredOutputFormat: 'mkv' | 'mp4';
	};

	vp8: {
		mode: 'quality' | 'constrained-quality' | 'bitrate' | 'size';
		crf: number; // 0: lossless, 63: worst
		qmin: number; // 0-63
		qmax: number; // qmin-63
		bitrate: number; // KB per second per million pixels (bitrate mode)
		minrate: number; // KB per second per million pixels (bitrate mode)
		maxrate: number; // KB per second per million pixels (bitrate mode)
		size: number; // target size in Mpx
		speed: number; // 0: slowest/best quality, 5: fastest/worst quality
		twoPass: boolean;
		preferredOutputFormat: 'mkv' | 'mp4' | 'webm';
	};

	vp9: {
		mode: 'quality' | 'constrained-quality' | 'bitrate' | 'lossless' | 'size';
		crf: number; // 0: lossless, 63: worst
		qmin: number; // 1-63
		qmax: number; // qmin-63
		bitrate: number; // KB per second per million pixels (bitrate mode)
		minrate: number; // KB per second per million pixels (bitrate mode)
		maxrate: number; // KB per second per million pixels (bitrate mode)
		size: number; // target size in Mpx
		twoPass: boolean;
		speed: number; // 0: slowest/best quality, 5: fastest/worst quality
		threads: number;
		preferredOutputFormat: 'mkv' | 'mp4' | 'webm';
	};

	av1: {
		preset: number; // 0-13 effort, 0: slowest, 13: fastest with quality/size tradeoff
		mode: 'crf' | 'vbr' | 'cbr' | 'size';
		crf: number; // 0: lossless, 63: worst
		minQp: number; // 0-63
		maxQp: number; // qmin-63
		targetBitrate: number; // KB per second per million pixels (VBR)
		maxBitrate: number; // KB per second per million pixels (CRF)
		minrate: number; // KB per second per million pixels (bitrate mode)
		maxrate: number; // KB per second per million pixels (bitrate mode)
		size: number; // target size in Mpx
		keyframeInterval: number;
		sceneDetection: boolean;
		filmGrainSynthesis: number; // 0: off, 50: max de-noising and re-noising
		twoPass: boolean;
		multithreading: boolean;
		preferredOutputFormat: 'mkv' | 'mp4' | 'webm';
	};

	gif: {
		colors: number;
		dithering: 'none' | 'bayer' | 'sierra2_4a';
	};

	speed: number;
	maxFps: number;
	audioCodec: 'opus' | 'vorbis';
	audioChannelBitrate: number; // Kbit/s PER CHANNEL
	maxAudioChannels: number;
	pixelFormat: string;
	scaler: 'fast_bilinear' | 'bilinear' | 'bicubic' | 'neighbor' | 'area' | 'gauss' | 'sinc' | 'lanczos' | 'spline';
	deinterlace: boolean;
	stripSubtitles: boolean;
	ensureTitle: boolean;
	minSavings: number;
	skipThreshold: number | null;

	cuts?: Cut[];
	crop?: Region;
	rotate?: Rotation;
	flipHorizontal?: boolean;
	flipVertical?: boolean;
}

export interface ProcessOptions {
	id: string;
	utils: ProcessorUtils;
	cwd: string;
	verbose: boolean;
}

// Parameter pairs to enable 2 pass encoding
function makeTwoPass(id: string, extraArgs?: (string | number)[]): TwoPassData {
	const twoPassLogFileId = Path.join(OS.tmpdir(), `drovp-encode-passlogfile-${id}`);
	return {
		args: [
			['-pass', 1, '-passlogfile', twoPassLogFileId, ...(extraArgs || [])],
			['-pass', 2, '-passlogfile', twoPassLogFileId, ...(extraArgs || [])],
		],
		logFiles: [`${twoPassLogFileId}-0.log`],
	};
}
function makeTwoPassX265(id: string): TwoPassData {
	const twoPassLogFileId = Path.join(OS.tmpdir(), `drovp-encode-passlogfile-${id}`);
	return {
		args: [
			['-x265-params', `pass=1:stats='${twoPassLogFileId}'`],
			['-x265-params', `pass=2:stats='${twoPassLogFileId}'`],
		],
		logFiles: [twoPassLogFileId, `${twoPassLogFileId}.cutree`],
	};
}

/**
 * Resolves with result path.
 */
export async function processVideo(
	ffmpegPath: string,
	inputs: VideoMeta[],
	options: VideoOptions,
	savingOptions: SaveAsPathOptions,
	processOptions: ProcessOptions
): Promise<string | undefined> {
	const {utils} = processOptions;
	const firstInput = inputs[0];

	if (!firstInput) {
		utils.output.error('No inputs received.');
		return;
	}

	const ffmpegInputs: (string | number)[][] = []; // groups of arguments related to a single input, such as `-ss -t -i`
	const inputArgs: (string | number)[] = [];
	const videoArgs: (string | number)[] = [];
	const audioArgs: (string | number)[] = [];
	const extraMaps: (string | number)[] = [];
	const outputArgs: (string | number)[] = [];
	const {crop, cuts, flipVertical, flipHorizontal, rotate, speed} = options;
	const includeSubtitles =
		!options.stripSubtitles && !cuts && inputs.length === 1 && firstInput.subtitlesStreams.length > 0;
	const maxAudioStreams = inputs.reduce(
		(count, input) => (input.audioStreams.length > count ? input.audioStreams.length : count),
		0
	);
	const stripAudio = options.codec === 'gif' || options.maxAudioChannels === 0 || maxAudioStreams === 0;
	let twoPass: false | TwoPassData = false;
	// Canvas dimensions are each the max dimension of all inputs
	const canvasWidth = inputs.reduce((width, input) => (input.displayWidth > width ? input.displayWidth : width), 0);
	const canvasHeight = inputs.reduce(
		(height, input) => (input.displayHeight > height ? input.displayHeight : height),
		0
	);
	const canvasAspectRatio = canvasWidth / canvasHeight;
	// Target is whatever the user targeted: cropped and or rotated
	let targetWidth = options.crop?.width ?? canvasWidth;
	let targetHeight = options.crop?.height ?? canvasHeight;

	// Adjust for rotation
	if (rotate && rotate % 180 === 90) {
		const tmpTargetWidth = targetWidth;
		targetWidth = targetHeight;
		targetHeight = tmpTargetWidth;
	}

	let commonResize = makeResize(targetWidth, targetHeight, options.resize);
	const {finalWidth, finalHeight} = commonResize;
	let outputFramerate = Math.min(
		options.maxFps || Infinity,
		(inputs.reduce((framerate, input) => (input.framerate > framerate ? input.framerate : framerate), 0) || 30) *
			speed
	);
	let isEdited = false;
	const filterGraph: string[] = [];
	const noAudioFilterGraph: string[] = [];

	if (processOptions.verbose) inputArgs.push('-v', 'verbose');

	// Ensure ffmpeg reads only what it's supposed to
	if (cuts) inputArgs.push('-accurate_seek');

	utils.log(
		`Canvas size: ${canvasWidth}×${canvasHeight} (max inputs' width x height)
Target size: ${targetWidth}×${targetHeight} (crop + rotation)
 Final size: ${finalWidth}×${finalHeight} (target + resize)
Preparing filter graph...`
	);

	/**
	 * Normalize inputs to match each other.
	 *
	 * Dimension normalization:
	 * We determine canvas size, which is the max width × height out of all inputs,
	 * and apply all necessary crops, paddings, and scales as if every input was
	 * contain-stretched into this canvas. This is all designed to introduce the
	 * least amount of filters to produce the requested output, while ensuring
	 * there is at most 1 scale filter per frame.
	 */
	let outputSegments: Segment[] = [];
	let currentTime = 0;
	for (let i = 0; i < inputs.length; i++) {
		const input = inputs[i]!;
		const videoFilters: string[] = [];
		const audioFilters: string[] = [];
		const inputSegments: Segment[] = [];

		utils.log(`==============================
Input[${i}]:
- Path: "${input.path}"
- Duration: ${msToIsoTime(input.duration)}
- Dimensions: ${input.width}×${input.height}${
			input.sar !== 1
				? ` SAR: ${input.sar}
- Display dimensions: ${input.displayWidth}×${input.displayHeight}`
				: ''
		}
- Framerate: ${input.framerate}
- Audio streams: ${input.audioStreams.length}
------`);

		// Determine cuts for this input
		if (cuts) {
			isEdited = true;
			const inputCuts = cutCuts(cuts, [currentTime, currentTime + input.duration], 1000 / input.framerate).map(
				(cut) => cut.map((time) => time - currentTime) as Cut
			);
			currentTime += input.duration;
			const firstCut = inputCuts[0];
			const lastCut = inputCuts.at(-1);

			if (!firstCut || !lastCut) {
				utils.log(`SKIPPING input, no cuts cover this segment.`);
				continue;
			}

			utils.log(`Extracting cuts:`);

			for (const [c, [from, to]] of inputCuts.entries()) {
				const fromIso = msToIsoTime(from);
				const toIso = msToIsoTime(to);

				utils.log(`→ ${c}: ${fromIso} - ${toIso}`);
				ffmpegInputs.push(['-ss', fromIso, '-to', toIso, '-i', input.path]);
				const inputIndex = ffmpegInputs.length - 1;

				const segment: Segment = {
					video: {id: `${inputIndex}:v:0`, meta: input.videoStreams[0]!},
					audio: [],
					duration: to - from,
				};

				if (!stripAudio) {
					for (const [a, audio] of input.audioStreams.entries()) {
						segment.audio.push({id: `${inputIndex}:a:${a}`, meta: audio});
					}
				}

				inputSegments.push(segment);
			}
		} else {
			ffmpegInputs.push(['-i', input.path]);
			const inputIndex = ffmpegInputs.length - 1;
			inputSegments.push({
				video: {id: `${inputIndex}:v:0`, meta: input.videoStreams[0]!},
				audio: input.audioStreams.map((audio, a) => ({id: `${inputIndex}:a:${a}`, meta: audio})),
				duration: input.duration,
			});
		}

		const updateVideoMetas = (meta: Partial<VideoStream>) => {
			for (const segment of inputSegments) segment.video.meta = {...segment.video.meta, ...meta};
		};

		// Add this file to inputs

		// Deinterlace only when needed, or always when requested. This needs to
		// happen because some filters used below can't work with interlaced video.
		videoFilters.push(`yadif=deint=${options.deinterlace ? 'all' : 'interlaced'}`);

		// Set pixel format, forced to yuva420p for GIFs or it removes transparency
		if (options.codec !== 'gif') videoFilters.push(`format=${options.pixelFormat}`);
		else videoFilters.push(`format=yuva420p`);

		// Normalize sar
		// I don't know why inputs that are being reported by ffprobe as already
		// having sar 1 also need to have it forced to 1 for stuff down the line
		// to work, but it is how it is..
		videoFilters.push(`setsar=sar=1`);
		if (input.sar !== 1) isEdited = true;

		// Speed
		if (speed !== 1) {
			if (!(speed >= 0.5 && speed <= 100)) {
				throw new Error(`Speed "${speed}" is outside of allowed range of 0.5-100.`);
			}

			isEdited = true;

			utils.log(`Changing speed to ${speed}x with output framerate of ${outputFramerate}`);

			// Video
			videoFilters.push(`settb=1/${outputFramerate}`, `setpts=PTS/${speed}`, `fps=fps=${outputFramerate}`);

			// Audio
			audioFilters.push(`atempo=${speed}`);

			// Update segment durations
			for (const segment of inputSegments) segment.duration /= speed;
		} else {
			// We ALWAYS add fps filter to ensure all streams have the exact same fps,
			// or it causes anullsrc to generate infinite frames.
			// This is needed because some streams might have fps `24000/1001` and some `23.976024`, which can
			// apparently be a source of issues.
			isEdited = input.framerate !== outputFramerate;
			utils.log(`Setting output framerate to ${outputFramerate}`);
			videoFilters.push(`fps=fps=${outputFramerate}`);
		}

		/**
		 * The area to extract based on crop and resize dimensions.
		 *
		 * Extract region might be bigger than original (negative x & y, or
		 * bigger width & height), in which case it needs to be padded before it
		 * can be cropped.
		 *
		 * All the crop/pad adjustment shenanigans below are so that we only
		 * use a single scale filter per frame.
		 */
		let region: Region = {
			x: 0,
			y: 0,
			width: input.width,
			height: input.height,
			sourceWidth: input.width,
			sourceHeight: input.height,
		};
		const regionAspectRatio = input.width / input.height;

		/**
		 * Applies region extractions.
		 */
		const extractRegion = () => {
			// Pad
			{
				const {x, y, width, height, sourceWidth, sourceHeight} = region;
				if (x < 0 || y < 0 || x + width > sourceWidth || y + height > sourceHeight) {
					const padWidth = max(width, sourceWidth) + abs(x);
					const padHeight = max(height, sourceHeight) + abs(y);
					const padX = max(-x, 0);
					const padY = max(-y, 0);
					utils.log(`Padding: ${padWidth}×${padHeight} @ ${padX}×${padY}`);
					videoFilters.push(`pad=${padWidth}:${padHeight}:${padX}:${padY}`);
					region.sourceWidth = padWidth;
					region.sourceHeight = padHeight;
					updateVideoMetas({width: padWidth, height: padHeight});
					region.x = max(x, 0);
					region.y = max(y, 0);
					isEdited = true;
				}
			}

			// Crop
			{
				const {x, y, width, height, sourceWidth, sourceHeight} = region;
				if (x !== 0 || y !== 0 || width !== sourceWidth || height !== sourceHeight) {
					if (x < 0 || y < 0 || width + x > sourceWidth || height + y > sourceHeight) {
						const json = JSON.stringify(region, null, 2);
						throw new Error(`Can't crop, extract region is invalid: ${json}`);
					}
					utils.log(`Cropping: ${width}×${height} @ ${x}×${y}`);
					videoFilters.push(`crop=${width}:${height}:${x}:${y}`);
					region.sourceWidth = width;
					region.sourceHeight = height;
					updateVideoMetas({width, height});
					region.x = 0;
					region.y = 0;
					isEdited = true;
				}
			}
		};

		// Pad to canvas aspect ratio
		if (abs(canvasAspectRatio - regionAspectRatio) > 0.001) {
			const aspectRatio = region.width / region.height;
			const padAspectRatio = canvasAspectRatio / input.sar;
			let padWidth = padAspectRatio > aspectRatio ? input.height * padAspectRatio : input.width;
			let padHeight = padAspectRatio > aspectRatio ? input.height : input.width / padAspectRatio;
			region.x -= floor((padWidth - region.width) / 2);
			region.y -= floor((padHeight - region.height) / 2);
			region.width = round(padWidth);
			region.height = round(padHeight);
			updateVideoMetas({width: region.width, height: region.height});
		}

		// Crop when requested
		if (crop) {
			const resizedCrop = resizeRegion(crop, region.width, region.height);
			const {x, y, width, height} = resizedCrop;
			region.x += x;
			region.y += y;
			region.width = width;
			region.height = height;
			updateVideoMetas({width, height});
		}

		// Apply initial user defined region extraction
		extractRegion();

		// Rotate
		if (rotate) {
			isEdited = true;

			utils.log(`Rotating: ${rotate} deg`);

			switch (rotate) {
				case 90:
					videoFilters.push('transpose=clock');
					break;

				case 180:
					videoFilters.push('transpose=clock', 'transpose=clock');
					break;

				case 270:
					videoFilters.push('transpose=cclock');
					break;
			}

			if (rotate % 180 === 90) {
				const {width: tmpWidth, sourceWidth: tmpSourceWidth} = region;
				region.width = region.height;
				region.height = tmpWidth;
				region.sourceWidth = region.sourceHeight;
				region.sourceHeight = tmpSourceWidth;
				updateVideoMetas({width: region.height, height: tmpWidth});
			}
		}

		// Satisfy resize configuration
		{
			const config = options.resize;
			const {extract, resize} = makeResize(region, {
				width: config.width,
				height: config.height,
				fit: config.fit,
				pixels: config.pixels,
			});

			if (extract || resize) {
				const {fit: fitConf, width, height, pixels} = options.resize;
				const fit = !width || !height ? 'fill' : fitConf;
				utils.log(
					`Satisfying resize configuration: ${fit} → ${width || '?'}×${height || '?'}${
						pixels ? `, pixels <= ${pixels}` : ''
					}`
				);
			}

			if (extract) {
				region = extract;
				extractRegion();
			}

			if (region.width !== finalWidth || region.height !== finalHeight) {
				utils.log(`Resizing: ${finalWidth}×${finalHeight}`);
				videoFilters.push(
					`scale=${finalWidth}:${finalHeight}:flags=${options.scaler}:force_original_aspect_ratio=disable`,
					`setsar=sar=1`
				);
			}
		}

		for (const [s, segment] of inputSegments.entries()) {
			// Construct normalized video output stream
			const outVideoId = `n_i${i}_s${s}_v`; // normalized input segment video
			const videoLink = `[${segment.video.id}]${videoFilters.join(',')}[${outVideoId}]`;
			filterGraph.push(videoLink);
			noAudioFilterGraph.push(videoLink);

			// Construct normalized audio output streams
			const audioStreams: SegmentAudio[] = [];

			if (!stripAudio) {
				for (let a = 0; a < maxAudioStreams; a++) {
					const audioSegment = segment.audio[a];
					let inStreamId: string;
					const outStreamId = `n_i${i}_s${s}_a${a}`; // normalized input segment audio
					const filters: string[] = [];
					const maxChannelsInStream = inputs.reduce(
						(value, input) => max(input.audioStreams[a]?.channels || 0, value),
						0
					);
					const requiredChannelsCount = Math.min(maxChannelsInStream, options.maxAudioChannels);
					let channels: number;

					if (audioSegment) {
						inStreamId = audioSegment.id;
						channels = audioSegment.meta.channels;
						filters.push(...audioFilters);
					} else {
						const durationSeconds = Math.round(segment.duration / 1e3);
						inStreamId = `silence_i${i}_s${s}_a${a}`;
						filterGraph.push(`anullsrc=duration=${durationSeconds}[${inStreamId}]`);
						channels = 1;
						utils.log(`Filling out missing audio for input[${i}] segment[${s}] audioStream[${a}] with silence.`);
					}

					/**
					 * We convert or normalize audio channels.
					 * This is forced for all layouts above stereo since they are sometimes weird
					 * formats that encoders down the line won't know how to work with.
					 * For example, libopus doesn't know "5.1(side)", but it does know "5.1".
					 * This is multimedia hell.
					 */
					if (requiredChannelsCount !== channels || channels > 2) {
						// We standardize channels limit to one of the layouts supported by vorbis and opus
						const layout = [false, 'mono', 'stereo', '3.0', 'quad', '5.0', '5.1', '6.1', '7.1'][
							requiredChannelsCount
						];
						if (!layout) {
							throw new Error(
								`Unsupported channel limit "${requiredChannelsCount}". Only number in range 1-8 is allowed.`
							);
						}
						// aformats sets its required input format, aresmaple reads it and resamples the audio to match it.
						// ffmpeg filters are an arcane magic.
						filters.push(`aresample`, `aformat=channel_layouts=${layout}`);
					}

					filterGraph.push(`[${inStreamId}]${filters.join(',') || 'anull'}[${outStreamId}]`);
					audioStreams.push({
						id: outStreamId,
						meta: {...audioSegment?.meta, channels: requiredChannelsCount},
					});
				}
			} else {
				utils.log(`Stripping audio`);
			}

			// Add normalized input to current graph outputs
			outputSegments.push({
				video: {id: outVideoId, meta: segment.video.meta},
				audio: audioStreams,
				duration: segment.duration,
			});
		}
	}

	inputArgs.push(...ffmpegInputs.flat());

	utils.log(`==============================`);

	// Concat or rename
	let outputSegment: Segment;
	if (outputSegments.length === 1) {
		outputSegment = outputSegments[0]!;
	} else if (outputSegments.length > 1) {
		isEdited = true;

		// Concatenate
		const firstSegment = outputSegments[0]!;
		let inLinks = '';
		const outVideoId = `concat_v`;
		let outLinks = `[${outVideoId}]`;
		const outAudioStreams: SegmentAudio[] = [];

		for (const {video, audio} of outputSegments) {
			inLinks += `[${video.id}]`;
			for (const {id} of audio) inLinks += `[${id}]`;
		}

		for (let i = 0; i < firstSegment.audio.length; i++) {
			const {channels} = firstSegment.audio[i]!.meta;
			const id = `concat_a${i}`;
			outLinks += `[${id}]`;
			outAudioStreams.push({id, meta: {channels}});
		}

		utils.log(
			`Concatenating ${outputSegments.length} inputs into a single output with 1 video stream and ${maxAudioStreams} audio streams.`
		);
		filterGraph.push(`${inLinks}concat=n=${outputSegments.length}:v=1:a=${firstSegment.audio.length}${outLinks}`);
		noAudioFilterGraph.push(`${inLinks}concat=n=${outputSegments.length}:v=1:a=0[${outVideoId}]`);
		outputSegment = {
			video: {id: outVideoId, meta: firstSegment.video.meta},
			audio: outAudioStreams,
			duration: firstSegment.duration,
		};
	} else {
		throw new Error(`Empty outputs. No input segments?`);
	}

	const postConcatFilters: string[] = [];

	// Flips
	if (flipHorizontal) {
		utils.log(`Flipping horizontally`);
		postConcatFilters.push('hflip');
		isEdited = true;
	}
	if (flipVertical) {
		utils.log(`Flipping vertically`);
		postConcatFilters.push('vflip');
		isEdited = true;
	}

	// Apply post concat filters
	if (postConcatFilters.length > 0) {
		const outStreamId = 'out_v';
		filterGraph.push(`[${outputSegment.video.id}]${postConcatFilters.join(',')}[${outStreamId}]`);
		outputSegment.video.id = outStreamId;
	}

	// Gif palette handling
	if (options.codec === 'gif') {
		const outStreamId = 'palette_out_v';
		utils.log(
			`Generating color palette for gif output with ${options.gif.colors} colors and ${options.gif.dithering} dithering strength.`
		);
		const paletteGenFilterGraph = [
			`[${outputSegment.video.id}]split[pg1][pg2]`,
			`[pg1]palettegen=max_colors=${options.gif.colors}[plt]`,
			`[pg2]fifo[buf]`,
			`[buf][plt]paletteuse=dither=${options.gif.dithering}[${outStreamId}]`,
		];
		filterGraph.push(...paletteGenFilterGraph);
		noAudioFilterGraph.push(...paletteGenFilterGraph);
		outputSegment.video.id = outStreamId;
	}

	// Select streams
	videoArgs.push('-map', `[${outputSegment.video.id}]`);
	for (const {id} of outputSegment.audio) audioArgs.push('-map', `[${id}]`);
	if (includeSubtitles) {
		extraMaps.push('-map', '0:s?');
		extraMaps.push('-map', '0:t?');
	}

	// We need to drop any additional metadata such as chapters when cutting
	// and/or concatenating, or the result will think it's the wrong length.
	if (cuts || inputs.length > 1) {
		extraMaps.push('-dn', '-map_metadata', '-1', '-map_chapters', '-1');

		// Try to recover at least the title metadata
		if (!options.ensureTitle && firstInput.title) extraMaps.push('-metadata', `title=${firstInput.title}`);
	}

	// Ensure title by defaulting to input filename
	if (options.ensureTitle) {
		let title = firstInput.title;
		if (!title) {
			title = Path.basename(firstInput.path, Path.extname(firstInput.path));
			utils.log(`Adding output filename as title meta: "${title}"`);
		}
		extraMaps.push('-metadata', `title=${title}`);
	}

	// Codec params
	let outputFormat: string | undefined;
	const normalizeVideoFormat = (preferred: string) =>
		(includeSubtitles ? 'mkv' : preferred).replace('mkv', 'matroska');
	switch (options.codec) {
		case 'h264':
			outputFormat = normalizeVideoFormat(options.h264.preferredOutputFormat);
			videoArgs.push('-c:v', 'libx264');
			videoArgs.push('-preset', options.h264.preset);
			if (options.h264.tune) videoArgs.push('-tune', options.h264.tune);
			if (options.h264.profile !== 'auto') videoArgs.push('-profile', options.h264.profile);

			// Quality/size control
			switch (options.h264.mode) {
				case 'quality':
					videoArgs.push('-crf', options.h264.crf);
					break;

				case 'bitrate':
					videoArgs.push('-b:v', outputBitrate(options.h264.bitrate));
					if (options.h264.twoPass) twoPass = makeTwoPass(processOptions.id);
					break;

				case 'size':
					videoArgs.push('-b:v', sizeConstrainedVideoBitrate(options.h264.size));
					if (options.h264.twoPass) twoPass = makeTwoPass(processOptions.id);
					break;
			}

			break;

		case 'h265':
			outputFormat = normalizeVideoFormat(options.h265.preferredOutputFormat);
			videoArgs.push('-c:v', 'libx265');
			videoArgs.push('-preset', options.h265.preset);
			if (options.h265.tune) videoArgs.push('-tune', options.h265.tune);
			if (options.h265.profile !== 'auto') videoArgs.push('-profile', options.h265.profile);

			// Quality/size control
			switch (options.h265.mode) {
				case 'quality':
					videoArgs.push('-crf', options.h265.crf);
					break;

				case 'bitrate':
					videoArgs.push('-b:v', outputBitrate(options.h265.bitrate));
					if (options.h265.twoPass) twoPass = makeTwoPassX265(processOptions.id);
					break;

				case 'size':
					videoArgs.push('-b:v', sizeConstrainedVideoBitrate(options.h265.size));
					if (options.h265.twoPass) twoPass = makeTwoPassX265(processOptions.id);
					break;
			}

			break;

		case 'vp8':
			outputFormat = normalizeVideoFormat(options.vp8.preferredOutputFormat);
			videoArgs.push('-c:v', 'libvpx');
			if (options.vp8.speed) videoArgs.push('-speed', options.vp8.speed);

			// Quality/size control
			switch (options.vp8.mode) {
				case 'quality':
					videoArgs.push('-crf', options.vp8.crf);
					videoArgs.push('-qmin', options.vp8.qmin);
					videoArgs.push('-qmax', options.vp8.qmax);
					break;

				case 'bitrate':
					videoArgs.push('-b:v', outputBitrate(options.vp8.bitrate));
					videoArgs.push('-minrate', outputBitrate(options.vp8.minrate));
					videoArgs.push('-maxrate', outputBitrate(options.vp8.maxrate));
					break;

				case 'size': {
					const bitrateUnit = sizeConstrainedVideoBitrate(options.vp8.size);
					videoArgs.push('-minrate', bitrateUnit, '-maxrate', bitrateUnit, '-b:v', bitrateUnit);
					break;
				}
			}

			// Encoding GIFs without this fails, no idea if disabling this is bad,
			// but definitely not as bad as errors.
			videoArgs.push('-auto-alt-ref', 0);

			if (options.vp8.twoPass) twoPass = makeTwoPass(processOptions.id);

			break;

		case 'vp9':
			outputFormat = normalizeVideoFormat(options.vp9.preferredOutputFormat);
			videoArgs.push('-c:v', 'libvpx-vp9');
			videoArgs.push('-quality', 'good');

			// Quality/size control
			switch (options.vp9.mode) {
				case 'quality':
					videoArgs.push('-crf', options.vp9.crf, '-b:v', 0);
					videoArgs.push('-qmin', options.vp9.qmin);
					videoArgs.push('-qmax', options.vp9.qmax);
					break;

				case 'constrained-quality':
					videoArgs.push('-crf', options.vp9.crf, '-b:v', outputBitrate(options.vp9.bitrate));
					break;

				case 'bitrate':
					videoArgs.push('-b:v', outputBitrate(options.vp9.bitrate));
					videoArgs.push('-minrate', outputBitrate(options.vp9.minrate));
					videoArgs.push('-maxrate', outputBitrate(options.vp9.maxrate));
					break;

				case 'lossless':
					videoArgs.push('-lossless', 1);
					break;

				case 'size': {
					const bitrateUnit = sizeConstrainedVideoBitrate(options.vp9.size);
					videoArgs.push('-b:v', bitrateUnit, '-minrate', bitrateUnit, '-maxrate', bitrateUnit);
					break;
				}
			}

			// Multithreading
			if (options.vp9.threads > 1) {
				videoArgs.push('-threads', options.vp9.threads);
				videoArgs.push('-tile-columns', options.vp9.threads);
			}

			if (options.vp9.twoPass) {
				twoPass = makeTwoPass(processOptions.id);
				twoPass.args[0].push('-speed', 4);
				twoPass.args[1].push('-speed', options.vp9.speed);
			} else {
				videoArgs.push('-speed', options.vp9.speed);
			}

			break;

		case 'av1':
			outputFormat = normalizeVideoFormat(options.av1.preferredOutputFormat);
			videoArgs.push('-c:v', 'libsvtav1');

			const svtav1Params: string[] = [];

			// Preset
			svtav1Params.push(`preset=${options.av1.preset}`);

			// Quality/size control
			switch (options.av1.mode) {
				case 'crf':
					svtav1Params.push(`crf=${options.av1.crf}`);
					if (options.av1.maxBitrate) svtav1Params.push(`mbr=${outputBitrate(options.av1.maxBitrate)}`);
					break;

				case 'vbr':
				case 'cbr':
				case 'size': {
					svtav1Params.push(`rc=${options.av1.mode === 'cbr' ? '2' : '1'}`);
					svtav1Params.push(`min-qp=${options.av1.minQp}`);
					svtav1Params.push(`max-qp=${options.av1.maxQp}`);

					if (options.av1.mode === 'size') {
						svtav1Params.push(`tbr=${sizeConstrainedVideoBitrate(options.vp9.size)}`);
					} else {
						svtav1Params.push(`tbr=${outputBitrate(options.av1.targetBitrate)}`);
					}

					// Enable 2-pass encoding
					if (options.av1.twoPass) twoPass = makeTwoPass(processOptions.id);

					break;
				}
			}

			// Keyframe interval
			svtav1Params.push(`keyint=${Math.round(outputFramerate * options.av1.keyframeInterval)}`);
			if (options.av1.sceneDetection) svtav1Params.push('scd=1');

			// Film grain synthesis
			if (options.av1.filmGrainSynthesis > 0) svtav1Params.push(`film-grain=${options.av1.filmGrainSynthesis}`);

			videoArgs.push('-svtav1-params', svtav1Params.join(':'));
			break;

		case 'gif':
			outputFormat = 'gif';
			break;

		default:
			throw new Error(`Unknown codec "${options.codec}".`);
	}

	// Audio
	if (stripAudio) {
		audioArgs.push('-an');
	} else {
		audioArgs.push('-c:a', options.audioCodec === 'vorbis' ? 'libvorbis' : 'libopus');

		for (let i = 0; i < outputSegment.audio.length; i++) {
			const {channels} = outputSegment.audio[i]!.meta;
			const streamIndex = i + 1; // video stream is first, so the audio stream index is shifter by 1
			audioArgs.push(`-b:${streamIndex}`, `${options.audioChannelBitrate * channels}k`);
		}
	}

	if (twoPass) {
		utils.stage('PASS 1');

		const filterArgs = ['-filter_complex', noAudioFilterGraph.join(';')];

		// First pass to null with no audio
		await ffmpeg(
			ffmpegPath,
			[
				...inputArgs,
				...filterArgs,
				...videoArgs,
				...twoPass.args[0],
				'-an',
				'-f',
				'null',
				IS_WIN ? 'NUL' : '/dev/null',
			],
			{...processOptions, onLog: utils.log, onProgress: utils.progress, expectedDuration: outputSegment.duration}
		);

		// Enable second pass for final encode
		outputArgs.push(...twoPass.args[1]);
		utils.stage('PASS 2');
	}

	// Enforce output type
	outputArgs.push('-f', outputFormat);

	// Calculate KBpMPX and check if we can skip encoding this file
	const skipThreshold = options.skipThreshold;
	let totalInputSize = inputs.reduce((size, input) => size + input.size, 0);

	// SkipThreshold should only apply when no editing is going to happen
	if (skipThreshold && !isEdited) {
		const KB = totalInputSize / 1024;
		const MPX = (targetWidth * targetHeight) / 1e6;
		const minutes = outputSegment.duration / 1000 / 60;
		const KBpMPXpM = KB / MPX / minutes;

		if (skipThreshold && skipThreshold > KBpMPXpM) {
			const message = `Video's ${Math.round(
				KBpMPXpM
			)} KB/Mpx/m bitrate is smaller than skip threshold (${skipThreshold}), skipping encoding.`;

			utils.log(message);
			utils.output.file(firstInput.path, {
				flair: {variant: 'warning', title: 'skipped', description: message},
			});

			return;
		}
	}

	// Finally, encode the file
	const filterArgs = ['-filter_complex', filterGraph.join(';')];
	await runFFmpegAndCleanup({
		ffmpegPath,
		inputPaths: inputs.map(({path}) => path),
		inputSize: totalInputSize,
		expectedDuration: outputSegment.duration,
		args: [...inputArgs, ...filterArgs, ...videoArgs, ...audioArgs, ...extraMaps, ...outputArgs],
		codec: options.codec,
		outputExtension: outputFormat === 'matroska' ? 'mkv' : outputFormat,
		savingOptions,
		minSavings: isEdited ? 0 : options.minSavings,
		...processOptions,
	});

	// Cleanup 2 pass log files
	if (twoPass) {
		for (const filePath of twoPass.logFiles) {
			try {
				utils.log(`Deleting: ${filePath}`);
				await FSP.rm(filePath, {recursive: true});
			} catch (error) {
				utils.log(eem(error));
			}
		}
	}

	/**
	 * Scoped helper functions.
	 */

	/**
	 * Calculates actual output bitrate based on relative bitrate (Kb/Mpx/s) and
	 * output dimensions.
	 */
	function outputBitrate(relativeBitrate: number) {
		const bitrate = Math.round(relativeBitrate * ((targetWidth * targetHeight) / 1e6));
		return `${bitrate}k`;
	}

	/**
	 * Calculates bitrate for video track to satisfy max file size constraints
	 * `size` is a float of megabytes.
	 */
	function sizeConstrainedVideoBitrate(size: number) {
		const targetSize = size * 1024 * 1024;
		const durationSeconds = outputSegment.duration / 1000;
		let audioSize = 0;

		// Estimate audio size
		for (const {meta} of outputSegment.audio) {
			audioSize += meta.channels * (options.audioChannelBitrate * 1024) * durationSeconds;
		}

		if (audioSize >= targetSize) {
			throw new MessageError(
				`Can't satisfy size constraint, audio track alone is going to be bigger than ${formatSize(
					targetSize
				)}B.`
			);
		}

		const bitrate = ((targetSize - audioSize) / durationSeconds) * 8;

		if (!Number.isFinite(bitrate) || bitrate <= 0) {
			throw new MessageError(`Size constrained bitrate calculation produced an invalid number. Used variables:
(${targetSize} - ${audioSize}) / ${durationSeconds} = ${bitrate}
---------------------------------------------
(targetSize - audioSize) / duration = bitrate`);
		}

		if (bitrate < 1024) {
			throw new MessageError(
				`To satisfy the ${formatSize(targetSize)} size constraint, the resulting bitrate of ${formatSize(
					bitrate
				)}Bps would be unreasonably small.`
			);
		}

		return `${Math.round(bitrate / 1024)}k`;
	}
}
