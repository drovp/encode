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
	const {item, options} = payload;
	const {result, dependencies, progress, log, stage} = utils;
	const ffmpegPath = `${options.ffmpegPath}`.trim() || dependencies.ffmpeg;
	const ffprobePath = `${options.ffprobePath}`.trim() || dependencies.ffprobe;

	/**
	 * Process the file.
	 */
	const itemMeta = await getMeta(item.path, {ffprobe: ffprobePath, ffmpeg: ffmpegPath});
	const processOptions = {
		id: payload.id,
		onStage: stage,
		onLog: log,
		onProgress: progress,
		onWarning: result.warning,
		cwd: Path.dirname(item.path),
	};

	let resultFilePath: string | undefined;

	if (options[itemMeta.type].ignore) {
		result.warning(`Ignoring ${itemMeta.type}: ${Path.basename(item.path)}`);
		return;
	}

	switch (itemMeta.type) {
		case 'image': {
			const skipThreshold = options.image.skipThreshold;
			const KB = itemMeta.size / 1024;
			const MPX = (itemMeta.width * itemMeta.height) / 1e6;
			const KBpMPX = KB / MPX;

			if (skipThreshold && skipThreshold > KBpMPX) {
				console.log(
					`Image's ${Math.round(
						KBpMPX
					)} KB/Mpx data density is smaller than skip threshold, skipping encoding.`
				);
				break;
			}

			resultFilePath = await processImage(ffmpegPath, itemMeta, options.image, options.saving, processOptions);
			break;
		}

		case 'audio': {
			const skipThreshold = options.audio.skipThreshold;
			const KB = itemMeta.size / 1024;
			const minutes = itemMeta.duration / 1000 / 60;
			const KBpCHpM = KB / itemMeta.channels / minutes;

			if (skipThreshold && skipThreshold > KBpCHpM) {
				console.log(
					`Audio's ${Math.round(KBpCHpM)} KB/ch/m bitrate is smaller than skip threshold, skipping encoding.`
				);
				break;
			}

			resultFilePath = await processAudio(ffmpegPath, itemMeta, options.audio, options.saving, processOptions);
			break;
		}

		case 'video': {
			const skipThreshold = options.video.skipThreshold;
			const KB = itemMeta.size / 1024;
			const MPX = (itemMeta.width * itemMeta.height) / 1e6;
			const minutes = itemMeta.duration / 1000 / 60;
			const KBpMPXpM = KB / MPX / minutes;

			if (skipThreshold && skipThreshold > KBpMPXpM) {
				console.log(
					`Video's ${Math.round(
						KBpMPXpM
					)} KB/Mpx/m bitrate is smaller than skip threshold (${skipThreshold}), skipping encoding.`
				);
				break;
			}

			resultFilePath = await processVideo(ffmpegPath, itemMeta, options.video, options.saving, processOptions);
			break;
		}

		default:
			throw new Error(`Unknown or unsupported file.`);
	}

	// No resultFilePath means file was not touched due to thresholds or saving
	// limits, so we emit the original.
	result.file(resultFilePath || item.path);
};
