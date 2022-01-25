import {spawn} from 'child_process';
import {promises as FSP} from 'fs';
import * as Path from 'path';
import {humanTimeToMS, numberToPercent} from './utils';
import {SaveAsPathOptions, saveAsPath} from '@drovp/save-as-path';
import {MetaData} from 'ffprobe-normalized';

export type ProgressReporter = (completed: number, total: number) => void;

const toString = (value: any) => `${value}`;

/**
 * Abstracted ffmpeg execution and final file handling for each processor.
 * `args` should leave out output path, that is appended internally.
 */
export async function runFFmpegAndCleanup({
	item,
	ffmpegPath,
	args,
	outputExtension,
	codec,
	savingOptions,
	minSavings,
	onLog,
	onWarning: _onWarning, // Unused atm
	onProgress,
	cwd,
}: {
	item: MetaData;
	ffmpegPath: string;
	args: (string | number)[];
	outputExtension: string;
	codec: string;
	savingOptions: SaveAsPathOptions;
	minSavings: number; // a percent number between 0-100
	onLog?: (message: string) => void;
	onWarning?: (message: string) => void;
	onProgress?: ProgressReporter;
	cwd: string;
}) {
	const noExtPath = Path.join(Path.dirname(item.path), Path.basename(item.path, Path.extname(item.path)));
	const tmpPath = `${noExtPath}.tmp${Math.random().toString().slice(-6)}`;
	args = [...args, tmpPath];

	try {
		// Ensure directories exist
		await FSP.mkdir(Path.dirname(tmpPath), {recursive: true});

		// Run ffmpeg
		await ffmpeg(ffmpegPath, args, {onLog, onProgress, cwd});

		// If min file size savings were not met, revert to original
		if (minSavings) {
			onLog?.(`Checking min savings requirements.`);

			const {size} = await FSP.stat(tmpPath);
			const requiredMaxSize = item.size * (1 - minSavings / 100);

			if (size > requiredMaxSize) {
				try {
					await FSP.unlink(tmpPath);
				} catch {}

				const savings = (item.size - size) / item.size;

				onLog?.(
					`Min savings not satisfied. ${
						savings < 0
							? `Result file was ${numberToPercent(Math.abs(savings))} bigger than original.`
							: `Result file was only ${numberToPercent(Math.abs(savings))} smaller than original.`
					} Reverting original file.`
				);
				return;
			} else {
				onLog?.(`Min savings satisfied.`);
			}
		}

		return await saveAsPath(item.path, tmpPath, outputExtension, {
			...savingOptions,
			extraVariables: {codec},
			onOutputPath: (outputPath) => {
				onLog?.(`Moving temporary file to destination:
----------------------------------------
Temp: ${tmpPath}
Dest: ${outputPath}
----------------------------------------`);
			},
		});
	} finally {
		// Cleanup
		try {
			onLog?.(`Deleting temporary file if any.`);
			await FSP.unlink(tmpPath);
		} catch {}
	}
}

/**
 * Raw ffmpeg cli wrapper that provides progress and log reporting.
 */
export function ffmpeg(
	ffmpegPath: string = 'ffmpeg',
	args: (string | number)[],
	{
		onLog,
		onProgress,
		cwd,
	}: {
		onLog?: (message: string) => void;
		onProgress?: ProgressReporter;
		cwd?: string;
	} = {}
) {
	return new Promise<void>((resolve, reject) => {
		const finalArgs = ['-y'].concat(args.map(toString));

		onLog?.(`Executing ffmpeg with these parameters:
----------------------------------------
${finalArgs.map(argToParam).join(' ')}
----------------------------------------`);

		const cp = spawn(ffmpegPath, finalArgs, {cwd});
		let stderr = '';
		let duration = 0;
		let durationWontHappen = false;

		cp.stdout.on('data', (data: Buffer) => onLog?.(data.toString()));

		// ffmpeg outputs progress to stderr...
		cp.stderr.on('data', (data: Buffer) => {
			const message = data.toString();
			stderr += message;

			// Take over progress reports
			const trimmedMessage = message.trim();
			if (trimmedMessage.startsWith('frame=') || trimmedMessage.startsWith('size=')) {
				durationWontHappen = true;

				if (onProgress && duration) {
					const timeMatch = /time=([\d\:\.]+)/.exec(message)?.[1];

					if (timeMatch) {
						const milliseconds = humanTimeToMS(timeMatch);
						if (milliseconds <= duration) onProgress(milliseconds, duration);
					}
				}

				return;
			}

			onLog?.(message);

			// Attempt to extract duration if it wasn't yet, and we are still expecting it
			if (duration || !onProgress || durationWontHappen) return;

			const durationMatch = /^ *Duration: *([\d\:\.]+),/m.exec(stderr)?.[1];
			if (durationMatch) duration = humanTimeToMS(durationMatch) || 0;
		});

		let done = (err?: Error | null, code?: number | null) => {
			done = () => {};
			if (err) {
				reject(err);
			} else if (code != null && code > 0) {
				reject(
					new Error(`Process exited with code ${code}.
Parameters:
----------
${finalArgs.map(argToParam).join(' ')}
----------
Stderr:
----------
${stderr}`)
				);
			} else {
				resolve();
			}
		};

		cp.on('error', (err) => done(err));
		cp.on('close', (code) => done(null, code));
	});
}

/**
 * Helper to converts params into strings as they'd be seen when uses in a console.
 */
function argToParam(value: string) {
	return value[0] === '-' ? value : value.match(/[^a-zA-Z0-9\-_]/) ? `"${value}"` : value;
}
