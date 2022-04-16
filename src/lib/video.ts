import * as OS from 'os';
import * as Path from 'path';
import {promises as FSP} from 'fs';
import {ffmpeg, runFFmpegAndCleanup} from './ffmpeg';
import {resizeDimensions, ResizeDimensionsOptions} from './dimensions';
import {formatSize, eem, MessageError} from './utils';
import {VideoData} from 'ffprobe-normalized';
import {SaveAsPathOptions} from '@drovp/save-as-path';
import {ProcessorUtils} from '@drovp/types';

const IS_WIN = process.platform === 'win32';

export type X = number;
export type Y = number;
export type Width = number;
export type Height = number;
export type From = number;
export type To = number;
export type ResultPath = string;

export interface TwoPassData {
	args: [(string | number)[], (string | number)[]];
	logFiles: string[];
}

export interface VideoOptions {
	dimensions: ResizeDimensionsOptions;

	codec: 'h264' | 'h265' | 'vp8' | 'vp9' | 'av1' | 'gif' | 'copy';

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
		tune: '' | 'grain' | 'zerolatency' | 'fastdecode';
		twoPass: boolean;
		// prettier-ignore
		profile: 'auto' | 'main' | 'main-intra' | 'mainstillpicture' | 'main444-8' | 'main444-intra' | 'main444-stillpicture' | 'main10' | 'main10-intra' | 'main422-10' | 'main422-10-intra' | 'main444-10' | 'main444-10-intra' | 'main12' | 'main12-intra' | 'main422-12' | 'main422-12-intra' | 'main444-12' | 'main444-12-intra';
	};

	vp9: {
		mode: 'quality' | 'constrained-quality' | 'bitrate' | 'lossless' | 'size';
		crf: number; // 0: lossless, 63: worst
		qmin: number; // 0-63
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
		mode: 'quality' | 'constrained-quality' | 'bitrate' | 'size';
		crf: number; // 0: lossless, 63: worst
		qmin: number; // 0-63
		qmax: number; // qmin-63
		bitrate: number; // KB per second per million pixels (bitrate mode)
		minrate: number; // KB per second per million pixels (bitrate mode)
		maxrate: number; // KB per second per million pixels (bitrate mode)
		size: number; // target size in Mpx
		maxKeyframeInterval: number;
		twoPass: boolean;
		speed: number; // 0: slowest/best quality, 8: fastest/worst quality
		multithreading: boolean;
	};

	gif: {
		colors: number;
		dithering: 'none' | 'bayer' | 'sierra2_4a';
	};

	maxFps: number;
	audioChannelBitrate: number; // Kbit/s PER CHANNEL
	maxAudioChannels: number;
	pixelFormat: string;
	scaler: 'fast_bilinear' | 'bilinear' | 'bicubic' | 'neighbor' | 'area' | 'gauss' | 'sinc' | 'lanczos' | 'spline';
	deinterlace: boolean;
	stripSubtitles: boolean;
	ensureTitle: boolean;

	cuts?: [From, To][]; // TODO: add support for this
	crop?: [X, Y, Width, Height]; // TODO: add support for this

	minSavings: number;
	skipThreshold: number | null;
}

