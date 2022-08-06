import {promises as FSP} from 'fs';
import * as Path from 'path';
import type {ChildProcessWithoutNullStreams} from 'child_process';
import * as shortcuts from 'config/shortcuts';
import type {AudioMeta, VideoMeta} from 'ffprobe-normalized';
import type {ImageMeta} from './image';
import {saveAsPath, SaveAsPathOptions} from '@drovp/save-as-path';
import {ProcessorUtils} from '@drovp/types';
import {META_DATA_BINARY_DELIMITER} from 'config';
import type Sharp from 'sharp';

export type Meta = ImageMeta | AudioMeta | VideoMeta;

const {abs, min, max, round} = Math;

/**
 * Naive quick type guard. Casts `value` to `T` when `condition` is `true`.
 * ```
 * isOfType<MouseEvent>(event, 'clientX' in event)
 * ```
 */
export function isOfType<T>(value: any, condition: boolean): value is T {
	return condition;
}

/**
 * Extract error message.
 */
export function eem(error: any, preferStack = false) {
	return error instanceof Error ? (preferStack ? error.stack || error.message : error.message) : `${error}`;
}

/**
 * Creates an event type with forced expected structure.
 * Makes creating targeted event handlers not pain in the ass.
 */
export type TargetedEvent<Target extends EventTarget = EventTarget, TypedEvent extends Event = Event> = Omit<
	TypedEvent,
	'currentTarget'
> & {
	readonly currentTarget: Target;
};

/**
 * Constructor to be used for errors that should only display a message without
 * a stack to the user.
 */
export class MessageError extends Error {}

/**
 * '1:30:40.500' => {milliseconds}
 */
export function isoTimeToMS(text: string) {
	const split = text.split('.') as [string, string | undefined];
	let time = split[1] ? parseFloat(`.${split[1]}`) * 1000 : 0;
	const parts = split[0]
		.split(':')
		.filter((x) => x)
		.map((x) => parseInt(x, 10));

	if (parts.length > 0) time += parts.pop()! * 1000; // s
	if (parts.length > 0) time += parts.pop()! * 1000 * 60; // m
	if (parts.length > 0) time += parts.pop()! * 1000 * 60 * 60; // h

	return time;
}

/**
 * Validate iso time.
 */
export function isIsoTime(value: string) {
	return /^\d\d:\d\d:\d\d\.\d\d\d$/.exec(value) !== null;
}

/**
 * {milliseconds} => '01:30:40.500'
 */
export function msToIsoTime(milliseconds: number) {
	milliseconds = Math.floor(milliseconds);

	const hours = String(Math.floor(milliseconds / (60 * 60 * 1000))).padStart(2, '0');
	milliseconds %= 60 * 60 * 1000;

	const minutes = String(Math.floor(milliseconds / (60 * 1000))).padStart(2, '0');
	milliseconds %= 60 * 1000;

	const seconds = String(Math.floor(milliseconds / 1000)).padStart(2, '0');
	milliseconds %= 1000;

	let result = `${hours}:${minutes}:${seconds}`;

	result = `${result}.${String(milliseconds / 1000)
		.slice(2)
		.padEnd(3, '0')}`;

	return result;
}

/**
 * 00:00:01.555 -> 01.555
 */
export function isoToHumanTime(isoTime: string) {
	while (isoTime.startsWith('00:')) isoTime = isoTime.slice(3);
	return isoTime;
}

/**
 * 1555 -> 01.555
 */
export function msToHumanTime(milliseconds: number) {
	return isoToHumanTime(msToIsoTime(milliseconds));
}

/**
 * Format floating point number into percentage string.
 */
export function numberToPercent(value: number) {
	return `${(value * 100).toFixed(Math.abs(value) > 0.01 ? 0 : 1)}%`;
}

/**
 * Generate unique ID.
 */
export const uid = (size = 10) =>
	Array(size)
		.fill(0)
		.map(() => Math.floor(Math.random() * 36).toString(36))
		.join('');

/**
 * CLamp a number between 2 other numbers.
 */
