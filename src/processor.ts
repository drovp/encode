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
	const itemMeta = await getMeta(ffprobePath, item.path);
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
		case 'image':
			resultFilePath = await processImage(ffmpegPath, itemMeta, options.image, options.saving, processOptions);
			break;

		case 'audio':
			resultFilePath = await processAudio(ffmpegPath, itemMeta, options.audio, options.saving, processOptions);
			break;

		case 'video':
			resultFilePath = await processVideo(ffmpegPath, itemMeta, options.video, options.saving, processOptions);
			break;

		default:
			throw new Error(`Unknown or unsupported file.`);
	}

	if (resultFilePath) result.file(resultFilePath);
};
