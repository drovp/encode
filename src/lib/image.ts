import * as Path from 'path';
import {promises as FSP} from 'fs';
import {makeResize, ResizeOptions} from './dimensions';
import {ImageMeta as FFProbeImageMeta} from 'ffprobe-normalized';
import {SaveAsPathOptions} from '@drovp/save-as-path';
import {ProcessorUtils} from '@drovp/types';
import {eem, operationCleanup} from 'lib/utils';
import {nativeImport} from 'lib/nativeImport';
import {getOneRawFrame} from 'lib/ffmpeg';

const {max, abs} = Math;

export interface ImageMeta extends FFProbeImageMeta {
	sharpCantRead?: boolean;
}

export type X = number;
export type Y = number;
export type Width = number;
export type Height = number;
export type ResultPath = string;

export interface ImageOptions {
	resize: ResizeOptions;

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
	minSavings: number;
	skipThreshold: number | null;

	// Edits
	crop?: Region;
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
	let {width: currentWidth, height: currentHeight} = input;
	const {codec, jpg, avif, webp, png, crop, rotate, flipHorizontal, flipVertical, skipThreshold, flatten} = options;
	let preventSkipThreshold = false;
	const sharp = await nativeImport('sharp');

	// Disable all caching, otherwise sharp keeps files open and they can't be
	// deleted. I'm starting to regret migrating to sharp, this module is a minefield.
	sharp.cache(false);

	let image: ReturnType<typeof sharp>;
	if (input.sharpCantRead) {
		utils.log(`Sharp unsupported input, using ffmpeg to load image data...`);
		const imageData = await getOneRawFrame({meta: input, ffmpegPath});
		image = sharp(imageData.data, {raw: {width: imageData.width, height: imageData.height, channels: 4}});
	} else {
		image = sharp(input.path);
	}

	utils.log(`Input:\n- Path: "${input.path}"\n- Dimensions: ${input.width}×${input.height}\n------`);

	/**
	 * Sharp doesn't really support chaining operations, and produces weird
	 * results when doing so. We therefore have to flush changes after each
	 * potentially breaking operation to ensure everything is as expected.
	 */
	const flush = async () => {
		const {data, info} = await image.raw().toBuffer({resolveWithObject: true});
		image = sharp(data, {raw: info});
		image;
	};

	// Crop
	if (crop) {
		let {x, y, width, height} = crop;
		utils.log(`Cropping: ${width}×${height} @ ${x}×${y}`);
		image.extract({left: x, top: y, width, height});
		await flush();
		currentWidth = width;
		currentHeight = height;
		preventSkipThreshold = true;
	}

	// Overlay the image over an opaque background
	if (codec === 'jpg' || flatten) {
		utils.log(
			`Flattening (removing transparency if any) with "${options.background}" as the new background color.`
		);
		image.flatten({background: options.background});
	}

	// Rotate
	if (rotate) {
		utils.log(`Rotating: ${rotate} deg`);
		image.rotate(rotate);
		preventSkipThreshold = true;
		if (rotate % 180 === 90) {
			const tmpWidth = currentWidth;
			currentWidth = currentHeight;
			currentHeight = tmpWidth;
		}
		await flush();
	}

	// Flips
	if (flipHorizontal) {
		utils.log(`Flipping horizontally.`);
		image.flop();
		preventSkipThreshold = true;
	}
	if (flipVertical) {
		utils.log(`Flipping vertically.`);
		image.flip();
		preventSkipThreshold = true;
	}

	// Resize
	let {extract, resize} = makeResize(currentWidth, currentHeight, options.resize);

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
		// Pad
		{
			const {x, y, width, height, sourceWidth, sourceHeight} = extract;
			if (x < 0 || y < 0 || x + width > sourceWidth || y + height > sourceHeight) {
				const padWidth = max(width, sourceWidth) + abs(x);
				const padHeight = max(height, sourceHeight) + abs(y);
				const padX = max(-x, 0);
				const padY = max(-y, 0);
				extract.sourceWidth = padWidth;
				extract.sourceHeight = padHeight;
				extract.x = max(x, 0);
				extract.y = max(y, 0);
				preventSkipThreshold = true;

				utils.log(`Padding: ${padWidth}×${padHeight} @ ${padX}×${padY}`);
				image.extend({
					left: padX,
					top: padY,
					right: padWidth - x - sourceWidth,
					bottom: padHeight - y - sourceHeight,
					background: options.background,
				});
				await flush();
			}
		}

		// Crop
		{
			const {x, y, width, height, sourceWidth, sourceHeight} = extract;
			if (x !== 0 || y !== 0 || width !== sourceWidth || height !== sourceHeight) {
				if (x < 0 || y < 0 || width + x > sourceWidth || height + y > sourceHeight) {
					const json = JSON.stringify(extract, null, 2);
					throw new Error(`Can't crop, extract region is invalid: ${json}`);
				}
				utils.log(`Cropping: ${width}×${height} @ ${x}×${y}`);
				extract.sourceWidth = width;
				extract.sourceHeight = height;
				extract.x = 0;
				extract.y = 0;
				preventSkipThreshold = true;
				image.extract({left: x, top: y, width: width, height: height});
				await flush();
			}
		}
	}

	if (resize) {
		const {width, height} = resize;
		utils.log(`Resizing: ${width}×${height}`);
		image.resize({width, height, fit: 'fill'});
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

	const noExtPath = Path.join(Path.dirname(input.path), Path.basename(input.path, Path.extname(input.path)));
	const tmpPath = `${noExtPath}.tmp${Math.random().toString().slice(-6)}`;

	try {
		await image.toFile(tmpPath);

		// Rename/delete temporary files
		await operationCleanup({
			inputPaths: [input.path],
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