export const clamp = (min: number, value: number, max: number) => Math.max(min, Math.min(max, value));

/**
 * Returns value from an object located at path.
 *
 * ```
 * const obj = {
 *   a: ['foo', 'bar']
 *   b: {
 *     c: 5
 *   }
 * };
 * propPath(obj, 'a.1'); // 'bar'
 * propPath(obj, ['a', 1]); // 'bar'
 * propPath(obj, 'b.c'); // 5
 * ```
 */
export function propPath<T extends any = unknown>(obj: any, path: string | (string | number)[]): T {
	if (typeof path === 'string') path = path.split(/(?<!\\)\./).map((prop) => prop.replace(/\\./, '.'));

	let cursor = obj;

	for (let i = 0; i < path.length; i++) {
		if (cursor != null && typeof cursor === 'object') cursor = cursor[path[i]!];
		else return undefined as any;
	}

	return cursor;
}

/**
 * Return de-duplicated list of all types in an array of metas.
 */
export function getMetaTypes(metas: {type: string}[]) {
	let types = new Set<string>();
	for (const meta of metas) types.add(meta.type);
	return [...types];
}

function isMeta(value: unknown): value is Meta {
	return value != null && typeof value === 'object' && typeof (value as any).type === 'string';
}

/**
 * Checks that all metas are of same requested type.
 */
export function isMetasType(type: 'audio', metas: unknown): metas is AudioMeta[];
export function isMetasType(type: 'image', metas: unknown): metas is ImageMeta[];
export function isMetasType(type: 'video', metas: unknown): metas is VideoMeta[];
export function isMetasType(type: 'image' | 'audio' | 'video', metas: unknown): boolean {
	if (Array.isArray(metas)) {
		for (const meta of metas) {
			if (!isMeta(meta) || meta.type !== type) return false;
		}

		return true;
	}
	return false;
}

/**
 * Formats raw size number into human readable units.
 */
export function formatSize(bytes: number): string {
	let i = 0;
	while (bytes >= 1000) {
		bytes /= 1024;
		i++;
	}
	return `${bytes < 10 ? bytes.toFixed(1) : Math.round(bytes)}${sizeUnits[i]}`;
}
const sizeUnits = ['', 'K', 'M', 'G', 'T'];

/**
 * Returns an ID of a passed event's modifiers combination.
 *
 * Example: `Alt+Shift`
 *
 * Modifiers are always in alphabetical order.
 */
export function idModifiers(event: Event) {
	return getModifiers(event).join('+');
}

function getModifiers(event: Event) {
	const modifiers: string[] = [];
	for (const name of ['alt', 'ctrl', 'meta', 'shift']) {
		if (event[`${name}Key` as unknown as keyof Event]) modifiers.push(name[0]!.toUpperCase() + name.slice(1));
	}
	return modifiers;
}

export function idKey(event: KeyboardEvent) {
	const parts = getModifiers(event);
	if (!parts.includes(event.key)) parts.push(event.key);
	return parts.join('+');
}

/**
 * Inserts text in currently active input/textarea element at cursor.
 */
export function insertAtCursor(text: string, input: Element | null = document.activeElement) {
	if (!isOfType<HTMLInputElement | HTMLTextAreaElement>(input, input != null && 'selectionStart' in input)) {
		return;
	}
	const [start, end] = [input.selectionStart, input.selectionEnd];
	if (start != null && end != null) input.setRangeText(text, start, end, 'end');
}

/**
 * Converts raw image data from ffmpeg to ImagData object.
 */
export function imageDataFromBuffer(buffer: Buffer, width: number, height: number) {
	return new ImageData(Uint8ClampedArray.from(buffer), width, height);
}

/**
 * Draws Buffer returned by ffmpeg raw image output into canvas element.
 */
