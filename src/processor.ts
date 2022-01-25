import * as Path from 'path';
import type {ProcessorUtils} from '@drovp/types';
import type {Payload} from './';
import {ffprobe} from 'ffprobe-normalized';
import {checkSaveAsPathOptions, TemplateError} from '@drovp/save-as-path';
import {MessageError, eem} from './lib/utils';
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

	// Check saving options are OK
	try {
		checkSaveAsPathOptions(options.saving);
	} catch (error) {
		if (error instanceof TemplateError) {
			utils.output.error(`Destination template error: ${error.message}`);
			return;
		}
	}

	// Process the file.
	const inputMeta = await ffprobe(input.path, {path: ffprobePath});
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
		output.warning(`Ignoring: "${input.path}"\nReason: ${inputMeta.type} files are configured to be ignored.`);
		return;
	}

	try {
		switch (inputMeta.type) {
			case 'image':
				outputFilePath = await processImage(
					ffmpegPath,
					inputMeta,
					options.image,
					options.saving,
					processOptions
				);
				break;

			case 'audio':
				outputFilePath = await processAudio(
					ffmpegPath,
					inputMeta,
					options.audio,
					options.saving,
					processOptions
				);
				break;

			case 'video':
				outputFilePath = await processVideo(
					ffmpegPath,
					inputMeta,
					options.video,
					options.saving,
					processOptions
				);
				break;

			default:
				output.error(`Unknown or unsupported file.`);
				return;
		}
	} catch (error) {
		output.error(eem(error, !(error instanceof MessageError)));
		return;
	}

	// No outputFilePath means file was not touched due to thresholds or saving
	// limits, so we emit the original.
	output.file(outputFilePath || input.path);
};
