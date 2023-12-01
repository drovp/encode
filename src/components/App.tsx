import {spawn} from 'child_process';
import * as Path from 'path';
import {h} from 'preact';
import {useState, useEffect, useMemo} from 'preact/hooks';
import type {PreparatorPayload, Payload} from '../';
import {
	eem,
	isOfType,
	isInputAbleElement,
	isMetasType,
	getMetaTypes,
	getStdout,
	splitSharpLoad,
	sharpToImageMeta,
} from 'lib/utils';
import {getOneRawFrame} from 'lib/ffmpeg';
import {ffprobe, ImageMeta, VideoMeta, AudioMeta} from 'ffprobe-normalized';
import {Vacant} from 'components/Vacant';
import {Spinner} from 'components/Spinner';
import {ImageEditor} from 'components/ImageEditor';
import {VideoEditor} from 'components/VideoEditor';
import {AudioEditor} from 'components/AudioEditor';
import {Scrollable} from 'components/Scrollable';

export interface ImageLoad {
	type: 'image-load';
	meta: ImageMeta;
	data: ImageData;
}

type MediaLoad = ImageLoad | VideoMeta | AudioMeta;

interface SubmitMeta {
	duration?: number
}

export function App({
	preparatorPayload,
	editorData,
	onSubmit,
	onCancel,
}: {
	preparatorPayload: PreparatorPayload;
	editorData: EditorData;
	onSubmit: (payload: Payload, meta?: SubmitMeta) => void;
	onCancel: () => void;
}) {
	const {payload, nodePath, ffmpegPath, ffprobePath} = preparatorPayload;
	const [isLoading, setIsLoading] = useState(true);
	const [metas, setMetas] = useState<MediaLoad[] | null>(null);
	const firstMeta = metas ? metas[0] : null;
	const metaTypes = useMemo(() => (metas ? getMetaTypes(metas) : null), [metas]);
	const [metaError, setMetaError] = useState<string | null>(null);

	useEffect(() => {
		setIsLoading(true);
		Promise.all(payload.inputs.map((input) => loadMedia(input.path, {nodePath, ffprobePath, ffmpegPath})))
			.then(setMetas)
			.catch((error) => setMetaError(eem(error)))
			.finally(() => setIsLoading(false));

		// Blur interactive non-input-able elements after click so that they don't prevent shortcuts.
		// We can't use an actual "click" event as it might be simulated when pressing space on a checkbox,
		// in which case this shouldn't trigger.
		function blurActiveElement(event: MouseEvent) {
			setTimeout(() => {
				const active = document.activeElement;
				if (
					!isInputAbleElement(active) &&
					active?.nodeName !== 'SELECT' &&
					isOfType<HTMLElement>(active, typeof (active as any)?.blur === 'function')
				) {
					active.blur();
				}
			}, 10);
		}

		addEventListener('mouseup', blurActiveElement);

		return () => {
			removeEventListener('mouseup', blurActiveElement);
		};
	}, []);

	if (isLoading) return <Spinner />;

	if (metaError) {
		return (
			<Scrollable>
				<Vacant variant="danger" title="Meta error" details={metaError}>
					Error retrieving meta data.
				</Vacant>
			</Scrollable>
		);
	}

	if (metaTypes && metaTypes.length > 1) {
		return (
			<Scrollable>
				<Vacant variant="danger" title="Inputs error">
					All inputs must be of same type (image, video, or audio), but mixed inputs were passed (
					{metaTypes.join('+')}).
				</Vacant>
			</Scrollable>
		);
	}

	if (firstMeta == null) {
		return (
			<Scrollable>
				<Vacant variant="danger" title="Inputs error">
					No inputs were passed.
				</Vacant>
			</Scrollable>
		);
	}

	return (
		<div class="App">
			{firstMeta.type === 'image-load' ? (
				<ImageEditor
					nodePath={nodePath}
					ffmpegPath={ffmpegPath}
					meta={firstMeta.meta}
					imageData={firstMeta.data}
					editorData={editorData}
					payload={payload}
					onSubmit={onSubmit}
					onCancel={onCancel}
				/>
			) : isMetasType('video', metas) ? (
				<VideoEditor
					ffmpegPath={ffmpegPath}
					metas={metas}
					payload={payload}
					editorData={editorData}
					onSubmit={onSubmit}
					onCancel={onCancel}
				/>
			) : isMetasType('audio', metas) ? (
				<AudioEditor
					ffmpegPath={ffmpegPath}
					metas={metas}
					editorData={editorData}
					payload={payload}
					onSubmit={onSubmit}
					onCancel={onCancel}
				/>
			) : (
				<Scrollable>
					<Vacant variant="danger" title="Inputs error">
						Unknown input type {firstMeta.type}.
					</Vacant>
				</Scrollable>
			)}
		</div>
	);
}

/**
 * Retrieves media file meta.
 *
 * First tries sharp, if that fails, uses ffprobe. If ffprobe returns an image,
 * the resulting meta is marked with `noSharpSupport`, which tells processor to
 * use ffmpeg to retrieve the ImageData, and pass that to sharp.
 */
export async function loadMedia(
	path: string,
	{nodePath, ffprobePath, ffmpegPath}: {nodePath: string; ffprobePath: string; ffmpegPath: string}
): Promise<MediaLoad> {
	const extension = Path.extname(path).slice(1).toLowerCase();

	// Use sharp for images it supports
	if (['jpg', 'jpeg', 'svg', 'png', 'webp', 'gif', 'avif', 'tiff'].includes(extension)) {
		try {
			const loaderPath = Path.join(__dirname, 'sharpLoader.js');
			const process = spawn(nodePath, [loaderPath, '--meta', path]);
			const buffer = await getStdout(process);
			const {meta: sharpMeta, data} = splitSharpLoad(buffer);
			const meta = await sharpToImageMeta(sharpMeta, path);
			return {type: 'image-load', meta, data};
		} catch (error) {
			console.error(`Couldn't load metadata with sharp. Error: ${eem(error)}`);
		}
	}

	// Fallback to ffprobe
	const meta = await ffprobe(path, {path: ffprobePath});

	if (meta.type === 'image') {
		return {
			type: 'image-load',
			meta,
			data: await getOneRawFrame({meta, ffmpegPath}),
		};
	}

	return meta;
}