export interface ProcessOptions {
	id: string;
	utils: ProcessorUtils;
	cwd: string;
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

export async function processVideo(
	ffmpegPath: string,
	input: VideoData,
	options: VideoOptions,
	savingOptions: SaveAsPathOptions,
	processOptions: ProcessOptions
): Promise<ResultPath | undefined> {
	const inputArgs: (string | number)[] = [];
	const videoArgs: (string | number)[] = [];
	const audioArgs: (string | number)[] = [];
	const outputArgs: (string | number)[] = [];
	const isCopy = options.codec === 'copy';
	const includeSubtitles = input.subtitlesStreams.length > 0 && !options.stripSubtitles;
	const stripAudio = options.maxAudioChannels === 0 || input.audioStreams.length === 0;
	let twoPass: false | TwoPassData = false; // [param_name, 1st_pass_toggle, 2nd_pass_toggle]
	const [outputWidth, outputHeight] = resizeDimensions(input, {...options.dimensions, roundBy: 4});
	const isBeingResized = outputWidth !== input.width || outputHeight !== input.height;
	let outputFormat: string | undefined;

	// Input
	inputArgs.push('-i', input.path);

	// Ensure title
	if (options.ensureTitle) {
		const filename = Path.basename(input.path, Path.extname(input.path));
		if (!input.title) inputArgs.push('-metadata', `title=${filename}`);
	}

	// Streams
	inputArgs.push('-map', '0:v:0');
	if (!stripAudio) inputArgs.push('-map', '0:a?');
	if (includeSubtitles) {
		inputArgs.push('-map', '0:s?');
		inputArgs.push('-map', '0:t?');
	}

	// Calculates actual output bitrate based on relative bitrate (kbpspmp) and output dimensions
	function outputBitrate(relativeBitrate: number) {
		const bitrate = Math.round(relativeBitrate * ((outputWidth * outputHeight) / 1e6));
		return `${bitrate}k`;
	}

	// Calculates bitrate for video track to satisfy max file size constraints
	// `size` is a float of megabytes
	function sizeConstrainedVideoBitrate(size: number) {
		const targetSize = size * 1024 * 1024;
		const durationSeconds = input.duration / 1000;
		let audioSize = 0;

		// Estimate audio size
		for (const stream of input.audioStreams) {
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

	// Limit framerate
	if (options.maxFps && input.framerate > options.maxFps) videoArgs.push('-r', options.maxFps);

	// Filters
	const filters: string[] = [];

	// Deinterlace
	if (options.deinterlace) filters.push(`yadif`);

	// Set pixel format, ignored for gif or it removes transparency
	if (options.codec !== 'gif') filters.push(`format=${options.pixelFormat}`);

	// Crop
	if (options.crop) {
		let [x, y, width, height] = options.crop;
		filters.push(`crop=${width}:${height}:${x}:${y}`);
	}

	// Resize
	if (outputWidth !== input.width || outputHeight !== input.height) {
		filters.push(`scale=${outputWidth}:${outputHeight}:flags=${options.scaler}`);
	}

	// Codec specific args
	switch (options.codec) {
		case 'copy':
			outputFormat = input.format as string;
			videoArgs.push('-c:v', 'copy');
			videoArgs.push('-c:a', 'copy');
			break;

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
			videoArgs.push('-c:v', 'libaom-av1');

			// Quality/size control
			switch (options.av1.mode) {
				case 'quality':
					videoArgs.push('-crf', options.av1.crf, '-b:v', 0);
					videoArgs.push('-qmin', options.av1.qmin);
					videoArgs.push('-qmax', options.av1.qmax);
					break;

				case 'constrained-quality':
					videoArgs.push('-crf', options.av1.crf, '-b:v', outputBitrate(options.av1.bitrate));
					break;

				case 'bitrate':
					videoArgs.push('-b:v', outputBitrate(options.av1.bitrate));
					videoArgs.push('-minrate', outputBitrate(options.av1.minrate));
					videoArgs.push('-maxrate', outputBitrate(options.av1.maxrate));
					break;

				case 'size': {
					const bitrateUnit = sizeConstrainedVideoBitrate(options.vp9.size);
					videoArgs.push('-minrate', bitrateUnit, '-maxrate', bitrateUnit, '-b:v', bitrateUnit);
					break;
				}
			}

			// Max keyframe interval
			if (options.av1.maxKeyframeInterval) {
				videoArgs.push('-g', Math.round(input.framerate * options.av1.maxKeyframeInterval));
			}

			videoArgs.push('-cpu-used', options.av1.speed);
			if (options.av1.multithreading) videoArgs.push('-row-mt', 1);
			if (options.av1.twoPass) twoPass = makeTwoPass(processOptions.id);

			break;

		case 'gif':
			outputFormat = 'gif';
			filters.push(
				[
					`split[o1][o2]`,
					`[o1]palettegen=max_colors=${options.gif.colors}[p]`,
					`[o2]fifo[o3]`,
					`[o3][p]paletteuse=dither=${options.gif.dithering}`,
				].join(';')
			);
			break;

		default:
			throw new Error(`Unknown codec "${options.codec}".`);
	}

	// Apply filters
	if (!isCopy && filters.length) videoArgs.push('-vf', `${filters.join(',')}`);

	// Audio
	if (stripAudio) {
		audioArgs.push('-an');
	} else {
		if (isCopy) {
			audioArgs.push('-c:a', 'copy');
		} else {
			audioArgs.push('-c:a', 'libopus');

			// Limit max audio channels and set bitrate
			for (const [index, audioChannel] of input.audioStreams.entries()) {
				const channels = Math.min(audioChannel.channels, options.maxAudioChannels);
				const streamIdentifier = `:a:${index}`;
				if (channels !== audioChannel.channels) audioArgs.push(`-ac${streamIdentifier}`, channels);
				audioArgs.push(`-b${streamIdentifier}`, `${options.audioChannelBitrate * channels}k`);
			}
		}
	}

	if (twoPass) {
		processOptions.utils.stage('pass 1');

		// First pass to null with no audio
		await ffmpeg(
			ffmpegPath,
			[...inputArgs, ...videoArgs, ...twoPass.args[0], '-an', '-f', 'null', IS_WIN ? 'NUL' : '/dev/null'],
			processOptions
		);

		// Enable second pass for final encode
		outputArgs.push(...twoPass.args[1]);
		processOptions.utils.stage('pass 2');
	}

	// Enforce output type
	outputArgs.push('-f', outputFormat);

	// Calculate KBpMPX and check if we can skip encoding this file
	const skipThreshold = options.skipThreshold;

	// SkipThreshold should only apply when no resizing is going to happen
	if (skipThreshold && !isBeingResized) {
		const KB = input.size / 1024;
		const MPX = (input.width * input.height) / 1e6;
		const minutes = input.duration / 1000 / 60;
		const KBpMPXpM = KB / MPX / minutes;

		if (skipThreshold && skipThreshold > KBpMPXpM) {
			const message = `Video's ${Math.round(
				KBpMPXpM
			)} KB/Mpx/m bitrate is smaller than skip threshold (${skipThreshold}), skipping encoding.`;

			processOptions.utils.log(message);
			processOptions.utils.output.file(input.path, {
				flair: {variant: 'warning', title: 'skipped', description: message},
			});

			return;
		}
	}

	// Finally, encode the file
	await runFFmpegAndCleanup({
		item: input,
		ffmpegPath,
		args: [...inputArgs, ...videoArgs, ...audioArgs, ...outputArgs],
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
}