export async function drawImageToCanvas(
	canvas: HTMLCanvasElement,
	image: ImageData,
	{
		rotate = 0,
		flipVertical = false,
		flipHorizontal = false,
	}: {rotate?: Rotation; flipVertical?: boolean; flipHorizontal?: boolean} = {}
) {
	const isTilted = rotate === 90 || rotate === 270;
	const ctx = canvas?.getContext('2d');

	if (!ctx) return;

	if (isTilted) {
		canvas.width = image.height;
		canvas.height = image.width;
	} else {
		canvas.width = image.width;
		canvas.height = image.height;
	}

	if (rotate === 0 && !flipVertical && !flipHorizontal) {
		ctx.putImageData(image, 0, 0);
	} else {
		ctx.translate(canvas.width / 2, canvas.height / 2);
		ctx.rotate((rotate * Math.PI) / 180);
		if (flipHorizontal || flipVertical) {
			ctx.translate(
				-(image.width / 2) + (flipHorizontal ? image.width : 0),
				-(image.height / 2) + (flipVertical ? image.height : 0)
			);
			ctx.scale(flipHorizontal ? -1 : 1, flipVertical ? -1 : 1);
		} else {
			ctx.translate(-(image.width / 2), -(image.height / 2));
		}
		ctx.drawImage(await createImageBitmap(image), 0, 0);
	}
}

/**
 * Detects rectangle to crop out black/transparent parts of an image.
 */
export function cropDetect(
	image: ImageData,
	{limit = 0, alphaLimit = 0}: {limit?: number; alphaLimit?: number} = {}
): Region {
	const {data, width, height} = image;
	let cropAX = image.width;
	let cropAY = image.height;
	let cropBX = 0;
	let cropBY = 0;
	let allBlack = true;
	let limitWeight = Math.round(limit * 255 * 3);
	let alphaLimitWeight = Math.round(alphaLimit * 255);

	for (let y = 0; y < height; y++) {
		for (let x = 0; x < width; x++) {
			const pos = y * width + x;
			const pixelStart = pos * 4;
			const red = data[pixelStart]!;
			const green = data[pixelStart + 1]!;
			const blue = data[pixelStart + 2]!;
			const alpha = data[pixelStart + 3]!;

			// Pixel should be kept
			if (alpha > alphaLimitWeight && red + green + blue > limitWeight) {
				allBlack = false;
				if (x < cropAX) cropAX = x;
				if (y < cropAY) cropAY = y;
				if (x > cropBX) cropBX = x;
				if (y > cropBY) cropBY = y;
			}
		}
	}

	let crop: Region = {
		x: cropAX,
		y: cropAY,
		width: cropBX - cropAX + 1,
		height: cropBY - cropAY + 1,
		sourceWidth: image.width,
		sourceHeight: image.height,
	};

	// In case of invalid crop result (all black/transparent images) we simply
	// return crop rectangle for the whole image.
	if (allBlack) throw new Error(`Cropping can't be defined, all pixels are black or transparent.`);
	if (!isCropValid(crop)) {
		throw new Error(`Cropping algorithm produced an invalid crop rectangle:\n${JSON.stringify(crop)}`);
	}

	return crop;
}

export function isCropValid(value: any, roundBy = 1): value is Region {
	return (
		value != null &&
		typeof value === 'object' &&
		typeof value.x === 'number' &&
		typeof value.y === 'number' &&
		typeof value.width === 'number' &&
		typeof value.height === 'number' &&
		typeof value.sourceWidth === 'number' &&
		typeof value.sourceWidth === 'number' &&
		value.x % roundBy === 0 &&
		value.y % roundBy === 0 &&
		value.width % roundBy === 0 &&
		value.height % roundBy === 0 &&
		value.sourceWidth % roundBy === 0 &&
		value.sourceWidth % roundBy === 0 &&
		value.sourceWidth > 0 &&
		value.sourceHeight > 0 &&
		value.x >= 0 &&
		value.x < value.sourceWidth &&
		value.y >= 0 &&
		value.y < value.sourceHeight &&
		value.width > 0 &&
		value.width <= value.sourceWidth - value.x &&
		value.height > 0 &&
		value.height <= value.sourceHeight - value.y
	);
}

/**
 * Ensure crop fits container dimensions and is rounded properly.
 * Sanitizes the crop IN PLACE.
 */
