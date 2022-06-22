import {cpus} from 'os';
import {h} from 'preact';
import {useState, useEffect, useMemo} from 'preact/hooks';
import pMap from 'p-map';
import type {PreparatorPayload, Payload} from '../';
import {eem, isMetasType, getMetaTypes} from 'lib/utils';
import {ffprobe, Meta} from 'ffprobe-normalized';
import {Vacant} from 'components/Vacant';
import {Spinner} from 'components/Spinner';
import {ImageEditor} from 'components/ImageEditor';
import {VideoEditor} from 'components/VideoEditor';
import {AudioEditor} from 'components/AudioEditor';
import {Scrollable} from 'components/Scrollable';

const CONCURRENCY = Math.max(1, Math.floor(cpus().length * 0.8));

export function App({
	preparatorPayload,
	onSubmit,
	onCancel,
}: {
	preparatorPayload: PreparatorPayload;
	onSubmit: (payload: Payload) => void;
	onCancel: () => void;
}) {
	const {payload, ffmpegPath, ffprobePath} = preparatorPayload;
	const [isLoading, setIsLoading] = useState(true);
	const [metas, setMetas] = useState<Meta[] | null>(null);
	const metaTypes = useMemo(() => (metas ? getMetaTypes(metas) : null), [metas]);
	const [metaError, setMetaError] = useState<string | null>(null);

	useEffect(() => {
		setIsLoading(true);
		pMap(payload.inputs, (input) => ffprobe(input.path, {path: ffprobePath}), {concurrency: CONCURRENCY})
			.then(setMetas)
			.catch((error) => setMetaError(eem(error)))
			.finally(() => setIsLoading(false));

		// Prevent space from pressing focused buttons by blurring them if they
		// were activated by a click event.
		function handleMouseUp(event: MouseEvent) {
			(event.target as HTMLElement)?.closest?.('button')?.blur();
		}

		addEventListener('mouseup', handleMouseUp);

		return () => {
			removeEventListener('mouseup', handleMouseUp);
		};
	}, []);

	let inputsType: string | null = null;
	let inputsError: string | null = null;
	const firstMeta = metas ? metas[0] : null;

	if (metas && metas.length > 0) {
		for (let i = 0; i < metas.length; i++) {
			const meta = metas[i]!;
			if (i === 0) {
				inputsType = meta.type;
			} else {
				if (meta.type !== inputsType) {
					inputsError = ``;
					break;
				}
			}
		}
	}

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
			{firstMeta.type === 'image' ? (
				<ImageEditor
					ffmpegPath={ffmpegPath}
					meta={firstMeta}
					payload={payload}
					onSubmit={onSubmit}
					onCancel={onCancel}
				/>
			) : isMetasType('video', metas) ? (
				<VideoEditor
					ffmpegPath={ffmpegPath}
					metas={metas}
					payload={payload}
					onSubmit={onSubmit}
					onCancel={onCancel}
				/>
			) : isMetasType('audio', metas) ? (
				<AudioEditor
					ffmpegPath={ffmpegPath}
					metas={metas}
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
