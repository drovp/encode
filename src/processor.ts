import * as Path from 'path';
import type {ProcessorUtils} from '@drovp/types';
import type {Payload, Dependencies} from './';
import {checkSaveAsPathOptions, TemplateError} from '@drovp/save-as-path';
import {MessageError, eem, isMetasType, Meta, getMetaTypes, sharpToImageMeta} from './lib/utils';
import {nativeImport} from 'lib/nativeImport';
import {ffprobe} from 'ffprobe-normalized';
import {processImage} from './lib/image';
import {processAudio} from './lib/audio';
import {processVideo} from './lib/video';

export default async (payload: Payload, utils: ProcessorUtils<Dependencies>) => {
	const {input, inputs, options, edits} = payload;
	const {dependencies, log, output} = utils;
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

	try {
		// Process the file.
		const processOptions = {
			id: payload.id,
			utils,
			cwd: Path.dirname(input.path),
			verbose: options.verbose,
		};
		const metas = await Promise.all(inputs.map((input) => getMediaMeta(input.path, {ffprobePath})));
		const inputTypes = getMetaTypes(metas);

		if (inputTypes.length === 0) {
			throw new Error(`No inputs passed.`);
		} else if (inputTypes.length > 1) {
			throw new Error(
				`Mixed input types are not allowed. All inputs have to be of the same type, but ${inputTypes.join(
					' and '
				)} was received.`
			);
		}

		const canProcessType = (type: 'image' | 'video' | 'audio') => {
			if (!(options.process || []).includes(type)) {
				log(`Ignoring: "${input.path}"\nReason: ${type} files are configured to not be processed.`);
				return false;
			}
			return true;
		};

		if (isMetasType('image', metas)) {
			if (canProcessType('image')) {
				if (metas.length > 1) {
					output.error(`Can't concatenate images. Concatenation is only possible for audio and video files.`);
					return;
				}
				const meta = metas[0]!;
				await processImage(ffmpegPath, meta, {...options.image, ...edits}, options.saving, processOptions);
			}
		} else if (isMetasType('audio', metas)) {
			if (canProcessType('audio')) {
				await processAudio(ffmpegPath, metas, {...options.audio, ...edits}, options.saving, processOptions);
			}
		} else if (isMetasType('video', metas)) {
			if (canProcessType('video')) {
				await processVideo(ffmpegPath, metas, {...options.video, ...edits}, options.saving, processOptions);
			}
		} else {
			output.error(`Unknown or unsupported input types: ${inputTypes.join(', ')}`);
		}
	} catch (error) {
		output.error(eem(error, !(error instanceof MessageError)));
		return;
	}
};

/**
 * Retrieves media file meta.
 *
 * First tries sharp, if that fails, uses ffprobe. If ffprobe returns an image,
 * the resulting meta is marked with `noSharpSupport`, which tells processor to
 * use ffmpeg to retrieve the ImageData, and pass that to sharp.
 */
export async function getMediaMeta(path: string, {ffprobePath}: {ffprobePath: string}): Promise<Meta> {
	const sharp = await nativeImport('sharp');
	let meta: Meta | undefined;

	// Disable all caching, otherwise sharp keeps files open and they can't be deleted
	sharp.cache(false);

	// Try sharp for fast detection of input images it supports
	try {
		const sharpMeta = await sharp(path).metadata();
		return await sharpToImageMeta(sharpMeta, path);
	} catch {}

	// Fallback to ffprobe
	if (!meta) {
		const ffprobeMeta = await ffprobe(path, {path: ffprobePath});
		meta = ffprobeMeta.type === 'image' ? {...ffprobeMeta, sharpCantRead: true} : ffprobeMeta;
	}

	return meta;
}
