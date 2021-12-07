import {runFFmpegAndCleanup, ProgressReporter} from './ffmpeg';
import {resizeDimensions, ResizeDimensionsOptions} from './dimensions';
import {ImageData} from 'ffprobe-normalized';
import {SaveAsPathOptions} from '@drovp/save-as-path';

export type X = number;
export type Y = number;
export type Width = number;
export type Height = number;
export type ResultPath = string;

export interface ImageOptions {
	dimensions: ResizeDimensionsOptions;

	crop?: [X, Y, Width, Height]; // TODO: implement support for this, has to work with resize dimensions
	codec: 'jpg' | 'webp';

	jpg: {
		quality: number; // 1: best, 31: worst
	};

	webp: {
		quality: number; // 0: worst, 100: best
		compression: number; // 0: fastest/worst, 6: slowest/best
		preset: 'none' | 'default' | 'picture' | 'photo' | 'drawing' | 'icon' | 'text';
		opaque: boolean; // will add `background` colored background to transparent images
	};

	scaler: 'fast_bilinear' | 'bilinear' | 'bicubic' | 'neighbor' | 'area' | 'gauss' | 'sinc' | 'lanczos' | 'spline';
	background: string;
	minSavings: number;
}

export interface ProcessOptions {
	onLog: (message: string) => void;
	onWarning: (message: string) => void;
	onProgress: ProgressReporter;
	cwd: string;
}

export async function processImage(
	ffmpegPath: string,
	item: ImageData,
	options: ImageOptions,
	savingOptions: SaveAsPathOptions,
	processOptions: ProcessOptions
): Promise<ResultPath | undefined> {
	const args: (string | number)[] = [];
	const filterComplex: string[] = [];
	const filters: string[] = [];

	const useBackground = options.codec === 'jpg' || options.webp.opaque;

	// Input file
	args.push('-i', item.path);

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
	const [resultWidth, resultHeight] = resizeDimensions(item, options.dimensions);

	if (resultWidth !== item.width || resultHeight !== item.height) {
		filters.push(`scale=${resultWidth}:${resultHeight}:flags=${options.scaler}`);
	}

	// Apply filters
	if (filters.length) filterComplex.push(`[out]${filters.join(',')}[out]`);
	args.push('-filter_complex', filterComplex.join(';'));

	// Select out stream
	args.push('-map', '[out]');

	switch (options.codec) {
		case 'jpg':
			// Encoder parameters
			args.push('-qmin', '1'); // qscale is capped to 2 by default apparently
			args.push('-qscale:v', options.jpg.quality, '-huffman', 'optimal');

			// Enforce output type
			args.push('-f', 'singlejpeg');
			break;

		case 'webp':
			// Encoder parameters
			args.push('-qscale:v', options.webp.quality);
			args.push('-compression_level', options.webp.compression);
			args.push('-preset', options.webp.preset);

			// Enforce output type
			args.push('-f', 'webp');

			break;

		default:
			throw new Error(`Unsupported codec "${options.codec}".`);
	}

	return await runFFmpegAndCleanup({
		item,
		ffmpegPath,
		args,
		codec: options.codec,
		outputExtension: options.codec,
		savingOptions,
		minSavings: options.minSavings,
		...processOptions,
	});
}
