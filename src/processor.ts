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

				outputFilePath = await processImage(
					ffmpegPath,
					inputMeta,
					options.image,
					options.saving,
					processOptions
				);
				break;
			}

			case 'audio': {
				const skipThreshold = options.audio.skipThreshold;
				const KB = inputMeta.size / 1024;
				const minutes = inputMeta.duration / 1000 / 60;
				const KBpCHpM = KB / inputMeta.channels / minutes;

				if (skipThreshold && skipThreshold > KBpCHpM) {
					console.log(
						`Audio's ${Math.round(
							KBpCHpM
						)} KB/ch/m bitrate is smaller than skip threshold, skipping encoding.`
					);
					break;
				}

				outputFilePath = await processAudio(
					ffmpegPath,
					inputMeta,
					options.audio,
					options.saving,
					processOptions
				);
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

				outputFilePath = await processVideo(
					ffmpegPath,
					inputMeta,
					options.video,
					options.saving,
					processOptions
				);
				break;
			}

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