export function sanitizeCrop(
	crop: Region,
	{roundBy = 1, mode = 'move', minSize = 0}: {roundBy?: number; mode?: 'move' | 'crop'; minSize?: number} = {}
): Region {
	crop.sourceWidth = round(crop.sourceWidth);
	crop.sourceHeight = round(crop.sourceHeight);

	if (mode === 'move') {
		crop.width = clamp(minSize, crop.width, crop.sourceWidth);
		crop.height = clamp(minSize, crop.height, crop.sourceHeight);
		crop.x = clamp(0, crop.x, crop.sourceWidth - crop.width);
		crop.y = clamp(0, crop.y, crop.sourceHeight - crop.height);
	} else {
		const oldX = crop.x;
		const oldY = crop.y;
		crop.x = clamp(0, crop.x, crop.sourceWidth - minSize);
		crop.y = clamp(0, crop.y, crop.sourceHeight - minSize);
		const widthCut = max(0, crop.x - oldX) + max(0, oldX + crop.width - crop.sourceWidth);
		const heightCut = max(0, crop.y - oldY) + max(0, oldY + crop.height - crop.sourceHeight);
		crop.width = clamp(minSize, crop.width - widthCut, crop.sourceWidth - crop.x);
		crop.height = clamp(minSize, crop.height - heightCut, crop.sourceHeight - crop.y);
	}

	// Rounding
	const preRoundingWidth = round(crop.width);
	const preRoundingHeight = round(crop.height);

	crop.width = round(crop.width / roundBy) * roundBy;
	if (crop.width > crop.sourceWidth) crop.width = crop.sourceWidth - (crop.sourceWidth % roundBy);

	crop.height = round(crop.height / roundBy) * roundBy;
	if (crop.height > crop.sourceHeight) crop.height = crop.sourceHeight - (crop.sourceHeight % roundBy);

	const widthRoundingOffset = preRoundingWidth - crop.width;
	const heightRoundingOffset = preRoundingHeight - crop.height;
	crop.x = clamp(0, round(crop.x - max(0, widthRoundingOffset / 2 - 1)), crop.sourceWidth - crop.width);
	crop.y = clamp(0, round(crop.y - max(0, heightRoundingOffset / 2 - 1)), crop.sourceHeight - crop.height);

	return crop;
}

/**
 * Rotate Crop in 90 degree increments.
 */
export function rotateCrop(crop: Region, degrees: number): Region {
	if (degrees % 90 !== 0)
		throw new Error(`Rotation only supports 90 degree increments, but "${degrees}" was passed.`);

	let {x, y, width, height, sourceWidth, sourceHeight} = crop;
	const isCounterClockwise = degrees < 0;
	let degreesLeft = Math.abs(degrees);

	while (degreesLeft > 0) {
		degreesLeft -= 90;
		if (isCounterClockwise) {
			const oldY = y;
			y = sourceWidth - width - x;
			x = oldY;
		} else {
			const oldX = x;
			x = sourceHeight - height - y;
			y = oldX;
		}
		const oldSourceHeight = sourceHeight;
		sourceHeight = sourceWidth;
		sourceWidth = oldSourceHeight;
		const oldHeight = height;
		height = width;
		width = oldHeight;
	}

	return {x, y, width, height, sourceWidth, sourceHeight};
}

/**
 * Flips crop horizontally.
 */
export function flipCropHorizontal(crop: Region): Region {
	const {x, y, width, height, sourceWidth, sourceHeight} = crop;
	return {x: sourceWidth - x - width, y, width, height, sourceWidth, sourceHeight};
}

/**
 * Flips crop vertically.
 */
export function flipCropVertical(crop: Region): Region {
	const {x, y, width, height, sourceWidth, sourceHeight} = crop;
	return {x, y: sourceHeight - y - height, width, height, sourceWidth, sourceHeight};
}

/**
 * Resizes Region for different resolution.
 */
export function resizeRegion(region: Region, width: number, height: number): Region {
	const xFactor = width / region.sourceWidth;
	const yFactor = height / region.sourceHeight;
	return {
		x: round(region.x * xFactor),
		y: round(region.y * yFactor),
		width: round(region.width * xFactor),
		height: round(region.height * yFactor),
		sourceWidth: width,
		sourceHeight: height,
	};
}

