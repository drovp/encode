import * as OS from 'os';
import * as Path from 'path';
import {promises as FSP} from 'fs';
import {ffmpeg, runFFmpegAndCleanup} from './ffmpeg';
import {makeResize, ResizeOptions} from './dimensions';
import {formatSize, eem, MessageError, resizeRegion, countCutsDuration, cutCuts, msToIsoTime} from './utils';
import {VideoMeta} from 'ffprobe-normalized';
import {SaveAsPathOptions} from '@drovp/save-as-path';
import {ProcessorUtils} from '@drovp/types';

const {round, max, abs} = Math;

const IS_WIN = process.platform === 'win32';

export interface TwoPassData {
	args: [(string | number)[], (string | number)[]];
	logFiles: string[];
}

interface AudioStream {
	name: string;
	channels: number;
}

interface GraphOutput {
	video: string;
	audio: AudioStream[];
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

	const inputArgs: (string | number)[] = [];
	const videoArgs: (string | number)[] = [];
	const audioArgs: (string | number)[] = [];
	const extraMaps: (string | number)[] = [];
	const outputArgs: (string | number)[] = [];
	const {crop, cuts, flipVertical, flipHorizontal, rotate, speed} = options;
	const includeSubtitles =
		!options.stripSubtitles && !cuts && inputs.length === 1 && firstInput.subtitlesStreams.length > 0;
	const minAudioStreams = inputs.reduce(
		(count, input) => (input.audioStreams.length < count ? input.audioStreams.length : count),
		firstInput.audioStreams.length
	);
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
	let totalSize = inputs.reduce((size, input) => size + input.size, 0);
	const totalDuration =
		(cuts ? countCutsDuration(cuts) : inputs.reduce((duration, input) => duration + input.duration, 0)) / speed;
	let outputFramerate = Math.min(
		options.maxFps || Infinity,
		(inputs.reduce((framerate, input) => (input.framerate > framerate ? input.framerate : framerate), 0) || 30) *
			speed
	);
	let preventSkipThreshold = false;
	let silentAudioStreamIndex = 0;
	const filterGroups: string[] = [];
	const noAudioFilterGroups: string[] = [];

	if (processOptions.verbose) inputArgs.push('-v', 'verbose');

	// Ensure ffmpeg reads only what it's supposed to
	if (cuts) inputArgs.push('-accurate_seek');

	utils.log(
		`Canvas size: ${canvasWidth}×${canvasHeight} (max inputs' width x height)
Target size: ${targetWidth}×${targetHeight} (crop + rotation)
 Final size: ${finalWidth}×${finalHeight} (target + resize)
Preparing filter graph...`
	);

	// Inputs
	let currentInputIndex = 0;

