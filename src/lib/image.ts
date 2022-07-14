import * as Path from 'path';
import {promises as FSP} from 'fs';
import {resizeDimensions, ResizeDimensionsOptions} from './dimensions';
import {ImageMeta as FFProbeImageMeta} from 'ffprobe-normalized';
import {SaveAsPathOptions} from '@drovp/save-as-path';
import {ProcessorUtils} from '@drovp/types';
import {eem, nativeImport, operationCleanup} from 'lib/utils';
import {getOneRawFrame} from 'lib/ffmpeg';
import Sharp from 'sharp';

export interface ImageMeta extends FFProbeImageMeta {
	sharpCantRead?: boolean;
}

export type X = number;
export type Y = number;
export type Width = number;
export type Height = number;
export type ResultPath = string;

export interface ImageOptions {
	dimensions: ResizeDimensionsOptions;

	codec: 'jpg' | 'webp' | 'avif' | 'png';

	jpg: {
		quality: number; // 1 = smallest file, 100 = best quality
		progressive: boolean;
		mozjpegProfile: boolean;
		chromaSubsampling: string;
	};

	webp: {
		quality: number; // 0 = worst, 100 = best
		alphaQuality: number; // 0 = worst, 100 = best
		effort: number; // 0 = fastest/worst, 6 = slowest/best
	};

	avif: {
		quality: number; // 0 = worst, 100 = best
		lossless: boolean; // 0 = worst, 100 = best
		effort: number; // 0 = fastest/worst, 9 = slowest/best
		chromaSubsampling: string;
	};

	png: {
		compression: number; // 0 = fastest, largest, 9 = slowest, smallest
		progressive: boolean;
		palette: boolean;
		quality: number; // 0 = smallest file, 100 = highest quality
		effort: number; // 0 = fastest/worst, 10 = slowest/best
		colors: number; // 1-255
		dither: number;
	};

	flatten: boolean; // will add `background` colored background to transparent inputs
	background: string;
	stripMeta: boolean;
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
	{utils}: ProcessOptions
): Promise<ResultPath | undefined> {
	let {width: outputWidth, height: outputHeight} = input;
	const {codec, jpg, avif, webp, png, crop, rotate, flipHorizontal, flipVertical, skipThreshold, flatten, stripMeta} =
		options;
	let preventSkipThreshold = false;
	const sharp = await nativeImport<typeof Sharp>('sharp');

	let image: ReturnType<typeof Sharp>;
	if (input.sharpCantRead) {
		const imageData = await getOneRawFrame({meta: input, ffmpegPath});
		image = sharp(imageData.data, {raw: {width: imageData.width, height: imageData.height, channels: 4}});
	} else {
		image = sharp(input.path);
	}

	// Crop
	if (crop) {
		let {x, y, width, height} = crop;
		image.extract({left: x, top: y, width, height});
		preventSkipThreshold = true;
	}

	// Overlay the image over an opaque background
	if (codec === 'jpg' || flatten) {
		image.flatten({background: options.background});
	}

	// Rotate
	if (rotate) {
		image.rotate(rotate);
		preventSkipThreshold = true;
	}

	// Flips
	if (flipHorizontal) {
		console.log('flip');
		image.flop();
		preventSkipThreshold = true;
	}
	if (flipVertical) {
		console.log('flop');
		image.flip();
		preventSkipThreshold = true;
	}

	// Resize
	let [resizeWidth, resizeHeight] = resizeDimensions(outputWidth, outputHeight, options.dimensions);
	if (resizeWidth! == outputWidth || resizeHeight !== outputHeight) {
		image.resize({width: resizeWidth, height: resizeHeight, fit: 'fill'});
		preventSkipThreshold = true;
	}

	// Calculate KBpMPX and check if we can skip encoding this file
	// SkipThreshold should only apply when no edits are going to happen
	if (skipThreshold && !preventSkipThreshold) {
		const KB = input.size / 1024;
		const MPX = (input.width * input.height) / 1e6;
		const KBpMPX = KB / MPX;

		if (skipThreshold > KBpMPX) {
			const message = `Image's ${Math.round(
				KBpMPX
			)} KB/Mpx data density is smaller than skip threshold, skipping encoding.`;

			utils.log(message);
			utils.output.file(input.path, {
				flair: {variant: 'warning', title: 'skipped', description: message},
			});

			return;
		}
	}

	switch (codec) {
		case 'jpg':
			image.jpeg({
				quality: jpg.quality,
				progressive: jpg.progressive,
				mozjpeg: jpg.mozjpegProfile,
				chromaSubsampling: jpg.chromaSubsampling,
			});
			break;

		case 'webp':
			image.webp({
				quality: webp.quality,
				alphaQuality: webp.alphaQuality,
				effort: webp.effort,
			});
			break;

		case 'avif':
			image.avif({
				quality: avif.quality,
				lossless: avif.lossless,
				effort: avif.effort,
				chromaSubsampling: avif.chromaSubsampling,
			});
			break;

		case 'png':
			image.png({
				compressionLevel: png.compression,
				progressive: png.progressive,
				palette: png.palette,
				quality: png.palette ? png.quality : undefined,
				effort: png.palette ? png.effort : undefined,
				colors: png.palette ? png.colors : undefined,
				dither: png.palette ? png.dither : undefined,
			});
			break;

		default:
			throw new Error(`Unsupported codec "${codec}".`);
	}

	if (!stripMeta) image.withMetadata();

	const noExtPath = Path.join(Path.dirname(input.path), Path.basename(input.path, Path.extname(input.path)));
	const tmpPath = `${noExtPath}.tmp${Math.random().toString().slice(-6)}`;

	try {
		await image.toFile(tmpPath);

		// Rename/delete temporary files
		await operationCleanup({
			inputPath: input.path,
			inputSize: input.size,
			tmpPath,
			outputExtension: codec,
			minSavings: options.minSavings,
			savingOptions,
			codec,
			utils,
		});
	} catch (error) {
		utils.output.error(eem(error));
		try {
			utils.log(`Deleting temporary file if any.`);
			await FSP.unlink(tmpPath);
		} catch {}
	}
}
