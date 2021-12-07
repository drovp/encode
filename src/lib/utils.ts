import * as CP from 'child_process';
import {promisify} from 'util';

export const exec = promisify(CP.exec);

/**
 * Extract error message.
 */
export function eem(error: any, preferStack = false) {
	return error instanceof Error ? (preferStack ? error.stack || error.message : error.message) : `${error}`;
}

/**
 * Constructor to be used for errors that should only display a message without
 * a stack to the user.
 */
export class MessageError extends Error {}

/**
 * '1:30:40.500' => {milliseconds}
 */
export function humanTimeToMS(text: string) {
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
 * {milliseconds} => '1:30:40.500'
 */
export function msToHumanTime(milliseconds: number) {
	milliseconds = Math.floor(milliseconds);

	const hours = String(Math.floor(milliseconds / (60 * 60 * 1000))).padStart(2, '0');
	milliseconds %= 60 * 60 * 1000;

	const minutes = String(Math.floor(milliseconds / (60 * 1000))).padStart(2, '0');
	milliseconds %= 60 * 1000;

	const seconds = String(Math.floor(milliseconds / 1000)).padStart(2, '0');
	milliseconds %= 1000;

	let result = `${hours}:${minutes}:${seconds}`;

	if (milliseconds > 0) result = `${result}.${String(milliseconds / 1000).slice(2)}`;

	return result;
}

/**
 * Format floating point number into percentage string.
 */
export function numberToPercent(value: number, precision: number = 0) {
	return `${(value * 100).toFixed(precision)}%`;
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
