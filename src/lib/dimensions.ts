import {propPath} from './utils';
import {OptionsSchema} from '@drovp/types';

const {abs, round, min} = Math;

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
	downscaleOnly?: boolean;
	roundBy?: number;
}

export type ResizeAction = (Region & {type: 'crop'}) | (Dimensions & {type: 'resize'}) | (Region & {type: 'pad'});

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

export function makeResizeOptionsSchema({
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

interface ResizeResult {
	extract?: Region;
	resize?: Dimensions;
	finalWidth: number;
	finalHeight: number;
}

/**
 * Determines extract region and final dimensions to satisfy resize options.
 *
 * Extract region can have negative position or be bigger than source, in which case it needs to be padded.
 */
export function makeResize(sourceWidth: number, sourceHeight: number, options: ResizeOptions): ResizeResult;
export function makeResize(region: Region, options: ResizeOptions): ResizeResult;
export function makeResize(
	sourceWidthOrRegion: number | Region,
	sourceHeightOrOptions: number | ResizeOptions,
	maybeOptions?: ResizeOptions
): ResizeResult {
	const options = maybeOptions || (typeof sourceHeightOrOptions === 'object' ? sourceHeightOrOptions : null);
	if (!options) throw new Error(`Missing options`);

	let region: Region;

	if (typeof sourceWidthOrRegion === 'object') {
		region = {...sourceWidthOrRegion};
	} else {
		const sourceWidth = sourceWidthOrRegion;
		const sourceHeight = sourceHeightOrOptions;
		if (typeof sourceWidth !== 'number' || typeof sourceHeight !== 'number') {
			throw new Error(`Missing sourceWidth orr sourceHeight parameter.`);
		}
		region = {x: 0, y: 0, width: sourceWidth, height: sourceHeight, sourceWidth, sourceHeight};
	}

	const {pixels, downscaleOnly, roundBy = 1} = options;
	const width = options.width.trim();
	const height = options.height.trim();
	const fit = !width || !height ? 'fill' : options.fit;
	const targetPixels = dimensionsToPixels(pixels);
	let targetWidth = dimensionToPixels(width, region.width);
	let targetHeight = dimensionToPixels(height, region.height);

	// Fill out missing target dimensions
	if (!targetWidth) targetWidth = targetHeight ? region.width * (targetHeight / region.height) : region.width;
	if (!targetHeight) targetHeight = targetWidth ? region.height * (targetWidth / region.width) : region.height;

	const targetAspectRatio = targetWidth / targetHeight;
	const sourceAspectRatio = region.width / region.height;
	const isTargetWider = targetAspectRatio > sourceAspectRatio;

	let extract: Region | undefined;
	let resize: Dimensions | undefined;
	let finalWidth = region.width;
	let finalHeight = region.height;

	// Resize
	switch (fit) {
		case 'fill': {
			const dimensions: Dimensions = {width: targetWidth, height: targetHeight};
			satisfyPixels(dimensions);
			satisfyRounding(dimensions);
			if (region.width !== dimensions.width || region.height !== dimensions.height) {
				resize = dimensions;
				finalWidth = dimensions.width;
				finalHeight = dimensions.height;
			}
			break;
		}

		case 'cover': {
			const aspectRatioDelta = abs(targetAspectRatio - sourceAspectRatio);

			if (aspectRatioDelta > 0.001) {
				let ratio = isTargetWider ? targetWidth / region.width : targetHeight / region.height;
				const cropWidth = isTargetWider ? region.width : targetWidth / ratio;
				const cropHeight = isTargetWider ? targetHeight / ratio : region.height;
				region.x += round((region.width - cropWidth) / 2);
				region.y += round((region.height - cropHeight) / 2);
				finalWidth = region.width = round(cropWidth);
				finalHeight = region.height = round(cropHeight);
				extract = region;
			}

			const dimensions: Dimensions = {width: targetWidth, height: targetHeight};
			satisfyPixels(dimensions);
			satisfyRounding(dimensions);

			if (region.width !== dimensions.width || region.height !== dimensions.height) {
				resize = dimensions;
				finalWidth = dimensions.width;
				finalHeight = dimensions.height;
			}
			break;
		}

		case 'contain': {
			const aspectRatioDelta = abs(targetAspectRatio - sourceAspectRatio);

			if (aspectRatioDelta > 0.001) {
				let padWidth: number;
				let padHeight: number;
				if (isTargetWider) {
					padHeight = region.height;
					padWidth = padHeight * targetAspectRatio;
				} else {
					padWidth = region.width;
					padHeight = padWidth / targetAspectRatio;
				}
				region.x -= round((padWidth - region.width) / 2);
				region.y -= round((padHeight - region.height) / 2);
				finalWidth = region.width = round(padWidth);
				finalHeight = region.height = round(padHeight);
				extract = region;
			}

			const dimensions: Dimensions = {width: targetWidth, height: targetHeight};
			satisfyPixels(dimensions);
			satisfyRounding(dimensions);

			if (region.width !== dimensions.width || region.height !== dimensions.height) {
				resize = dimensions;
				finalWidth = dimensions.width;
				finalHeight = dimensions.height;
			}
			break;
		}

		case 'inside': {
			let ratio = isTargetWider ? targetHeight / region.height : targetWidth / region.width;
			const dimensions: Dimensions = {width: region.width * ratio, height: region.height * ratio};
			satisfyPixels(dimensions);
			satisfyRounding(dimensions);
			if (dimensions.width !== region.width || dimensions.height !== region.height) {
				resize = dimensions;
				finalWidth = dimensions.width;
				finalHeight = dimensions.height;
			}
			break;
		}

		case 'outside': {
			let ratio = isTargetWider ? targetWidth / region.width : targetHeight / region.height;
			const dimensions: Dimensions = {width: region.width * ratio, height: region.height * ratio};
			satisfyPixels(dimensions);
			satisfyRounding(dimensions);
			if (dimensions.width !== region.width || dimensions.height !== region.height) {
				resize = dimensions;
				finalWidth = dimensions.width;
				finalHeight = dimensions.height;
			}
			break;
		}

		default:
			throw new Error(`Unknown resize mode "${fit}"`);
	}

	return {extract, resize, finalWidth, finalHeight};

	// Satisfy target pixels requirement
	function satisfyPixels(input: Dimensions) {
		const inputPixels = input.width * input.height;
		const regionPixels = region.width * region.height;
		const pixels = downscaleOnly ? min(targetPixels ?? Infinity, inputPixels, regionPixels) : targetPixels;

		if (pixels) {
			let ratio = Math.sqrt(pixels / inputPixels);

			// Filter out noisy/pointless resizes
			if (abs(ratio - 1) > 0.001) {
				input.width *= ratio;
				input.height *= ratio;
			}
		}
	}

	// Satisfy rounding requirement
	function satisfyRounding(input: Dimensions) {
		input.width = Math.round(input.width / roundBy) * roundBy;
		input.height = Math.round(input.height / roundBy) * roundBy;
	}
}