/**
 * Count number of decimal places in a number.
 */
export function countDecimals(num: number, limit = 20) {
	return `${num}`.split('.')[1]?.length || 0;
}

/**
 * Throttle / Debounce.
 */

type UnknownFn = (...args: any[]) => any;
export interface DTWrapper<T extends UnknownFn> {
	(...args: Parameters<T>): void;
	cancel: () => void;
	flush: () => void;
}

export function rafThrottle<T extends UnknownFn>(fn: T): DTWrapper<T> {
	let frameId: number | null = null;
	let args: any;
	let context: any;

	function call() {
		frameId = null;
		fn.apply(context, args);
		context = args = null;
	}

	function throttled(this: any) {
		context = this;
		args = arguments;
		if (frameId === null) frameId = requestAnimationFrame(call);
	}

	throttled.cancel = () => {
		if (frameId !== null) {
			cancelAnimationFrame(frameId);
			frameId = null;
		}
	};

	throttled.flush = () => {
		if (frameId !== null) {
			cancelAnimationFrame(frameId);
			frameId = null;
			call();
		}
	};

	return throttled as DTWrapper<T>;
}

export function throttle<T extends UnknownFn>(fn: T, timeout: number = 100, noTrailing: boolean = false): DTWrapper<T> {
	let timeoutId: NodeJS.Timer | null;
	let args: any;
	let context: any;
	let last: number = 0;

	function call() {
		fn.apply(context, args);
		last = Date.now();
		timeoutId = context = args = null;
	}

	function throttled(this: any) {
		let delta = Date.now() - last;
		context = this;
		args = arguments;
		if (delta >= timeout) {
			throttled.cancel();
			call();
		} else if (!noTrailing && timeoutId == null) {
			timeoutId = setTimeout(call, timeout - delta);
		}
	}

	throttled.cancel = () => {
		if (timeoutId !== null) {
			clearTimeout(timeoutId);
			timeoutId = null;
		}
	};

	throttled.flush = () => {
		if (timeoutId !== null) {
			clearTimeout(timeoutId);
			timeoutId = null;
			call();
		}
	};

	return throttled as DTWrapper<T>;
}

export function debounce<T extends UnknownFn>(fn: T, timeout: number = 100): DTWrapper<T> {
	let timeoutId: NodeJS.Timer | null;
	let args: any;
	let context: any;

	function call() {
		fn.apply(context, args);
		timeoutId = context = args = null;
	}

	function debounced(this: any) {
		context = this;
		args = arguments;
		if (timeoutId != null) clearTimeout(timeoutId);
		timeoutId = setTimeout(call, timeout);
	}

	debounced.cancel = () => {
		if (timeoutId !== null) {
			clearTimeout(timeoutId);
			timeoutId = null;
		}
	};

	debounced.flush = () => {
		if (timeoutId !== null) {
			clearTimeout(timeoutId);
			timeoutId = null;
			call();
		}
	};

	return debounced as DTWrapper<T>;
}

/**
 * Throttles a promise returning function so that it never runs in parallel.
 *
 * If called when previous in progress, it behaves depending on `pendingBehavior` param:
 *
 * - `wait`: (default) returns currently pending promise
 * - `queue`: it'll queue promise creating function to be called after
 *            current one is done, and return promise for that
 */
export function promiseThrottle<T extends unknown = void, A extends unknown[] = unknown[]>(
	fn: (...args: A) => Promise<T>,
	pendingBehavior: 'queue' | 'wait' = 'wait'
): () => Promise<T> {
	let currentPromise: Promise<T> | null = null;
	let queued: {
		promise: Promise<T>;
		args: A;
		resolve: (value: T) => void;
		reject: (error: unknown) => void;
	} | null = null;
	const queue = pendingBehavior === 'queue';

	async function call(...args: A): Promise<T> {
		if (currentPromise) {
			if (queue) {
				if (queued) {
					queued.args = args;
					return queued.promise;
				} else {
					const [promise, resolve, reject] = makePromise<T>();
					queued = {promise, resolve, reject, args};
					return promise;
				}
			} else {
				return currentPromise;
			}
		}

		try {
			currentPromise = fn(...args);
			return await currentPromise;
		} finally {
			while (queued) {
				const {reject, resolve, args} = queued;
				queued = null;
				try {
					currentPromise = fn(...args);
					resolve(await currentPromise);
				} catch (error) {
					reject(error);
				}
			}

			currentPromise = null;
		}
	}

	return call;
}

