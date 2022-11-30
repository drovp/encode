import {h} from 'preact';
import {useState, useMemo} from 'preact/hooks';
import {AudioMeta} from 'ffprobe-normalized';
import type {Payload} from '../';
import {Vacant} from 'components/Vacant';
import {MediaControls} from 'components/MediaControls';
import {Timeline} from 'components/Timeline';
import {useCombinedMediaPlayer} from 'components/MediaPlayer';
import {Controls, CutsControl, SpeedFPSControl, SavingControl} from 'components/Controls';
import {countCutsDuration, moveItem} from 'lib/utils';

export interface AudioEditorOptions {
	ffmpegPath: string;
	metas: AudioMeta[];
	payload: Payload;
	onSubmit: (payload: Payload) => void;
	onCancel: () => void;
}

export function AudioEditor({ffmpegPath, metas, payload: initPayload, onSubmit, onCancel}: AudioEditorOptions) {
	const firstMeta = metas?.[0];
	if (!metas || !firstMeta) return <Vacant>No audio passed.</Vacant>;

	const [payload, setPayload] = useState(initPayload);
	const audioOptions = payload.options.audio;
	initPayload = useMemo(() => JSON.parse(JSON.stringify(initPayload)), []);
	const media = useCombinedMediaPlayer(metas, ffmpegPath);

	function setAudioOption<N extends keyof Payload['options']['audio']>(
		name: N,
		value: Payload['options']['audio'][N]
	) {
		setPayload({
			...payload,
			options: {...payload.options, audio: {...payload.options.audio, [name]: value}},
		});
	}

	function handleSubmit() {
		onSubmit({...payload, edits: {cuts: media.cuts}});
	}

	return (
		<div class="AudioEditor">
			<div class="preview">
				<media.Component />
			</div>

			<Controls onSubmit={handleSubmit} onCancel={onCancel}>
				<SpeedFPSControl
					value={audioOptions.speed}
					onSpeedChange={(speed) => {
						setAudioOption('speed', speed);
						media.setSpeed(speed);
					}}
				/>
				<CutsControl
					cuts={media.cuts}
					duration={media.duration}
					speed={audioOptions.speed}
					onChange={media.setCuts}
				/>
				<SavingControl
					saving={payload.options.saving}
					defaultPath={firstMeta.path}
					onChange={(saving) => setPayload({...payload, options: {...payload.options, saving}})}
				/>
			</Controls>

			<Timeline
				media={media}
				onMove={(from, to) => {
					media.movePlayer(from, to);
					setPayload({...payload, inputs: [...moveItem(payload.inputs, from, to)]});
				}}
			/>

			<MediaControls
				media={media}
				cutsDuration={media.cuts ? countCutsDuration(media.cuts) : undefined}
				speed={audioOptions.speed}
			/>
		</div>
	);
}
