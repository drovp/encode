import {spawn} from 'child_process';
import {promises as FSP} from 'fs';
import {humanTimeToMS, numberToPercent} from './utils';
import {MetaData} from './meta';

export type ProgressReporter = (completed: number, total: number) => void;

const toString = (value: any) => `${value}`;

/**
 * Abstracted ffmpeg execution and final file handling for each processor.
 */
export async function runFFmpegAndCleanup({
	item,
	ffmpegPath,
	args,
	tmpPath,
	destinationPath,
	deleteOriginal,
	minSavings,
	onLog,
	onWarning,
	onProgress,
	cwd,
}: {
	item: MetaData;
	ffmpegPath: string;
	args: (string | number)[];
	tmpPath: string;
	destinationPath: string;
	deleteOriginal: boolean;
	minSavings: number;
	onLog?: (message: string) => void;
	onWarning?: (message: string) => void;
	onProgress?: ProgressReporter;
	cwd: string;
}) {
	try {
		await ffmpeg(ffmpegPath, args, {onLog, onProgress, cwd});

		// If min file size savings were not met, revert to original
		if (minSavings) {
			onLog?.(`Checking min savings requirements.`);

			const {size} = await FSP.stat(tmpPath);
			const requiredMaxSize = item.size * (1 - minSavings);

			if (size > requiredMaxSize) {
				try {
					await FSP.unlink(tmpPath);
				} catch (err) {}

				const savings = (item.size - size) / item.size;

				onLog?.(`Min savings not satisfied.`);

				onWarning?.(
					savings < 0
						? `Result file was ${numberToPercent(Math.abs(savings))} bigger than original.`
						: `Result file was only ${numberToPercent(Math.abs(savings))} smaller than original.`
				);

				return;
			} else {
				onLog?.(`Min savings satisfied.`);
			}
		}

		if (deleteOriginal) {
			onLog?.(`Deleting original file: ${item.path}`);
			await FSP.unlink(item.path);
		}

		onLog?.(`Renaming temporary file to desired destination:
----------------------------------------
Temp: ${tmpPath}
Dest: ${destinationPath}
----------------------------------------`);
		await FSP.rename(tmpPath, destinationPath);

		return destinationPath;
	} finally {
		// Cleanup
		try {
			onLog?.(`Deleting temporary file.`);
			await FSP.unlink(tmpPath);
		} catch (err) {}
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