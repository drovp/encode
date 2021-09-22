import {runFFmpegAndCleanup, ProgressReporter} from './ffmpeg';
import {AudioData} from './meta';
import {SaveAsPathOptions, saveAsPath} from '@drovp/save-as-path';

export type From = number;
export type To = number;
export type ResultPath = string;

export interface AudioOptions {
	cuts?: [From, To][]; // TODO: add support for this
	codec: 'mp3' | 'opus';

	mp3: {
		mode: 'vbr' | 'cbr';
		vbr: number; // 0: best, 9: worst
		cbr: number; // Kbit/s
		compression_level: number; // 0: high quality/slow, 9: low quality/fast
	};

	opus: {
		mode: 'cbr' | 'vbr' | 'cvbr';
		bitrate: number; // Kbit/s
		compression_level: number; // 0 - low quality/fast, 10 - high quality/slow
		application: 'voip' | 'audio' | 'lowdelay';
	};

	minSavings: number;
}

export interface ProcessOptions {
	onLog: (message: string) => void;
	onWarning: (message: string) => void;
	onProgress: ProgressReporter;
	cwd: string;
}

export async function processAudio(
	ffmpegPath: string,
	item: AudioData,
	options: AudioOptions,
	savingOptions: SaveAsPathOptions,
	processOptions: ProcessOptions
): Promise<ResultPath | undefined> {
	const args: (string | number)[] = [];
	let outputType: 'mp3' | 'ogg';

	// Input file
	args.push('-i', item.path);

	// Encoder configuration
	if (options.codec === 'opus') {
		outputType = 'ogg';
		args.push('-c:a', 'opus');

		// FFmpeg doesn't support muxing cover arts into ogg files: https://trac.ffmpeg.org/ticket/4448
		// Until that is fixed, we need to drop the cover, or it creates a file that some players choke on.
		args.push('-vn');

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

		args.push('-b:a', `${options.opus.bitrate}k`);

		args.push('-compression_level', options.opus.compression_level);
		args.push('-application', options.opus.application);
	} else {
		outputType = 'mp3';
		args.push('-c:a', 'libmp3lame');

		// Quality/bitrate
		if (options.mp3.mode === 'vbr') args.push('-q:a', options.mp3.vbr);
		else args.push('-b:a', `${options.mp3.cbr}k`);

		args.push('-compression_level', options.mp3.compression_level);

		// Ensure album art gets copied over
		args.push('-c:v', 'copy');
		args.push('-id3v2_version', '3');
	}

	const destinationPath = await saveAsPath(item.path, outputType, savingOptions);
	const tmpPath = `${destinationPath}.tmp${Math.random().toString().slice(-6)}`;

	// Enforce output type
	args.push('-f', outputType, tmpPath);

	return await runFFmpegAndCleanup({
		item,
		ffmpegPath,
		args,
		destinationPath,
		tmpPath,
		deleteOriginal: !!savingOptions.deleteOriginal,
		minSavings: options.minSavings,
		...processOptions,
	});
}