/**
 * Creates a promise, and extracts its controls to be used externally.
 */
export function makePromise<T extends any = void>(): [Promise<T>, (value: T) => void, (error: any) => void] {
	let resolve: (value: T) => void;
	let reject: (error: any) => void;
	const promise = new Promise<T>((res, rej) => {
		resolve = res;
		reject = rej;
	});
	return [promise, resolve!, reject!];
}

/**
 * Check for any controllable elements (input, textarea, range, radio, checkboxes, ...).
 */
export function isControllableElement(value: any): boolean {
	if (value == null || typeof value.nodeName !== 'string') return false;
	if (value.nodeName === 'TEXTAREA' || value.nodeName === 'INPUT') return !value.readOnly;
	return false;
}

/**
 * Check for input elements only (input & textarea).
 */
export function isInputAbleElement(value: any): boolean {
	if (value == null || typeof value.nodeName !== 'string') return false;
	if (value.nodeName === 'TEXTAREA') return !value.readOnly;
	if (value.nodeName === 'INPUT') {
		if (value.type === 'checkbox') return false;
		if (value.type === 'radio') return false;
		if (value.type === 'range') return false;
		return !value.readOnly;
	}
	return false;
}

/**
 * Check for interactive elements (buttons, input, textarea, ...).
 */
export function isInteractiveElement(value: any): boolean {
	if (value == null || typeof value.nodeName !== 'string') return false;
	if (value.nodeName === 'BUTTON') return !value.disabled;
	return isControllableElement(value);
}

/**
 * Find index of a closest number in an array to the passed one.
 */
export function indexOfClosestTo(array: number[], value: number) {
	if (array.length === 0) return -1;

	let smallestDelta = Infinity;
	let closestIndex = 0;

	for (let i = 0; i < array.length; i++) {
		const step = array[i]!;
		const delta = Math.abs(value - step);
		if (delta < smallestDelta) {
			closestIndex = i;
			smallestDelta = delta;
		} else if (delta > smallestDelta) {
			break;
		}
	}
	return closestIndex;
}

/**
 * Combines overlapping cuts, clamps overflowing cuts to boundaries, removes
 * cuts outside boundaries, orders all cuts, as well as each cut's dimensions.
 *
 * `frameTime`: rounds all cuts to increments of this, and combines cuts that
 *              are less than this amount of time apart
 */
export function sanitizeCuts(cuts: Cuts, duration: number, frameTime = 0) {
	if (!cuts || cuts.length === 0) return undefined;

	const sanitizeTime =
		frameTime > 0
			? (time: number) => clamp(0, round(time / frameTime) * frameTime, duration)
			: (time: number) => clamp(0, time, duration);

	const newCuts = cuts
		// Order each cut's dimensions and clamp them within boundaries
		.map((cut) => [sanitizeTime(min(...cut)), sanitizeTime(max(...cut))] as Cut)
		// Remove empty, or cut's outside boundaries
		.filter((cut) => !(cut[0] >= duration || cut[1] <= 0 || cut[1] - cut[0] === 0));

	for (let i = 0; i < newCuts.length; i++) {
		const a = newCuts[i]!;

		for (let j = 0; j < newCuts.length; j++) {
			const b = newCuts[j]!;

			if (a === b) continue;

			if (doCutsIntersect(a, b, frameTime)) {
				const from = min(...a, ...b);
				const to = max(...a, ...b);
				a[0] = from;
				a[1] = to;
				newCuts.splice(j, 1);
				j--;
			}
		}
	}

	const result = newCuts.filter((cut) => cut[1] - cut[0] >= frameTime).sort((a, b) => a[0] - b[0]);

	return result.length > 0 ? result : undefined;
}