	// Add silent audio stream to fill audio gaps in concatenation
	if (maxAudioStreams > minAudioStreams) {
		silentAudioStreamIndex = currentInputIndex++;
		inputArgs.push('-f', 'lavfi', '-i', 'anullsrc=d=0.1');
	}

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
	let graphOutputs: GraphOutput[] = [];
	let currentTime = 0;
	for (let i = 0; i < inputs.length; i++) {
		const input = inputs[i]!;
		const inputIndex = currentInputIndex++;
		const videoFilters: string[] = [];
		const audioFilters: string[] = [];

		utils.log(`==============================
Input[${i}]:
- Path: "${input.path}"
- Duration: ${msToIsoTime(input.duration)}
- Framerate: ${input.framerate}
- Dimensions: ${input.width}×${input.height}${
			input.sar !== 1
				? ` SAR: ${input.sar}
- Display dimensions: ${input.displayWidth}×${input.displayHeight}`
				: ''
		}
- Audio streams: ${input.audioStreams.length}
------`);

		let betweens: false | string = false;
		let seekStart: number | undefined;
		let seekDuration: number | undefined;

		// Determine cuts for this input
		if (cuts) {
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

			// We adjust initial seek range and cuts accordingly, otherwise
			// ffmpeg will read the whole file.
			const firstStart = firstCut[0];
			seekStart = firstStart;
			seekDuration = lastCut[1] - firstStart;
			const seekAdjustedInputCuts = inputCuts.map(([from, to]) => [from - firstStart, to - firstStart] as Cut);

			const roundDecimals = (value: number) => round(value * 1e6) / 1e6;
			betweens = seekAdjustedInputCuts
				.map(([from, to]) => `between(t,${roundDecimals(from / 1e3)},${roundDecimals(to / 1e3)})`)
				.join('+');
			utils.log(
				`Extracting cuts: ${inputCuts.map(
					([from, to], i) => `\n ${i}: ${msToIsoTime(from)} - ${msToIsoTime(to)}`
				)}`
			);
		}

		// Tell ffmpeg what portion of the input we're interested in
		if (seekStart) inputArgs.push('-ss', msToIsoTime(seekStart));
		if (seekDuration) inputArgs.push('-t', msToIsoTime(seekDuration));

		// Add this file to inputs
		// We force the framerate to override potential weirdness that might come out of some containers.
		// - Without this, some files with weird framerate meta cause encoders to error out or produce invalid video.
		inputArgs.push('-i', input.path);

		// Apply cuts to video input
		if (betweens) {
			preventSkipThreshold = true;
			videoFilters.push(`select='${betweens}'`, `setpts=N/FRAME_RATE/TB`);
			audioFilters.push(`aselect='${betweens}'`, `asetpts=N/SR/TB`);
		}

		// Deinterlace only when needed, or always when requested. This needs to
		// happen because some filters used below can't work with interlaced video.
		videoFilters.push(`yadif=deint=${options.deinterlace ? 'all' : 'interlaced'}`);

		// Set pixel format, forced to yuva420p for GIFs or it removes transparency
		if (options.codec !== 'gif') videoFilters.push(`format=${options.pixelFormat}`);
		else videoFilters.push(`format=yuva420p`);

		// Normalize sar
		// I don't know why inputs that are being reported by ffprobe as already
		// having sar 1 also need to have it forced to 1 here for stuff down the
		// line to work, but that's how it is..
		videoFilters.push(`setsar=sar=1`);
		if (input.sar !== 1) preventSkipThreshold = true;

		// Speed
		if (speed !== 1) {
			if (!(speed >= 0.5 && speed <= 100)) {
				throw new Error(`Speed "${speed}" is outside of allowed range of 0.5-100.`);
			}

			preventSkipThreshold = true;

			utils.log(`Changing speed to ${speed}x with output framerate of ${outputFramerate}`);

			// Video
			videoFilters.push(`settb=1/${outputFramerate}`, `setpts=PTS/${speed}`, `fps=fps=${outputFramerate}`);

			// Audio
			audioFilters.push(`atempo=${speed}`);
		} else if (input.framerate !== outputFramerate) {
			preventSkipThreshold = true;
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
					region.x = max(x, 0);
					region.y = max(y, 0);
					preventSkipThreshold = true;
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
					region.x = 0;
					region.y = 0;
					preventSkipThreshold = true;
				}
			}
		};

		// Pad to canvas size
		if (abs(canvasAspectRatio - regionAspectRatio) > 0.001) {
			const aspectRatio = region.width / region.height;
			const padAspectRatio = canvasAspectRatio / input.sar;
			let padWidth = padAspectRatio > aspectRatio ? input.height * padAspectRatio : input.width;
			let padHeight = padAspectRatio > aspectRatio ? input.height : input.width / padAspectRatio;
			region.x -= round((padWidth - region.width) / 2);
			region.y -= round((padHeight - region.height) / 2);
			region.width = round(padWidth);
			region.height = round(padHeight);
		}

		// Crop when requested
		if (crop) {
			const resizedCrop = resizeRegion(crop, region.width, region.height);
			const {x, y, width, height} = resizedCrop;
			region.x += x;
			region.y += y;
			region.width = width;
			region.height = height;
		}

		// Apply initial user defined region extraction
		extractRegion();

		// Rotate
		if (rotate) {
			preventSkipThreshold = true;

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

		// Construct normalized video output stream
		const outVideoStreamName = `[nv${i}]`;
		const videoLink = `[${inputIndex}:v:0]${videoFilters.join(',')}${outVideoStreamName}`;
		filterGroups.push(videoLink);
		noAudioFilterGroups.push(videoLink);

		// Construct normalized audio output streams
		const audioStreams: AudioStream[] = [];

		if (!stripAudio) {
			for (let a = 0; a < maxAudioStreams; a++) {
				const streamMeta = input.audioStreams[a];
				let inStream: string;
				const outStreamName = `[na${i}-${a}]`;
				const filters: string[] = [];
				const maxChannelsInStream = inputs.reduce(
					(value, input) => max(input.audioStreams[a]?.channels || 0, value),
					0
				);
				const channelsLimit = Math.min(maxChannelsInStream, options.maxAudioChannels);
				let channels: number;

				if (streamMeta) {
					inStream = `[${inputIndex}:a:${a}]`;
					channels = streamMeta.channels;
					filters.push(...audioFilters);
				} else {
					inStream = `[${silentAudioStreamIndex}:a:0]`;
					channels = 1;
					utils.log(`Filling out missing audio for input["${i}"] audio stream "${a}" with silence.`);
				}

				/**
				 * We convert or normalize audio channels.
				 * This is forced for all layouts above stereo since they are sometimes weird
				 * formats that encoders down the line won't know how to work with.
				 * For example, libopus doesn't know "5.1(side)", but it does know "5.1".
				 * This is multimedia hell.
				 */
				if (channelsLimit !== channels || channels > 2) {
					// We standardize channels limit to one of the layouts supported by vorbis and opus
					const layout = [false, 'mono', 'stereo', '3.0', 'quad', '5.0', '5.1', '6.1', '7.1'][channelsLimit];
					if (!layout) {
						throw new Error(
							`Unsupported channel limit "${channelsLimit}". Only number in range 1-8 is allowed.`
						);
					}
					// aformats sets its required input format, aresmaple reads it and resamples the audio to match it.
					// ffmpeg filters are an arcane magic.
					filters.push(`aresample`, `aformat=channel_layouts=${layout}`);
				}

				filterGroups.push(`${inStream}${filters.join(',') || 'anull'}${outStreamName}`);
				audioStreams.push({name: outStreamName, channels: channelsLimit});
			}
		} else {
			utils.log(`Stripping audio`);
		}

		// Add normalized input to current graph outputs
		graphOutputs.push({video: outVideoStreamName, audio: audioStreams});
	}

	utils.log(`==============================`);

	// Concat or rename
	let graphOutput: GraphOutput;
	if (graphOutputs.length === 1) {
		graphOutput = graphOutputs[0]!;
	} else if (graphOutputs.length > 1) {
		preventSkipThreshold = true;

		// Concatenate
		const firstStream = graphOutputs[0]!;
		let inLinks = '';
		const outVideoLink = `[cv]`;
		let outLinks = outVideoLink;
		const outAudioStreams: AudioStream[] = [];

		for (const {video, audio} of graphOutputs) {
			inLinks += video;
			for (const {name} of audio) inLinks += name;
		}

		for (let i = 0; i < firstStream.audio.length; i++) {
			const {channels} = firstStream.audio[i]!;
			const name = `[ca${i}]`;
			outLinks += name;
			outAudioStreams.push({name, channels});
		}

		utils.log(
			`Concatenating ${graphOutputs.length} inputs into a single output with 1 video stream and ${maxAudioStreams} audio streams.`
		);
		filterGroups.push(`${inLinks}concat=n=${graphOutputs.length}:v=1:a=${firstStream.audio.length}${outLinks}`);
		noAudioFilterGroups.push(`${inLinks}concat=n=${graphOutputs.length}:v=1:a=0${outVideoLink}`);
		graphOutput = {
			video: outVideoLink,
			audio: outAudioStreams,
		};
	} else {
		throw new Error(`Empty graph outputs. No inputs?`);
	}

	const postConcatFilters: string[] = [];

	// Flips
	if (flipHorizontal) {
		utils.log(`Flipping horizontally`);
		postConcatFilters.push('hflip');
		preventSkipThreshold = true;
	}
	if (flipVertical) {
		utils.log(`Flipping vertically`);
		postConcatFilters.push('vflip');
		preventSkipThreshold = true;
	}

	// Apply post concat filters
	if (postConcatFilters.length > 0) {
		const inStream = graphOutput.video;
		const outStream = '[ov]';
		filterGroups.push(`${inStream}${postConcatFilters.join(',')}${outStream}`);
		graphOutput.video = outStream;
	}

	// Gif palette handling
	if (options.codec === 'gif') {
		const inStream = graphOutput.video;
		const outStream = '[pgv]';
		utils.log(
			`Generating color palette for gif output with ${options.gif.colors} colors and ${options.gif.dithering} dithering strength.`
		);
		const paletteGenFilterGroups = [
			`${inStream}split[pg1][pg2]`,
			`[pg1]palettegen=max_colors=${options.gif.colors}[plt]`,
			`[pg2]fifo[buf]`,
			`[buf][plt]paletteuse=dither=${options.gif.dithering}${outStream}`,
		];
		filterGroups.push(...paletteGenFilterGroups);
		noAudioFilterGroups.push(...paletteGenFilterGroups);
		graphOutput.video = outStream;
	}

	// Select streams
	videoArgs.push('-map', graphOutput.video);
	for (const {name} of graphOutput.audio) audioArgs.push('-map', name);
	if (includeSubtitles) {
		extraMaps.push('-map', '0:s?');
		extraMaps.push('-map', '0:t?');
	}

	// We need to drop any additional metadata such as chapters when cutting
	// and/or concatenating, or the result will think it's the wrong length.
	if (cuts || inputs.length > 1) {
		extraMaps.push('-dn', '-map_metadata', '-1');

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

		for (let i = 0; i < graphOutput.audio.length; i++) {
			const {channels} = graphOutput.audio[i]!;
			const streamIndex = i + 1; // video stream is first, so the audio stream index is shifter by 1
			audioArgs.push(`-b:${streamIndex}`, `${options.audioChannelBitrate * channels}k`);
		}
	}

	if (twoPass) {
		utils.stage('PASS 1');

		const filterArgs = ['-filter_complex', noAudioFilterGroups.join(';')];

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
			{...processOptions, onLog: utils.log, onProgress: utils.progress, expectedDuration: totalDuration}
		);

		// Enable second pass for final encode
		outputArgs.push(...twoPass.args[1]);
		utils.stage('PASS 2');
	}

	// Enforce output type
	outputArgs.push('-f', outputFormat);

	// Calculate KBpMPX and check if we can skip encoding this file
	const skipThreshold = options.skipThreshold;

	// SkipThreshold should only apply when no editing is going to happen
	if (skipThreshold && !preventSkipThreshold) {
		const KB = totalSize / 1024;
		const MPX = (targetWidth * targetHeight) / 1e6;
		const minutes = totalDuration / 1000 / 60;
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
	const filterArgs = ['-filter_complex', filterGroups.join(';')];
	await runFFmpegAndCleanup({
		ffmpegPath,
		inputPaths: inputs.map(({path}) => path),
		inputSize: totalSize,
		expectedDuration: totalDuration,
		args: [...inputArgs, ...filterArgs, ...videoArgs, ...audioArgs, ...extraMaps, ...outputArgs],
		codec: options.codec,
		outputExtension: outputFormat === 'matroska' ? 'mkv' : outputFormat,
		savingOptions,
		minSavings: options.minSavings,
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
		const durationSeconds = totalDuration / 1000;
		let audioSize = 0;

		// Estimate audio size
		for (const stream of graphOutput.audio) {
			audioSize += stream.channels * (options.audioChannelBitrate * 1024) * durationSeconds;
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
