import * as OS from 'os';
import * as Path from 'path';
import {promises as FSP} from 'fs';
import {ffmpeg, runFFmpegAndCleanup} from './ffmpeg';
import {resizeDimensions, ResizeDimensionsOptions} from './dimensions';
import {formatSize, eem, MessageError, resizeCrop, countCutsDuration} from './utils';
import {VideoMeta} from 'ffprobe-normalized';
import {SaveAsPathOptions} from '@drovp/save-as-path';
import {ProcessorUtils} from '@drovp/types';

const {round} = Math;

const IS_WIN = process.platform === 'win32';

export interface TwoPassData {
	args: [(string | number)[], (string | number)[]];
	logFiles: string[];
}

export interface VideoOptions {
	dimensions: ResizeDimensionsOptions;

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
	};

	gif: {
		colors: number;
		dithering: 'none' | 'bayer' | 'sierra2_4a';
	};

	speed: number;
	maxFps: number;
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
	crop?: Crop;
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
	const includeSubtitles = inputs.length === 1 && firstInput.subtitlesStreams.length > 0 && !options.stripSubtitles;
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
	let maxDisplayWidth = inputs.reduce(
		(displayWidth, input) => (input.displayWidth > displayWidth ? input.displayWidth : displayWidth),
		0
	);
	let maxDisplayHeight = inputs.reduce(
		(displayHeight, input) => (input.displayHeight > displayHeight ? input.displayHeight : displayHeight),
		0
	);
	let [outputWidth, outputHeight] = resizeDimensions(
		options.crop?.width ?? maxDisplayWidth,
		options.crop?.height ?? maxDisplayHeight,
		options.dimensions
	);
	let totalSize = inputs.reduce((size, input) => size + input.size, 0);
	let totalDuration = inputs.reduce((duration, input) => duration + input.duration, 0);
	let outputFramerate = Math.min(
		options.maxFps || Infinity,
		inputs.reduce((framerate, input) => (input.framerate > framerate ? input.framerate : framerate), 0) || 30
	);
	let preventSkipThreshold = false;
	let outputFormat: string | undefined;
	let silentAudioStreamIndex = 0;
	const filterGroups: string[] = [];
	let videoOutputStream: string = '0:v:0';
	type AudioOutputStream = {name: string; channels: number};
	let audioOutputStreams: AudioOutputStream[] = [];

	if (processOptions.verbose) inputArgs.push('-v', 'verbose');

	// Inputs
	let inputIndex = 0;
	for (const input of inputs) {
		inputArgs.push('-i', input.path);
		inputIndex++;
	}

	// Add silent audio stream to fill audio gaps in concatenation
	if (maxAudioStreams > 0 && maxAudioStreams > minAudioStreams) {
		silentAudioStreamIndex = inputIndex;
		inputArgs.push('-f', 'lavfi', '-i', 'anullsrc=d=0.1');
	}

	// Normalize video inputs to match each other
	const normalizedStreams: string[] = [];
	for (let i = 0; i < inputs.length; i++) {
		const input = inputs[i]!;
		const filters: string[] = [];
		let currentWidth = input.width;
		let currentHeight = input.height;

		// Deinterlace only when needed, or always when requested
		filters.push(`yadif=deint=${options.deinterlace ? 'all' : 'interlaced'}`);

		// Set pixel format, ignored for gif or it removes transparency
		if (options.codec !== 'gif') filters.push(`format=${options.pixelFormat}`);
		else filters.push(`format=yuva420p`);

		// Pad the input to match maxDisplay dimensions, but adjusted to its
		// sar, since that is going to get normalized below during resizing
		if (input.width !== maxDisplayWidth || input.height !== maxDisplayHeight) {
			const aspectRatio = input.width / input.height;
			const padAspectRatio = maxDisplayWidth / maxDisplayHeight / input.sar;
			let padWidth = padAspectRatio > aspectRatio ? round(input.height * padAspectRatio) : input.width;
			let padHeight = padAspectRatio > aspectRatio ? input.height : round(input.width / padAspectRatio);

			// Ensure pad is bigger and even, otherwise I was getting "pad can't
			// be smaller than input" errors when both input and pad dimensions
			// were equal and odd, which is odd...
			if (padWidth % 2 !== 0) padWidth += 1;
			if (padHeight % 2 !== 0) padHeight += 1;

			filters.push(`pad=${padWidth}:${padHeight}:-2:-2`);
			currentWidth = padWidth;
			currentHeight = padHeight;
			preventSkipThreshold = true;
		}

		// Crop
		if (crop) {
			const resizedCrop = resizeCrop(crop, currentWidth, currentHeight);
			let {x, y, width, height} = resizedCrop;
			filters.push(`crop=${width}:${height}:${x}:${y}`);
			currentWidth = width;
			currentHeight = height;
			preventSkipThreshold = true;
		}

		// Resize
		if (currentWidth !== outputWidth || currentHeight !== outputHeight) {
			filters.push(
				`scale=${outputWidth}:${outputHeight}:flags=${options.scaler}:force_original_aspect_ratio=disable`
			);
			currentWidth = outputWidth;
			currentHeight = outputHeight;
			preventSkipThreshold = true;
		}

		// Normalize sar
		// I don't know why inputs that are being reported by ffprobe as already
		// having sar 1 also need to have it forced to 1 here for stuff down the
		// line to work, but that's how it is..
		filters.push(`setsar=sar=1`);
		if (input.sar !== 1) preventSkipThreshold = true;

		// Adjust framerate
		if (input.framerate !== outputFramerate) {
			preventSkipThreshold = true;
			filters.push(`framerate=${outputFramerate}`);
		}

		const outStreamName = `[nl${i}]`;
		filterGroups.push(`[${i}:v:0]${filters.join(',')}${outStreamName}`);
		normalizedStreams.push(outStreamName);
	}

	// Concat or rename
	if (normalizedStreams.length === 1) {
		// Set output streams
		videoOutputStream = normalizedStreams[0]!;
		audioOutputStreams = stripAudio
			? []
			: firstInput.audioStreams.map((stream, index) => ({
					name: `0:a:${index}`,
					channels: stream.channels,
			  }));
	} else {
		preventSkipThreshold = true;

		// Concatenate
		let inLinks = '';
		for (let i = 0; i < inputs.length; i++) {
			const input = inputs[i]!;
			inLinks += normalizedStreams[i];
			if (!stripAudio) {
				for (let a = 0; a < maxAudioStreams; a++) {
					inLinks += a < input.audioStreams.length ? `[${i}:a:${a}]` : `[${silentAudioStreamIndex}:a:0]`;
				}
			}
		}

		if (stripAudio) {
			audioOutputStreams = [];
		} else {
			for (let a = 0; a < maxAudioStreams; a++) {
				audioOutputStreams.push({
					name: `[ca${a}]`,
					channels: inputs.reduce((channels, input) => {
						const streamChannels = input.audioStreams[a]?.channels;
						return streamChannels != null && streamChannels > channels ? streamChannels : channels;
					}, 2),
				});
			}
		}

		videoOutputStream = '[cv]';
		let outLinks = `${videoOutputStream}${audioOutputStreams.map(({name}) => name).join('')}`;
		filterGroups.push(`${inLinks}concat=n=${inputs.length}:v=1:a=${audioOutputStreams.length}${outLinks}`);
	}

	const postConcatFilters: string[] = [];

	// Cuts
	if (cuts) {
		const betweens = cuts.map(([from, to]) => `between(t,${from / 1000},${to / 1000})`).join('+');

		// Video
		postConcatFilters.push(`select='${betweens}'`, `setpts=N/FRAME_RATE/TB`);

		// Audio
		if (!stripAudio && audioOutputStreams.length > 0) {
			const newAudioOutputStreams: AudioOutputStream[] = [];

			for (let i = 0; i < audioOutputStreams.length; i++) {
				const {name, channels} = audioOutputStreams[i]!;
				const newName = `[cuta${i}]`;
				const labelName = name.startsWith('[') ? name : `[${name}]`;
				filterGroups.push(`${labelName}aselect='${betweens}',asetpts=N/SR/TB${newName}`);
				newAudioOutputStreams.push({name: newName, channels});
			}

			audioOutputStreams = newAudioOutputStreams;
		}

		totalDuration = countCutsDuration(cuts);
	}

	// Speed
	if (speed !== 1) {
		if (!(speed >= 0.5 && speed <= 100)) {
			throw new Error(`Speed "${speed}" is outside of allowed range of 0.5-100.`);
		}

		preventSkipThreshold = true;

		// Video
		outputFramerate = Math.min(options.maxFps || Infinity, outputFramerate * speed);
		postConcatFilters.push(`settb=1/${outputFramerate}`, `setpts=PTS/${speed}`, `fps=fps=${outputFramerate}`);

		// Audio
		if (!stripAudio && audioOutputStreams.length > 0) {
			const newAudioOutputStreams: AudioOutputStream[] = [];

			for (let i = 0; i < audioOutputStreams.length; i++) {
				const {name, channels} = audioOutputStreams[i]!;
				const newName = `[tempoa${i}]`;
				const labelName = name.startsWith('[') ? name : `[${name}]`;
				filterGroups.push(`${labelName}atempo=${speed}${newName}`);
				newAudioOutputStreams.push({name: newName, channels});
			}

			audioOutputStreams = newAudioOutputStreams;
		}

		totalDuration /= speed;
	}

	// Rotate
	if (rotate) {
		const tmpOutputWidth = outputWidth;
		preventSkipThreshold = true;

		switch (rotate) {
			case 90:
				postConcatFilters.push('transpose=clock');
				outputWidth = outputHeight;
				outputHeight = tmpOutputWidth;
				break;

			case 180:
				postConcatFilters.push('transpose=clock', 'transpose=clock');
				break;

			case 270:
				postConcatFilters.push('transpose=cclock');
				outputWidth = outputHeight;
				outputHeight = tmpOutputWidth;
				break;
		}
	}

	// Flips
	if (flipHorizontal) {
		postConcatFilters.push('hflip');
		preventSkipThreshold = true;
	}
	if (flipVertical) {
		postConcatFilters.push('vflip');
		preventSkipThreshold = true;
	}

	// Apply post concat filters
	if (postConcatFilters.length > 0) {
		const inStream = videoOutputStream;
		videoOutputStream = '[ov]';
		filterGroups.push(`${inStream}${postConcatFilters.join(',')}${videoOutputStream}`);
	}

	// Gif palette handling
	if (options.codec === 'gif') {
		const inStream = videoOutputStream;
		videoOutputStream = '[pgv]';
		filterGroups.push(
			`${inStream}split[pg1][pg2]`,
			`[pg1]palettegen=max_colors=${options.gif.colors}[plt]`,
			`[pg2]fifo[buf]`,
			`[buf][plt]paletteuse=dither=${options.gif.dithering}${videoOutputStream}`
		);
	}

	// Apply filters
	inputArgs.push('-filter_complex', filterGroups.join(';'));

	// Ensure title
	if (options.ensureTitle) {
		const filename = Path.basename(firstInput.path, Path.extname(firstInput.path));
		if (!firstInput.title) inputArgs.push('-metadata', `title=${filename}`);
	}

	// Select streams
	videoArgs.push('-map', videoOutputStream);
	if (!stripAudio) {
		for (const {name} of audioOutputStreams) audioArgs.push('-map', name);
	}
	if (includeSubtitles) {
		extraMaps.push('-map', '0:s?');
		extraMaps.push('-map', '0:t?');
	}

	// Codec params
	switch (options.codec) {
		case 'h264':
			outputFormat = includeSubtitles ? 'matroska' : 'mp4';
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
			outputFormat = includeSubtitles ? 'matroska' : 'mp4';
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
			outputFormat = includeSubtitles ? 'matroska' : 'webm';
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
			outputFormat = includeSubtitles ? 'matroska' : 'webm';
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
			outputFormat = includeSubtitles ? 'matroska' : 'mp4';
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
					break;
				}
			}

			// Enable 2-pass encoding
			if (options.av1.twoPass) twoPass = makeTwoPass(processOptions.id);

			// Keyframe interval
			svtav1Params.push(`keyint=${Math.round(outputFramerate * options.av1.keyframeInterval)}`);
			if (options.av1.sceneDetection) svtav1Params.push('scd=1');

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
		audioArgs.push('-c:a', 'libopus');

		for (let i = 0; i < audioOutputStreams.length; i++) {
			const {name, channels} = audioOutputStreams[i]!;
			const channelsLimit = Math.min(channels, options.maxAudioChannels);
			if (channels > channelsLimit) audioArgs.push(`-ac:${name}`, channelsLimit);
			// Video stream is first, so the audio stream index is shifter by 1
			const streamIndex = i + 1;
			audioArgs.push(`-b:${streamIndex}`, `${options.audioChannelBitrate * channelsLimit}k`);
		}
	}

	if (twoPass) {
		processOptions.utils.stage('pass 1');

		// First pass to null with no audio
		await ffmpeg(
			ffmpegPath,
			[...inputArgs, ...videoArgs, ...twoPass.args[0], '-an', '-f', 'null', IS_WIN ? 'NUL' : '/dev/null'],
			{...processOptions, expectedDuration: totalDuration}
		);

		// Enable second pass for final encode
		outputArgs.push(...twoPass.args[1]);
		processOptions.utils.stage('pass 2');
	}

	// Enforce output type
	outputArgs.push('-f', outputFormat);

	// Calculate KBpMPX and check if we can skip encoding this file
	const skipThreshold = options.skipThreshold;

	// SkipThreshold should only apply when no editing is going to happen
	if (skipThreshold && !preventSkipThreshold) {
		const KB = totalSize / 1024;
		const MPX = (outputWidth * outputHeight) / 1e6;
		const minutes = totalDuration / 1000 / 60;
		const KBpMPXpM = KB / MPX / minutes;

		if (skipThreshold && skipThreshold > KBpMPXpM) {
			const message = `Video's ${Math.round(
				KBpMPXpM
			)} KB/Mpx/m bitrate is smaller than skip threshold (${skipThreshold}), skipping encoding.`;

			processOptions.utils.log(message);
			processOptions.utils.output.file(firstInput.path, {
				flair: {variant: 'warning', title: 'skipped', description: message},
			});

			return;
		}
	}

	// Finally, encode the file
	await runFFmpegAndCleanup({
		ffmpegPath,
		inputPath: firstInput.path,
		inputSize: totalSize,
		expectedDuration: totalDuration,
		args: [...inputArgs, ...videoArgs, ...audioArgs, ...extraMaps, ...outputArgs],
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
				processOptions.utils.log(`Deleting: ${filePath}`);
				await FSP.rm(filePath, {recursive: true});
			} catch (error) {
				processOptions.utils.log(eem(error));
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
		const bitrate = Math.round(relativeBitrate * ((outputWidth * outputHeight) / 1e6));
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
		for (const stream of audioOutputStreams) {
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
