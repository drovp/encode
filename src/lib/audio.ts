import {runFFmpegAndCleanup} from './ffmpeg';
import {cutCuts, msToIsoTime, formatSize} from 'lib/utils';
import {AudioMeta} from 'ffprobe-normalized';
import {SaveAsPathOptions} from '@drovp/save-as-path';
import {ProcessorUtils} from '@drovp/types';

export interface AudioOptions {
	codec: 'mp3' | 'opus' | 'wav' | 'flac';

	mp3: {
		mode: 'vbr' | 'cbr';
		vbr: number; // 0: best, 9: worst
		cbrpch: number; // Kbit/s/ch
		compression_level: number; // 0: high quality/slow, 9: low quality/fast
	};

	opus: {
		mode: 'cbr' | 'vbr' | 'cvbr';
		bpch: number; // Kbit/s/ch
		compression_level: number; // 0 - low quality/fast, 10 - high quality/slow
		application: 'voip' | 'audio' | 'lowdelay';
	};

	flac: {
		compression_level: number; // 0 - low quality/fast, 12 - high quality/slow
	};

	speed: number;
	minSavings: number;
	skipThreshold: number | null;

	// Edits
	cuts?: Cut[];
}

export interface ProcessOptions {
	utils: ProcessorUtils;
	cwd: string;
	verbose: boolean;
}

interface Segment {
	id: string;
	channels: number;
	duration: number;
}

/**
 * Resolves with result path.
 */
