import * as Path from 'path';
import type {ProcessorUtils} from '@drovp/types';
import type {Payload} from './';
import {getMeta} from './lib/meta';
import {processImage} from './lib/image';
import {processAudio} from './lib/audio';
import {processVideo} from './lib/video';

export type Dependencies = {
	ffmpeg: string;
	ffprobe: string;
};

export default async (payload: Payload, utils: ProcessorUtils<Dependencies>) => {
	const {input, options} = payload;
	const {output, dependencies, progress, log, stage} = utils;
	const ffmpegPath = `${options.ffmpegPath}`.trim() || dependencies.ffmpeg;
	const ffprobePath = `${options.ffprobePath}`.trim() || dependencies.ffprobe;

	/**
	 * Process the file.
	 */
	const inputMeta = await getMeta(input.path, {ffprobe: ffprobePath});
	const processOptions = {
		id: payload.id,
		onStage: stage,
		onLog: log,
		onProgress: progress,
		onWarning: output.warning,
		cwd: Path.dirname(input.path),
	};

	let outputFilePath: string | undefined;

	if (options[inputMeta.type].ignore) {
		output.warning(`Ignoring ${inputMeta.type}: ${Path.basename(input.path)}`);
		return;
	}

	switch (inputMeta.type) {
		case 'image': {
			const skipThreshold = options.image.skipThreshold;
			const KB = inputMeta.size / 1024;
			const MPX = (inputMeta.width * inputMeta.height) / 1e6;
			const KBpMPX = KB / MPX;

			if (skipThreshold && skipThreshold > KBpMPX) {
				console.log(
					`Image's ${Math.round(
						KBpMPX
					)} KB/Mpx data density is smaller than skip threshold, skipping encoding.`
				);
				break;
			}

			outputFilePath = await processImage(ffmpegPath, inputMeta, options.image, options.saving, processOptions);
			break;
		}

		case 'audio': {
			const skipThreshold = options.audio.skipThreshold;
			const KB = inputMeta.size / 1024;
			const minutes = inputMeta.duration / 1000 / 60;
			const KBpCHpM = KB / inputMeta.channels / minutes;

			if (skipThreshold && skipThreshold > KBpCHpM) {
				console.log(
					`Audio's ${Math.round(KBpCHpM)} KB/ch/m bitrate is smaller than skip threshold, skipping encoding.`
				);
				break;
			}

			outputFilePath = await processAudio(ffmpegPath, inputMeta, options.audio, options.saving, processOptions);
			break;
		}

		case 'video': {
			const skipThreshold = options.video.skipThreshold;
			const KB = inputMeta.size / 1024;
			const MPX = (inputMeta.width * inputMeta.height) / 1e6;
			const minutes = inputMeta.duration / 1000 / 60;
			const KBpMPXpM = KB / MPX / minutes;

			if (skipThreshold && skipThreshold > KBpMPXpM) {
				console.log(
					`Video's ${Math.round(
						KBpMPXpM
					)} KB/Mpx/m bitrate is smaller than skip threshold (${skipThreshold}), skipping encoding.`
				);
				break;
			}

			outputFilePath = await processVideo(ffmpegPath, inputMeta, options.video, options.saving, processOptions);
			break;
		}

		default:
			throw new Error(`Unknown or unsupported file.`);
	}

	// No outputFilePath means file was not touched due to thresholds or saving
	// limits, so we emit the original.
	output.file(outputFilePath || input.path);
};
