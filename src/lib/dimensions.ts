import {propPath, sanitizeCrop} from './utils';
import {OptionsSchema} from '@drovp/types';

const {round} = Math;

export interface Dimensions {
	width: number;
	height: number;
}

export interface Pad {
	width: number;
	height: number;
	originalWidth: number;
	originalHeight: number;
	x: number;
	y: number;
}

export type Fit = 'fill' | 'inside' | 'outside' | 'cover' | 'contain';

export interface ResizeOptions {
	/**
	 * Desired output width limit. Use floating point for relative resizing: <code>0.5</code> -> half.
	 */
	width: string;
	/**
	 * Desired output height limit. Use floating point for relative resizing: <code>0.5</code> -> half.
	 */
	height: string;
	/**
	 * `fill` - stretch to match width & height\
	 * `inside` - scale until it fits inside width & height\
	 * `outside` - scale until it covers width & height\
	 * `cover` - scale until it covers width & height, and chop off parts that stick out\
	 * `contain` - scale until it fits inside width & height, and pad the missing area with background color
	 *
	 * If `width` or `height` are not defined, `fit` is forced to `fill`.
	 */
	fit: Fit;
	/**
	 * Supported formats: `921600`, `1280x720`, `1e6`, `921.6K`, `0.921M`.
	 * Units are case insensitive.
	 */
	pixels: string;
	downscaleOnly: boolean;
	roundBy?: number;
}

export type ResizeAction = (Crop & {type: 'crop'}) | (Dimensions & {type: 'resize'}) | (Pad & {type: 'pad'});

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

function getCurrentOptionsNamespace(options: any, path: (string | number)[]): ResizeOptions {
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
			name: 'fit',
			type: 'select',
			options: ['fill', 'inside', 'outside', 'cover', 'contain'],
			default: 'inside',
			title: 'Resize mode',
			isHidden: (_, options, path) => {
				const namespace = getCurrentOptionsNamespace(options, path);
				return !namespace.width.trim() || !namespace.height.trim();
			},
			description: `
<b>fill</b> - stretch to match width & height<br>
<b>outside</b> - scale until it covers width & height<br>
<b>inside</b> - scale until it fits inside width & height<br>
<b>cover</b> - scale until it covers width & height, and crop out parts that stick out<br>
<b>contain</b> - scale until it fits inside width & height, and pad the missing area with background color
`,
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
 * Determines necessary actions to satisfy resize options.
 *
 * Returns an object with actions that need to happen in the order they are returned to satisfy requirements.
 */
export function makeResizeActions(sourceWidth: number, sourceHeight: number, options: ResizeOptions): ResizeAction[] {
	const {pixels, downscaleOnly, roundBy = 1} = options;
	const width = options.width.trim();
	const height = options.height.trim();
	const fit = !width || !height ? 'fill' : options.fit;
	const targetPixels = dimensionsToPixels(pixels);
	let targetWidth = dimensionToPixels(width, sourceWidth);
	let targetHeight = dimensionToPixels(height, sourceHeight);

	// Fill out missing target dimensions
	if (!targetWidth) targetWidth = targetHeight ? sourceWidth * (targetHeight / sourceHeight) : sourceWidth;
	if (!targetHeight) targetHeight = targetWidth ? sourceHeight * (targetWidth / sourceWidth) : sourceHeight;

	const targetRatio = targetWidth / targetHeight;
	const sourceRatio = sourceWidth / sourceHeight;
	const isTargetWider = targetRatio > sourceRatio;
	const actionOrder: ResizeAction[] = [];

	// Resize
	switch (fit) {
		case 'fill':
			const resize: Dimensions = {width: targetWidth, height: targetHeight};
			satisfyPixels(resize);
			satisfyRounding(resize);
			let ratio = (resize.width * resize.height) / (sourceWidth * sourceHeight);
			if (!downscaleOnly || ratio < 1) {
				actionOrder.push({...resize, type: 'resize'});
			}
			break;

		case 'cover': {
			const resize: Dimensions = {width: targetWidth, height: targetHeight};
			satisfyPixels(resize);
			satisfyRounding(resize);
			let ratio = isTargetWider ? resize.width / sourceWidth : resize.height / sourceHeight;
			if (!downscaleOnly || ratio < 1) {
				const cropWidth = isTargetWider ? sourceWidth : resize.width / ratio;
				const cropHeight = isTargetWider ? resize.height / ratio : sourceHeight;
				const crop: Crop = {
					x: round((sourceWidth - cropWidth) / 2),
					y: round((sourceHeight - cropHeight) / 2),
					width: cropWidth,
					height: cropHeight,
					sourceWidth,
					sourceHeight,
				};
				sanitizeCrop(crop);
				actionOrder.push({...crop, type: 'crop'}, {...resize, type: 'resize'});
			}
			break;
		}

		case 'contain': {
			let padDimensions = {width: targetWidth, height: targetHeight};
			satisfyPixels(padDimensions);
			satisfyRounding(padDimensions);
			let ratio = isTargetWider ? padDimensions.height / sourceHeight : padDimensions.width / sourceWidth;
			if (!downscaleOnly || ratio < 1) {
				const resize: Dimensions = {width: round(sourceWidth * ratio), height: round(sourceHeight * ratio)};
				const pad: Pad = {
					...padDimensions,
					x: round((padDimensions.width - resize.width) / 2),
					y: round((padDimensions.height - resize.height) / 2),
					originalWidth: resize.width,
					originalHeight: resize.height,
				};
				actionOrder.push({...resize, type: 'resize'}, {...pad, type: 'pad'});
			}
			break;
		}

		case 'outside': {
			let ratio = isTargetWider ? targetWidth / sourceWidth : targetHeight / sourceHeight;
			const resize: Dimensions = {
				width: sourceWidth * ratio,
				height: sourceHeight * ratio,
			};
			satisfyPixels(resize);
			satisfyRounding(resize);
			if (!downscaleOnly || resize.width < sourceWidth) {
				actionOrder.push({...resize, type: 'resize'});
			}
			break;
		}

		case 'inside': {
			let ratio = isTargetWider ? targetHeight / sourceHeight : targetWidth / sourceWidth;
			const resize: Dimensions = {
				width: sourceWidth * ratio,
				height: sourceHeight * ratio,
			};
			satisfyPixels(resize);
			satisfyRounding(resize);
			if (!downscaleOnly || resize.width < sourceWidth) {
				actionOrder.push({...resize, type: 'resize'});
			}
			break;
		}

		default:
			throw new Error(`Unknown resize mode "${fit}"`);
	}

	// When downscale only prevented all operations, we need to do an extra
	// check for dimension rounding.
	if (actionOrder.length === 0) {
		const resize: Dimensions = {width: sourceWidth, height: sourceHeight};
		satisfyRounding(resize);
		if (resize.width !== sourceWidth || resize.height !== sourceHeight) {
			actionOrder.push({...resize, type: 'resize'});
		}
	}

	return actionOrder;

	// Satisfy target pixels requirement
	function satisfyPixels(dimensions: Dimensions) {
		const currentPixels = dimensions.width * dimensions.height;
		if (targetPixels != null && (!downscaleOnly || currentPixels > targetPixels)) {
			let ratio = Math.sqrt(targetPixels / currentPixels);
			dimensions.width *= ratio;
			dimensions.height *= ratio;
		}
	}

	// Satisfy rounding requirement
	function satisfyRounding(dimensions: Dimensions) {
		dimensions.width = Math.round(dimensions.width / roundBy) * roundBy;
		dimensions.height = Math.round(dimensions.height / roundBy) * roundBy;
	}
}