/**
 * Cont total duration of cuts.
 */
export function countCutsDuration(cuts: Cut[]) {
	return cuts.reduce((duration, cut) => duration + cut[1] - cut[0], 0);
}

/**
 * Check if cuts intersect.
 */
export function doCutsIntersect([a0, a1]: Cut, [b0, b1]: Cut, threshold = 0) {
	const thresholdPlusPrecisionError = threshold + 1 / 1e15;
	return (
		// a0 intersects b cut
		(a0 > b0 && a0 < b1) ||
		// a1 intersects b cut
		(a1 > b0 && a1 < b1) ||
		// b0 intersects a cut: covers b being inside a
		(b0 > a0 && b0 < a1) ||
		// Any of the cut's sides are touching each other within threshold limit
		abs(b0 - a1) <= thresholdPlusPrecisionError ||
		abs(a0 - b1) <= thresholdPlusPrecisionError
	);
}

/**
 * Cuts out a portion of cuts timeline.
 */
export function cutCuts(cuts: Cut[], [from, to]: Cut, minCutLength = 0) {
	const cutCuts: Cut[] = [];

	for (const cut of cuts) {
		if (!doCutsIntersect(cut, [from, to])) continue;
		const newCut: Cut = [max(cut[0], from), min(cut[1], to)];
		if (newCut[1] - newCut[0] > minCutLength) cutCuts.push(newCut);
	}

	return cutCuts;
}

/**
 * Determines seek time based on active modifier keys.
 */
export function seekTimeFromModifiers(event: KeyboardEvent | MouseEvent, frameTime: number) {
	return (
		{
			[shortcuts.seekFrameModifier]: frameTime,
			[shortcuts.seekMoreModifier]: 5000,
			[shortcuts.seekMediumModifier]: 10000,
			[shortcuts.seekBigModifier]: 30000,
		}[idModifiers(event)] ?? 1000
	);
}

/**
 * Calls onChange whenever theme changes. Initial call executes onChange synchronously.
 *
 * Returns disposer.
 */
export function tapTheme(element: HTMLElement, onChange: (theme: Theme) => void) {
	const themeContainer = element.closest<HTMLDivElement>('[data-theme]');

	if (!themeContainer) throw new Error(`No theme container found for element.`);

	const getTheme = () => (themeContainer.dataset.theme === 'dark' ? 'dark' : 'light') as Theme;
	let lastTheme = getTheme();

	const observer = new MutationObserver((mutations) => {
		for (const mutation of mutations) {
			if (mutation.type === 'attributes') {
				const newTheme = getTheme();
				if (newTheme !== lastTheme) {
					lastTheme = newTheme;
					onChange(newTheme);
				}
			}
		}
	});

	observer.observe(themeContainer, {attributes: true});

	onChange(lastTheme);

	return () => observer.disconnect();
}

/**
 * Move an item in an array from one index to another.
 *
 * Modifies the array in place, and returns it.
 */
export function moveItem<T extends unknown>(array: T[], fromIndex: number, toIndex: number): T[] {
	if (fromIndex < 0 || fromIndex >= array.length || toIndex < 0 || toIndex >= array.length) {
		throw new Error(`Invalid index parameters.`);
	}

	const fromItem = array[fromIndex]!;

	array.splice(fromIndex, 1);
	array.splice(toIndex, 0, fromItem);

	return array;
}

/**
 * Buffers, concatenates, and returns stdout of the passed process.
 */
export function getStdout(process: ChildProcessWithoutNullStreams) {
	return new Promise<Buffer>((resolve, reject) => {
		let buffers: Buffer[] = [];
		let stderr = '';

		process.stdout.on('data', (data: Buffer) => {
			buffers.push(data);
		});
		process.stderr.on('data', (data: Buffer) => {
			stderr += data.toString();
		});

		let done = (err?: Error | null, code?: number | null) => {
			done = () => {};
			if (err) {
				reject(err);
			} else if (code != null && code > 0) {
				reject(new Error(`Process exited with code ${code}. Stderr:\n\n${stderr || 'empty'}`));
			} else {
				resolve(Buffer.concat(buffers));
			}
		};

		process.on('error', (err) => done(err));
		process.on('close', (code) => done(null, code));
	});
}