export async function processAudio(
	ffmpegPath: string,
	inputs: AudioMeta[],
	options: AudioOptions,
	savingOptions: SaveAsPathOptions,
	processOptions: ProcessOptions
): Promise<string | undefined> {
	const {utils} = processOptions;
	const firstInput = inputs[0];

	if (!firstInput) {
		utils.output.error('No inputs received.');
		return;
	}

	const args: (string | number)[] = [];
	let outputType: 'mp3' | 'ogg' | 'wav' | 'flac';
	const {cuts, speed, skipThreshold} = options;
	let isEdited = false;
	const ffmpegInputs: (string | number)[][] = []; // groups of arguments related to a single input, such as `-ss -t -i`
	const inputSegments: Segment[] = [];
	const filterGraph: string[] = [];
	const totalInputSize = inputs.reduce((size, input) => size + input.size, 0);

	if (processOptions.verbose) args.push('-v', 'verbose');
	if (cuts) args.push('-accurate_seek');

	let currentTime = 0;

	for (let i = 0; i < inputs.length; i++) {
		const input = inputs[i]!;

		utils.log(`==============================
Input[${i}]:
- Path: "${input.path}"
- Duration: ${msToIsoTime(input.duration)}
- Channels: ${input.channels}
------`);

		// Cuts
		if (cuts) {
			isEdited = true;
			const inputCuts = cutCuts(cuts, [currentTime, currentTime + input.duration], 10).map(
				(cut) => cut.map((time) => time - currentTime) as Cut
			);
			currentTime += input.duration;
			const firstCut = inputCuts[0];
			const lastCut = inputCuts.at(-1);

			if (!firstCut || !lastCut) {
				utils.log(`SKIPPING input, no cuts cover this segment.`);
				continue;
			}

			utils.log(`Extracting cuts:`);

			for (const [c, [from, to]] of inputCuts.entries()) {
				const fromIso = msToIsoTime(from);
				const toIso = msToIsoTime(to);

				utils.log(`→ ${c}: ${fromIso} - ${toIso}`);
				ffmpegInputs.push(['-ss', fromIso, '-to', toIso, '-i', input.path]);
				inputSegments.push({
					id: `${ffmpegInputs.length - 1}:a:0`,
					channels: input.channels,
					duration: to - from,
				});
			}
		} else {
			ffmpegInputs.push(['-i', input.path]);
			inputSegments.push({
				id: `${ffmpegInputs.length - 1}:a:0`,
				channels: input.channels,
				duration: input.duration,
			});
		}
	}

	args.push(...ffmpegInputs.flat());

	let outputSegment: Segment;

	// Name or concat
	if (inputSegments.length === 1) {
		// Name a stream so it doesn't break in `-map [id]`
		const segment = inputSegments[0]!;
		const id = `in`;
		filterGraph.push(`[${segment.id}]anull[${id}]`);
		outputSegment = {id, channels: segment.channels, duration: segment.duration};
	} else if (inputSegments.length > 1) {
		isEdited = true;

		// Concatenate
		let inLinks: string[] = inputSegments.map(({id}) => `[${id}]`);
		outputSegment = {
			id: `concat`,
			duration: inputSegments.reduce((duration, segment) => duration + segment.duration, 0),
			channels: inputs.reduce((channels, audio) => (audio.channels > channels ? audio.channels : channels), 0),
		};
		filterGraph.push(`${inLinks.join('')}concat=n=${inLinks.length}:v=0:a=1[${outputSegment.id}]`);
	} else {
		throw new Error(`Empty outputs. No input segments?`);
	}

	// Speed
	if (speed !== 1) {
		if (!(speed >= 0.5 && speed <= 100)) {
			throw new Error(`Speed "${speed}" is outside of allowed range of 0.5-100.`);
		}

		isEdited = true;
		const newId = `tempo`;
		filterGraph.push(`[${outputSegment.id}]atempo=${speed}[${newId}]`);
		outputSegment.id = newId;
		outputSegment.duration /= speed;
	}

	if (filterGraph.length > 0) args.push('-filter_complex', filterGraph.join(';'));

	args.push('-map', `[${outputSegment.id}]`);

	// Encoder configuration
	switch (options.codec) {
		case 'opus':
			outputType = 'ogg';
			args.push('-c:a', 'libopus');

			// FFmpeg doesn't support muxing cover arts into ogg files: https://trac.ffmpeg.org/ticket/4448
			// Until that is fixed, we need to drop the cover, or it creates a file that some players choke on.
			// args.push('-map', '0:v?');

			switch (options.opus.mode) {
				case 'vbr':
					args.push('-vbr', 'on');
					break;
				case 'cvbr':
					args.push('-vbr', 'constrained');
					break;
				default:
					args.push('-vbr', 'off');
			}

			args.push('-b:a', `${options.opus.bpch * outputSegment.channels}k`);

			args.push('-compression_level', options.opus.compression_level);
			args.push('-application', options.opus.application);
			break;

		case 'wav':
			outputType = 'wav';
			break;

		case 'flac':
			outputType = 'flac';
			args.push('-compression_level', options.flac.compression_level);
			break;

		case 'mp3':
			// Use cover from 1st file if any
			args.push('-map', '0:v?');

			outputType = 'mp3';
			args.push('-c:a', 'libmp3lame');

			// Quality/bitrate
			if (options.mp3.mode === 'vbr') args.push('-q:a', options.mp3.vbr);
			else args.push('-b:a', `${options.mp3.cbrpch * outputSegment.channels}k`);

			args.push('-compression_level', options.mp3.compression_level);

			// Ensure album art gets copied over
			args.push('-c:v', 'copy');
			args.push('-id3v2_version', '3');
			break;

		default:
			throw new Error(`Unsupported audio output format "${options.codec}".`);
	}

	// Enforce output type
	args.push('-f', outputType);

	// Skip encoding of files that are already compressed enough
	if (skipThreshold) {
		if (isEdited) {
			utils.log(`Skip threshold: Ignored due to file edits (concatenation, cuts, etc.).`);
		} else {
			const skipThresholdSize = outputSegment.channels * (outputSegment.duration / 1000) * skipThreshold;

			if (totalInputSize < skipThresholdSize) {
				const message = `Input size (${formatSize(
					totalInputSize
				)}B) is already smaller than skip threshold size (${formatSize(skipThresholdSize)}B).`;

				utils.log(`Skip threshold: ${message} Skipping encoding.`);

				processOptions.utils.log(message);
				processOptions.utils.output.file(firstInput.path, {
					flair: {variant: 'warning', title: 'skipped', description: message},
				});

				return;
			} else {
				utils.log(
					`Skip threshold: Input size (${formatSize(
						totalInputSize
					)}B) is bigger than skip threshold size (${formatSize(skipThresholdSize)}). Proceeding with encode.`
				);
			}
		}
	}

	// Finally, encode the file
	await runFFmpegAndCleanup({
		ffmpegPath,
		inputPaths: inputs.map(({path}) => path),
		inputSize: totalInputSize,
		expectedDuration: outputSegment.duration,
		args,
		codec: options.codec,
		outputExtension: outputType,
		savingOptions,
		minSavings: isEdited ? 0 : options.minSavings,
		...processOptions,
	});
}
