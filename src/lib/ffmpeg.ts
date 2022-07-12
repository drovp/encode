import {spawn} from 'child_process';
import {promises as FSP} from 'fs';
import * as Path from 'path';
import {isoTimeToMS, msToIsoTime, numberToPercent, uid} from './utils';
import {SaveAsPathOptions, saveAsPath} from '@drovp/save-as-path';
import {ProcessorUtils} from '@drovp/types';
import {ImageMeta, VideoMeta} from 'ffprobe-normalized';
import {FALLBACK_AUDIO_DIRECTORY} from 'config';

export type ProgressReporter = (completed: number, total: number) => void;

const toString = (value: any) => `${value}`;

/**
 * Abstracted ffmpeg execution and final file handling for each processor.
 * `args` should leave out output path, that is appended internally.
 */
export async function runFFmpegAndCleanup({
	inputPath,
	inputSize,
	expectedDuration,
	ffmpegPath,
	args,
	outputExtension,
	codec,
	savingOptions,
	minSavings,
	utils: {log, progress, output},
	cwd,
}: {
	inputPath: string;
	inputSize: number;
	expectedDuration?: number;
	ffmpegPath: string;
	args: (string | number)[];
	outputExtension: string;
	codec: string;
	savingOptions: SaveAsPathOptions;
	minSavings: number; // a percent number between 0-100
	utils: ProcessorUtils;
	cwd: string;
}): Promise<void> {
	const noExtPath = Path.join(Path.dirname(inputPath), Path.basename(inputPath, Path.extname(inputPath)));
	const tmpPath = `${noExtPath}.tmp${Math.random().toString().slice(-6)}`;
	args = [...args, tmpPath];

	try {
		// Ensure directories exist
		await FSP.mkdir(Path.dirname(tmpPath), {recursive: true});

		// Run ffmpeg
		await ffmpeg(ffmpegPath, args, {onLog: log, onProgress: progress, expectedDuration, cwd});
		const {size: newSize} = await FSP.stat(tmpPath);
		const savings = ((inputSize - newSize) / inputSize) * -1;
		const savingsPercent = numberToPercent(savings);

		// If min file size savings were not met, revert to original
		if (minSavings) {
			log(`Checking min savings requirements.`);

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

/**
 * Raw ffmpeg cli wrapper that provides progress and log reporting.
 */
export function ffmpeg(
	ffmpegPath: string = 'ffmpeg',
	args: (string | number)[],
	{
		onLog,
		onProgress,
		expectedDuration,
		cwd,
	}: {
		onLog?: (message: string) => void;
		onProgress?: ProgressReporter;
		expectedDuration?: number;
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
		let duration = expectedDuration;
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
						const milliseconds = isoTimeToMS(timeMatch);
						if (milliseconds <= duration) onProgress(milliseconds, duration);
					}
				}

				return;
			}

			onLog?.(message);

			// Attempt to extract duration if it wasn't yet, and we are still expecting it
			if (duration || !onProgress || durationWontHappen) return;

			const durationMatch = /^ *Duration: *([\d\:\.]+),/m.exec(stderr)?.[1];
			if (durationMatch) duration = isoTimeToMS(durationMatch) || 0;
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
	return value[0] === '-' ? value : value.match(/["'\/:\\\s\[\]]/) ? `"${value.replaceAll('"', '\\"')}"` : value;
}

/**
 * Spawns ffmpeg that outputs raw image data at native framerate speed.
 */
function spawnRawFfmpeg({
	ffmpegPath,
	meta,
	seekTo,
	streamIndex = 0,
	singleFrame,
	outputSize,
	fps,
	speed = 1,
}: {
	ffmpegPath: string;
	meta: ImageMeta | VideoMeta;
	/**
	 * Milliseconds.
	 */
	seekTo?: number;
	streamIndex?: number;
	singleFrame?: boolean;
	outputSize?: number;
	fps?: number;
	speed?: number;
}) {
	const aspectRatio = meta.width / meta.height;
	const filters: string[] = [];
	const args = ['-hide_banner', '-loglevel', 'panic'];
	let newWidth = meta.width;
	let newHeight = meta.height;

	if (fps) filters.push(`fps=${fps}`);

	if (outputSize) {
		if (meta.width > meta.height) {
			newWidth = outputSize;
			newHeight = Math.floor(newWidth / aspectRatio);
		} else {
			newHeight = outputSize;
			newWidth = Math.floor(newHeight * aspectRatio);
		}

		filters.push(`scale=${newWidth}:${newHeight}:flags=lanczos`);
	}

	// Read input at native frame rate
	if (!singleFrame) args.push('-readrate', `${speed}`);

	// Seek to
	if (seekTo) args.push('-ss', msToIsoTime(seekTo));

	// Get raw frame rotation, ignoring metadata overrides
	args.push('-noautorotate');

	// Input
	args.push('-i', meta.path, '-map', `0:${streamIndex}`);

	// Filters
	if (filters.length > 0) args.push('-vf', filters.join(','));

	// Output format
	args.push('-vcodec', 'rawvideo', '-pix_fmt', 'rgba');

	// Stop after 1 frame
	if (singleFrame) args.push('-frames:v', '1');

	// Output to stdout
	args.push('-f', 'rawvideo', '-');

	return {
		width: newWidth,
		height: newHeight,
		frameSize: newWidth * newHeight * 4,
		process: spawn(ffmpegPath, args),
	};
}

export function getOneRawFrame(options: Omit<Parameters<typeof spawnRawFfmpeg>[0], 'singleFrame'>) {
	return new Promise<ImageData>((resolve, reject) => {
		const {process, width, height, frameSize} = spawnRawFfmpeg({...options, singleFrame: true});
		let stderr = '';
		let buffers: Buffer[] = [];

		let receivedLength = 0;

		process.stdout.on('data', (data: Buffer) => {
			receivedLength += data.length;
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
				if (receivedLength === 0) {
					// If ffmpeg didn't throw any errors and at the same time we didn't receive anything,
					// it probably means there is no video data at the seeked time. This happens when
					// requesting one of the last frames in files where audio track is slightly
					// longer than video track.
					// To not break things, we just construct an empty black frame.
					const blackBuffer = Buffer.alloc(frameSize);
					blackBuffer.fill(new Uint8Array([0, 0, 0, 255]));
					buffers = [blackBuffer];
				} else if (receivedLength !== frameSize) {
					reject(new Error(`Frame data was incomplete. Stderr:\n\n${stderr || 'empty'}`));
					return;
				}

				resolve(new ImageData(new Uint8ClampedArray(Buffer.concat(buffers)), width, height));
			}
		};

		process.on('error', (err) => done(err));
		process.on('close', (code) => done(null, code));
	});
}

/**
 * Creates a stream of video frames in ImageData format at configured speed.
 */
export function makeFrameStream({
	onFrame,
	onError,
	onEnd,
	maxLogSize = 100000,
	...spawnOptions
}: Omit<Parameters<typeof spawnRawFfmpeg>[0], 'singleFrame'> & {
	onError: (error: unknown) => void;
	onFrame: (image: ImageData) => void;
	onEnd: () => void;
	maxLogSize?: number;
}) {
	const {process, width, height, frameSize} = spawnRawFfmpeg({...spawnOptions, singleFrame: false});
	let stderr = '';
	let buffer: Buffer | null = null;
	let killed = false;

	process.stdout.on('data', (data: Buffer) => {
		buffer = buffer ? Buffer.concat([buffer, data]) : data;

		if (buffer.length >= frameSize) {
			const imageData = new ImageData(new Uint8ClampedArray(buffer.slice(0, frameSize)), width, height);
			buffer = buffer.slice(frameSize);
			onFrame(imageData);
		}
	});
	process.stderr.on('data', (data: Buffer) => {
		stderr = (stderr + data.toString()).slice(-maxLogSize);
	});
	process.on('error', (err) => onError(err));
	process.on('close', (code) => {
		if (killed) return;
		if (code !== 0) {
			onError(new Error(`Process exited with code ${code}. Stderr:\n\n${stderr}`));
		} else {
			onEnd();
		}
	});

	return () => {
		killed = true;
		process.kill();
	};
}

/**
 * Creates a stream of raw PCM audio data in Uint8Array chunks streaming at
 * configured speed.
 */
export function makeAudioStream(
	inputPath: string,
	{
		ffmpegPath,
		speed = 1,
		seekTo,
		onData,
		onError,
		onEnd,
		maxLogSize = 100000,
	}: {
		ffmpegPath: string;
		speed?: number;
		/** In milliseconds. */
		seekTo?: number;
		onData: (data: Buffer) => void;
		onError: (error: unknown) => void;
		onEnd: () => void;
		maxLogSize?: number;
	}
) {
	const args = ['-y'];

	// Read input at native frame rate
	args.push('-readrate', `${speed}`);

	// Seek to
	if (seekTo) args.push('-ss', msToIsoTime(seekTo));

	args.push('-i', inputPath);
	args.push('-map', '0:a:0');
	args.push('-acodec', 'pcm_s16be');
	args.push('-ar', '44100');
	args.push('-ac', '2');
	args.push('-payload_type', '10');
	args.push('-f', 'data', '-');

	const process = spawn(ffmpegPath, args);
	let stderr = '';
	let killed = false;

	process.stdout.on('data', onData);
	process.stderr.on('data', (data: Buffer) => {
		stderr = (stderr + data.toString()).slice(-maxLogSize);
	});
	process.on('error', (err) => onError(err));
	process.on('close', (code) => {
		if (killed) return;
		if (code !== 0) {
			onError(new Error(`Process exited with code ${code}. Stderr:\n\n${stderr}`));
		} else {
			onEnd();
		}
	});

	return () => {
		killed = true;
		process.kill();
	};
}

/**
 * Returns an ImageData with a media file (video or audio) waveform.
 */
export function getWaveform({
	ffmpegPath,
	path,
	width = 640,
	height = 120,
	colors = 'ffffff66',
}: {
	ffmpegPath: string;
	path: string;
	width?: number;
	height?: number;
	/**
	 * Colors separated by ’|’ which are going to be used for drawing of each channel.
	 *
	 * Example: `white|red`
	 * Default: `ffffff66`
	 */
	colors?: string;
}) {
	return new Promise<ImageData>((resolve, reject) => {
		const args: string[] = [];

		// Input
		args.push('-i', path);

		// Waveform
		args.push('-filter_complex', `showwavespic=s=${width}x${height}:colors=${colors}`);

		// Output format
		args.push('-vcodec', 'rawvideo', '-pix_fmt', 'rgba');

		// Output to stdout
		args.push('-frames:v', '1', '-f', 'rawvideo', '-');

		const process = spawn(ffmpegPath, args);
		let stderr = '';
		let buffers: Buffer[] = [];

		const dataLength = width * height * 4;
		let receivedLength = 0;

		process.stdout.on('data', (data: Buffer) => {
			receivedLength += data.length;
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
				reject(new Error(`Process exited with code ${code}.\nStderr:\n----------\n${stderr}`));
			} else {
				if (buffers.length === 0 || receivedLength !== dataLength) {
					reject(
						new Error(
							`Process didn't output any data, or data was incomplete.\nStderr:\n-------\n${stderr}`
						)
					);
				} else {
					resolve(new ImageData(new Uint8ClampedArray(Buffer.concat(buffers)), width, height));
				}
			}
		};

		process.on('error', (err) => done(err));
		process.on('close', (code) => done(null, code));
	});
}

/**
 * Converts audio file into something that can be played by a browser, quick!
 */
export async function encodeFallbackAudio(inputPath: string, {ffmpegPath}: {ffmpegPath: string}): Promise<string> {
	const inputFilename = Path.basename(inputPath, Path.extname(inputPath));
	const outputPath = Path.join(FALLBACK_AUDIO_DIRECTORY, `${inputFilename}-${uid()}.wav`);

	await FSP.mkdir(FALLBACK_AUDIO_DIRECTORY, {recursive: true});
	await ffmpeg(ffmpegPath, ['-y', '-i', inputPath, '-map', '0:a:0', outputPath]);

	return outputPath;
}