/**
 * Converts sharp meta to ImageMeta.
 */
export async function sharpToImageMeta(sharpMeta: Sharp.Metadata, filePath: string): Promise<ImageMeta> {
	const {format, width, height, pages} = sharpMeta;
	if (format && width && height && (!pages || pages === 1)) {
		return {
			path: filePath,
			type: 'image',
			codec: format,
			size: (await FSP.stat(filePath)).size,
			container: Path.extname(filePath).slice(1).toLocaleLowerCase().replace('jpeg', 'jpg'),
			width,
			height,
			sar: 1,
			dar: width / height,
			displayWidth: width,
			displayHeight: height,
		};
	}

	throw new Error(`Incomplete or unsupported sharp meta.`);
}

/**
 * Parses and decodes binary data from sharp loader.
 */
export function splitSharpLoad(stdout: Buffer): {meta: Sharp.Metadata; data: ImageData} {
	const delimiterIndex = stdout.indexOf(META_DATA_BINARY_DELIMITER);
	const meta = JSON.parse(stdout.slice(0, delimiterIndex).toString()) as Sharp.Metadata;
	const imageDataBuffer = stdout.slice(delimiterIndex + META_DATA_BINARY_DELIMITER.length);
	return {meta, data: new ImageData(new Uint8ClampedArray(imageDataBuffer), meta.width!, meta.height!)};
}

/**
 * Finishes up completed operation by renaming temporary files to their final
 * destination, or deleting them when min savings were not met.
 */
export async function operationCleanup({
	inputPath,
	tmpPath,
	minSavings,
	inputSize,
	outputExtension,
	savingOptions,
	codec,
	utils: {log, output},
}: {
	inputPath: string;
	tmpPath: string;
	outputExtension: string;
	minSavings: number;
	inputSize: number;
	codec: string;
	savingOptions: SaveAsPathOptions;
	utils: ProcessorUtils;
}) {
	const {size: newSize} = await FSP.stat(tmpPath);
	const savings = ((inputSize - newSize) / inputSize) * -1;
	const savingsPercent = numberToPercent(savings);

	// If min file size savings were not met, revert to original
	if (minSavings) {
		log(`Checking min savings requirement...`);

		const requiredMaxSize = inputSize * (1 - minSavings / 100);

		if (newSize > requiredMaxSize) {
			try {
				await FSP.unlink(tmpPath);
			} catch {}

			const message = `Min savings of ${numberToPercent(-minSavings / 100)} not satisfied: ${
				savings > 0
					? `result file was ${savingsPercent} larger.`
					: `result file was only ${savingsPercent} smaller.`
			}\nReverting original file.`;

			log(message);
			output.file(inputPath, {
				flair: {variant: 'warning', title: 'reverted', description: message},
			});

			return;
		} else {
			log(`Min savings satisfied.`);
		}
	}

	try {
		const outputPath = await saveAsPath(inputPath, tmpPath, outputExtension, {
			...savingOptions,
			extraVariables: {codec},
			onOutputPath: (outputPath) => {
				log(`Moving temporary file to destination:
----------------------------------------
Temp: ${tmpPath}
Dest: ${outputPath}
----------------------------------------`);
			},
		});

		output.file(outputPath, {
			flair:
				savings < 0
					? {
							variant: 'success',
							title: savingsPercent,
							description: `Result is ${savingsPercent} smaller than the original.`,
					  }
					: {
							variant: 'danger',
							title: `+${savingsPercent}`,
							description: `Result is ${savingsPercent} larger than the original.`,
					  },
		});
	} finally {
		// Cleanup
		try {
			log(`Deleting temporary file if any.`);
			await FSP.unlink(tmpPath);
		} catch {}
	}
}
