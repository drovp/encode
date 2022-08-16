import {runFFmpegAndCleanup} from './ffmpeg';
import {countCutsDuration} from 'lib/utils';
import {AudioMeta} from 'ffprobe-normalized';
import {SaveAsPathOptions} from '@drovp/save-as-path';
import {ProcessorUtils} from '@drovp/types';

export interface AudioOptions {
	codec: 'mp3' | 'opus';

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
	let outputType: 'mp3' | 'ogg';
	const {cuts, speed} = options;
	let totalSize = inputs.reduce((size, input) => size + input.size, 0);
	let totalDuration = inputs.reduce((duration, input) => duration + input.duration, 0);
	let preventSkipThreshold = false;
	let outputStream: {name: string; channels: number};
	const filterGroups: string[] = [];

	if (processOptions.verbose) args.push('-v', 'verbose');

	// Inputs
	for (const input of inputs) args.push('-i', input.path);

	// Name or concat
	if (inputs.length === 1) {
		// Name a stream so filters can work with it
		const name = `[in]`;
		filterGroups.push(`[0:a:0]anull${name}`);
		outputStream = {name, channels: inputs[0]!.channels};
	} else {
		preventSkipThreshold = true;

		// Concatenate
		let inLinks: string[] = inputs.map((_, i) => `[${i}:a:0]`);
		outputStream = {
			name: `[concat]`,
			channels: inputs.reduce((channels, audio) => (audio.channels > channels ? audio.channels : channels), 0),
		};
		filterGroups.push(`${inLinks.join('')}concat=n=${inLinks.length}:v=0:a=1${outputStream.name}`);
	}

	// Cuts
	if (cuts) {
		preventSkipThreshold = true;
		const betweens = cuts.map(([from, to]) => `between(t,${from / 1000},${to / 1000})`).join('+');
		const newName = `[cuts]`;
		filterGroups.push(`${outputStream.name}aselect='${betweens}',asetpts=N/SR/TB${newName}`);
		outputStream.name = newName;
		totalDuration = countCutsDuration(cuts);
	}

	// Speed
	if (speed !== 1) {
		if (!(speed >= 0.5 && speed <= 100)) {
			throw new Error(`Speed "${speed}" is outside of allowed range of 0.5-100.`);
		}

		preventSkipThreshold = true;
		const newName = `[tempo]`;
		filterGroups.push(`${outputStream.name}atempo=${speed}${newName}`);
		outputStream.name = newName;
		totalDuration /= speed;
	}

	if (filterGroups.length > 0) args.push('-filter_complex', filterGroups.join(';'));

	args.push('-map', outputStream.name);

	// Encoder configuration
	if (options.codec === 'opus') {
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

		args.push('-b:a', `${options.opus.bpch * outputStream.channels}k`);

		args.push('-compression_level', options.opus.compression_level);
		args.push('-application', options.opus.application);
	} else {
		// Use cover from 1st file if any
		args.push('-map', '0:v?');

		outputType = 'mp3';
		args.push('-c:a', 'libmp3lame');

		// Quality/bitrate
		if (options.mp3.mode === 'vbr') args.push('-q:a', options.mp3.vbr);
		else args.push('-b:a', `${options.mp3.cbrpch * outputStream.channels}k`);

		args.push('-compression_level', options.mp3.compression_level);

		// Ensure album art gets copied over
		args.push('-c:v', 'copy');
		args.push('-id3v2_version', '3');
	}

	// Enforce output type
	args.push('-f', outputType);

	// Calculate KBpCHpM and check if we can skip encoding this file
	const skipThreshold = options.skipThreshold;

	if (skipThreshold && !preventSkipThreshold) {
		const KB = totalSize / 1024;
		const minutes = totalDuration / 1000 / 60;
		const KBpCHpM = KB / outputStream.channels / minutes;

		if (skipThreshold > KBpCHpM) {
			const message = `Audio's ${Math.round(
				KBpCHpM
			)} KB/ch/m bitrate is smaller than skip threshold, skipping encoding.`;

			processOptions.utils.log(message);
			processOptions.utils.output.file(firstInput.path, {
				flair: {variant: 'warning', title: 'skipped', description: message},
			});

			return;
		}
	}

	// Finally, encode the file
	await runFFmpegAndCleanup({
		ffmpegPath,
		inputPaths: inputs.map(({path}) => path),
		inputSize: totalSize,
		expectedDuration: totalDuration,
		args,
		codec: options.codec,
		outputExtension: outputType,
		savingOptions,
		minSavings: options.minSavings,
		...processOptions,
	});
}
