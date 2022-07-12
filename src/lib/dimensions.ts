import {propPath} from './utils';
import {OptionsSchema} from '@drovp/types';

type Width = number;
type Height = number;

export interface ResizeDimensionsOptions {
	width: string; // supports fraction notation: `2.0` => double the size
	height: string; // supports fraction notation: `2.0` => double the size
	resizeMode: 'fit' | 'cover' | 'stretch';
	pixels: string; // supports dimensions notation: `10280x720`
	downscaleOnly: boolean;
	roundBy?: number; // useful for subsampling
}

/**
 * Expands dimension string such as `2.0` (multiplication) into raw number of pixels.
 * ```
 * dimensionToPixels('', 100); // undefined
 * dimensionToPixels('2.0', 100); // 200
 * dimensionToPixels('0.5', 100); // 50
 * dimensionToPixels('500', 100); // 500
 * ```
 */
export function dimensionToPixels(value: string, sourcePixels: number): number | undefined {
	value = value.trim();
	if (value.length === 0) return undefined;
	const number = parseFloat(value);
	if (!Number.isFinite(number) || number <= 0) throw new Error(`Invalid dimension format "${value}".`);
	return number % 1 > 0 ? sourcePixels * number : number;
}

/**
 * Converts strings like `1280x720`, `1e6`, `2.2M`, ... to a number.
 */
export function dimensionsToPixels(dimensions: string | number | undefined | null): number | undefined {
	try {
		const pixels = (0, eval)(
			`${dimensions}`
				.replaceAll('x', '*')
				.replaceAll(/k/gi, '*1e3')
				.replaceAll(/m/gi, '*1e6')
				.replaceAll(/g/gi, '*1e9')
		);
		if (Number.isFinite(pixels) && pixels > 0) return pixels;
	} catch {}
	return undefined;
}

function getCurrentOptionsNamespace(options: any, path: (string | number)[]): ResizeDimensionsOptions {
	return propPath(options, path.slice(0, -1));
}

function validateDimension(value: string) {
	if (value.trim().length > 0 && /^\d+(\.\d+)?$/.exec(value) == null) throw new Error(`Invalid value.`);
	return true;
}

function validatePixels(value: string) {
	if (value.length > 0 && !dimensionsToPixels(value)) throw new Error(`Invalid value.`);
	return true;
}

export function makePixelsHint(value: string) {
	const pixels = dimensionsToPixels(value);
	if (!pixels) return value ? 'invalid' : undefined;
	const megaPixels = pixels / 1_000_000;
	return `${megaPixels > 99.5 ? Math.round(megaPixels) : megaPixels.toFixed(megaPixels >= 10 ? 1 : 2)} MPx`;
}

export function makeResizeDimensionsOptionsSchema({
	roundBy = null,
}: {roundBy?: number | null} = {}): OptionsSchema<any> {
	const schema: OptionsSchema<any> = [
		{
			name: 'width',
			type: 'string',
			cols: 8,
			default: '',
			title: 'Width',
			description: `Desired output width limit. Use floating point for relative resizing: <code>0.5</code> -> half.`,
			validator: validateDimension,
		},
		{
			name: 'height',
			type: 'string',
			cols: 8,
			default: '',
			title: 'Height',
			description: `Desired output height limit. Use floating point for relative resizing: <code>0.5</code> -> half.`,
			validator: validateDimension,
		},
		{
			name: 'resizeMode',
			type: 'select',
			options: ['fit', 'cover', 'stretch'],
			default: 'fit',
			title: 'Resize mode',
			isHidden: (_, options, path) => {
				const namespace = getCurrentOptionsNamespace(options, path);
				return !namespace.width || !namespace.height;
			},
			description: `How to resize the output when width and height above don't match the source aspect ratio.`,
		},
		{
			name: 'pixels',
			type: 'string',
			cols: 10,
			default: '',
			title: 'Pixels',
			description: `Desired total output pixels limit.<br>Supported formats: <code>921600</code>, <code>1280x720</code>, <code>1e6</code>, <code>921.6K</code>, <code>0.921M</code>`,
			validator: validatePixels,
			hint: makePixelsHint,
		},
		{
			name: 'downscaleOnly',
			type: 'boolean',
			default: true,
			title: 'Downscale only',
			description: `Never upscale original resolution.`,
		},
	];

	if (typeof roundBy === 'number') {
		schema.push({
			name: 'roundBy',
			type: 'number',
			min: 1,
			default: roundBy,
			title: 'Round by',
			description: `Some encoders require even dimensions. This ensures that final width and height will be divisible by this number.`,
		});
	}

	return schema;
}

/**
 * Calculates target dimensions based on source/target dimensions and desired resize mode.
 */
export function resizeDimensions(
	sourceWidth: number,
	sourceHeight: number,
	options: ResizeDimensionsOptions
): [Width, Height] {
	const {width, height, pixels, resizeMode, downscaleOnly, roundBy = 1} = options;
	const targetPixels = dimensionsToPixels(pixels);
	let resultWidth = sourceWidth;
	let resultHeight = sourceHeight;
	let targetWidth = dimensionToPixels(width, sourceWidth);
	let targetHeight = dimensionToPixels(height, sourceHeight);

	// Fill out missing target dimensions
	if (!targetWidth) targetWidth = targetHeight ? sourceWidth * (targetHeight / sourceHeight) : sourceWidth;
	if (!targetHeight) targetHeight = targetWidth ? sourceHeight * (targetWidth / sourceWidth) : sourceHeight;

	// Resize
	switch (resizeMode) {
		case 'stretch':
			if (!downscaleOnly || resultWidth > targetWidth) resultWidth = targetWidth;
			if (!downscaleOnly || resultHeight > targetHeight) resultHeight = targetHeight;
			break;

		case 'fit': {
			const isTargetWider = targetWidth / targetHeight > sourceWidth / sourceHeight;
			let ratio = isTargetWider ? targetHeight / resultHeight : targetWidth / resultWidth;
			if (downscaleOnly && ratio > 1) break;
			resultWidth *= ratio;
			resultHeight *= ratio;
			break;
		}

		case 'cover': {
			const isTargetWider = targetWidth / targetHeight > sourceWidth / sourceHeight;
			let ratio = isTargetWider ? targetWidth / resultWidth : targetHeight / resultHeight;
			if (downscaleOnly && ratio > 1) break;
			resultWidth *= ratio;
			resultHeight *= ratio;
			break;
		}

		default:
			throw new Error(`Unknown resize mode "${resizeMode}"`);
	}

	// Satisfy target pixels requirements
	const currentPixels = resultWidth * resultHeight;
	if (targetPixels != null && (!downscaleOnly || currentPixels > targetPixels)) {
		let ratio = Math.sqrt(targetPixels / currentPixels);
		resultWidth *= ratio;
		resultHeight *= ratio;
	}

	// Satisfy rounding requirements
	resultWidth = Math.round(resultWidth / roundBy) * roundBy;
	resultHeight = Math.round(resultHeight / roundBy) * roundBy;

	return [resultWidth, resultHeight];
}
