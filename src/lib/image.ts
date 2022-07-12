import {runFFmpegAndCleanup} from './ffmpeg';
import {resizeDimensions, ResizeDimensionsOptions} from './dimensions';
import {ImageMeta} from 'ffprobe-normalized';
import {SaveAsPathOptions} from '@drovp/save-as-path';
import {ProcessorUtils} from '@drovp/types';

export type X = number;
export type Y = number;
export type Width = number;
export type Height = number;
export type ResultPath = string;

export interface ImageOptions {
	dimensions: ResizeDimensionsOptions;

	codec: 'jpg' | 'webp' | 'png';

	jpg: {
		quality: number; // 1: best, 31: worst
	};

	webp: {
		quality: number; // 0: worst, 100: best
		compression: number; // 0: fastest/worst, 6: slowest/best
		preset: 'none' | 'default' | 'picture' | 'photo' | 'drawing' | 'icon' | 'text';
		opaque: boolean; // will add `background` colored background to transparent images
	};

	png: {
		opaque: boolean; // will add `background` colored background to transparent images
	};

	scaler: 'fast_bilinear' | 'bilinear' | 'bicubic' | 'neighbor' | 'area' | 'gauss' | 'sinc' | 'lanczos' | 'spline';
	background: string;
	minSavings: number;
	skipThreshold: number | null;

	// Edits
	crop?: Crop;
	rotate?: Rotation;
	flipHorizontal?: boolean;
	flipVertical?: boolean;
}

export interface ProcessOptions {
	utils: ProcessorUtils;
	cwd: string;
	verbose: boolean;
}

export async function processImage(
	ffmpegPath: string,
	input: ImageMeta,
	options: ImageOptions,
	savingOptions: SaveAsPathOptions,
	processOptions: ProcessOptions
): Promise<ResultPath | undefined> {
	const args: (string | number)[] = [];
	const filterComplex: string[] = [];
	const filters: string[] = [];
	let {width: outputWidth, height: outputHeight} = input;
	let preventSkipThreshold = false;

	const useBackground =
		options.codec === 'jpg' ||
		(options.codec === 'webp' && options.webp.opaque) ||
		(options.codec === 'png' && options.png.opaque);

	if (processOptions.verbose) args.push('-v', 'verbose');

	// Input file
	args.push('-i', input.path);

	// Overlay the image over background
	if (useBackground) {
		// Creates background stream to be layed below input image
		// `-f lavfi` forces required format for following input
		args.push('-f', 'lavfi', '-i', `color=c=${options.background}`);

		// Overlay filter
		filterComplex.push(
			'[1:v][0:v]scale2ref[bg][image]',
			'[bg]setsar=1[bg]',
			'[bg][image]overlay=shortest=1,format=yuv420p[out]'
		);
	} else filterComplex.push('[0:v]copy[out]');

	// Crop
	if (options.crop) {
		let {x, y, width, height} = options.crop;
		filters.push(`crop=${width}:${height}:${x}:${y}`);
		outputWidth = width;
		outputHeight = height;
		preventSkipThreshold = true;
	}

	// Rotate
	if (options.rotate) {
		const tmpOutputWidth = outputWidth;
		preventSkipThreshold = true;

		switch (options.rotate) {
			case 90:
				filters.push('transpose=clock');
				outputWidth = outputHeight;
				outputHeight = tmpOutputWidth;
				break;

			case 180:
				filters.push('transpose=clock', 'transpose=clock');
				break;

			case 270:
				filters.push('transpose=cclock');
				outputWidth = outputHeight;
				outputHeight = tmpOutputWidth;
				break;
		}
	}

	// Flips
	if (options.flipHorizontal) {
		filters.push('hflip');
		preventSkipThreshold = true;
	}
	if (options.flipVertical) {
		filters.push('vflip');
		preventSkipThreshold = true;
	}

	// Resize
	let [resizeWidth, resizeHeight] = resizeDimensions(outputWidth, outputHeight, options.dimensions);
	if (resizeWidth! == outputWidth || resizeHeight !== outputHeight) {
		filters.push(`scale=${resizeWidth}:${resizeHeight}:flags=${options.scaler}`);
		outputWidth = resizeWidth;
		outputHeight = resizeHeight;
		preventSkipThreshold = true;
	}

	// Apply filters
	if (filters.length) filterComplex.push(`[out]${filters.join(',')}[out]`);
	args.push('-filter_complex', filterComplex.join(';'));

	// Select out stream
	args.push('-map', '[out]');

	switch (options.codec) {
		case 'jpg':
			args.push('-c:v', 'mjpeg');
			args.push('-qmin', '1'); // qscale is capped to 2 by default apparently
			args.push('-qscale:v', options.jpg.quality, '-huffman', 'optimal');
			break;

		case 'webp':
			args.push('-c:v', 'libwebp');
			args.push('-qscale:v', options.webp.quality);
			args.push('-compression_level', options.webp.compression);
			args.push('-preset', options.webp.preset);
			break;

		case 'png':
			args.push('-c:v', 'png');
			break;

		default:
			throw new Error(`Unsupported codec "${options.codec}".`);
	}

	args.push('-f', 'image2');

	// Calculate KBpMPX and check if we can skip encoding this file
	const skipThreshold = options.skipThreshold;

	// SkipThreshold should only apply when edits are going to happen
	if (skipThreshold && !preventSkipThreshold) {
		const KB = input.size / 1024;
		const MPX = (input.width * input.height) / 1e6;
		const KBpMPX = KB / MPX;

		if (skipThreshold > KBpMPX) {
			const message = `Image's ${Math.round(
				KBpMPX
			)} KB/Mpx data density is smaller than skip threshold, skipping encoding.`;

			processOptions.utils.log(message);
			processOptions.utils.output.file(input.path, {
				flair: {variant: 'warning', title: 'skipped', description: message},
			});

			return;
		}
	}

	// Finally, encode the file
	await runFFmpegAndCleanup({
		inputPath: input.path,
		inputSize: input.size,
		ffmpegPath,
		args,
		codec: options.codec,
		outputExtension: options.codec,
		savingOptions,
		minSavings: options.minSavings,
		...processOptions,
	});
}
