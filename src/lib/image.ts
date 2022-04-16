import {runFFmpegAndCleanup} from './ffmpeg';
import {resizeDimensions, ResizeDimensionsOptions} from './dimensions';
import {ImageData} from 'ffprobe-normalized';
import {SaveAsPathOptions} from '@drovp/save-as-path';
import {ProcessorUtils} from '@drovp/types';

export type X = number;
export type Y = number;
export type Width = number;
export type Height = number;
export type ResultPath = string;

export interface ImageOptions {
	dimensions: ResizeDimensionsOptions;

	crop?: [X, Y, Width, Height]; // TODO: implement support for this, has to work with resize dimensions
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
}

export interface ProcessOptions {
	utils: ProcessorUtils;
	cwd: string;
}

export async function processImage(
	ffmpegPath: string,
	input: ImageData,
	options: ImageOptions,
	savingOptions: SaveAsPathOptions,
	processOptions: ProcessOptions
): Promise<ResultPath | undefined> {
	const args: (string | number)[] = [];
	const filterComplex: string[] = [];
	const filters: string[] = [];
	const [outputWidth, outputHeight] = resizeDimensions(input, options.dimensions);
	const isBeingResized = outputWidth !== input.width || outputHeight !== input.height;

	const useBackground =
		options.codec === 'jpg' ||
		(options.codec === 'webp' && options.webp.opaque) ||
		(options.codec === 'png' && options.png.opaque);

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
	let crop;
	if (options.crop) {
		let [x, y, width, height] = options.crop;
		crop = {x, y, width, height, filter: `crop=${width}:${height}:${x}:${y}`};
		filters.push(crop.filter);
	}

	// Resize
	if (isBeingResized) filters.push(`scale=${outputWidth}:${outputHeight}:flags=${options.scaler}`);

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

	// SkipThreshold should only apply when no resizing is going to happen
	if (skipThreshold && !isBeingResized) {
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
		item: input,
		ffmpegPath,
		args,
		codec: options.codec,
		outputExtension: options.codec,
		savingOptions,
		minSavings: options.minSavings,
		...processOptions,
	});
}
