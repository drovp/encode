import {h} from 'preact';
import {useState, useMemo} from 'preact/hooks';
import {AudioMeta} from 'ffprobe-normalized';
import type {Payload} from '../';
import {Vacant} from 'components/Vacant';
import {MediaControls} from 'components/MediaControls';
import {Timeline} from 'components/Timeline';
import {Slider} from 'components/Slider';
import {useCombinedMediaPlayer} from 'components/MediaPlayer';
import {
	Controls,
	CutsControls,
	SpeedFPSControls,
	SavingControls,
	MiscControls,
	MiscControlItem,
} from 'components/Controls';
import {countCutsDuration, moveItem, cropCuts} from 'lib/utils';
import {AudioOptions} from 'lib/audio';

export interface AudioEditorOptions {
	ffmpegPath: string;
	metas: AudioMeta[];
	payload: Payload;
	editorData: EditorData;
	onSubmit: (payload: Payload, meta: {duration: number}) => void;
	onCancel: () => void;
}

export function AudioEditor({
	ffmpegPath,
	metas,
	payload: initPayload,
	editorData,
	onSubmit,
	onCancel,
}: AudioEditorOptions) {
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
		onSubmit({...payload, edits: {cuts: media.cuts}}, {duration: media.duration});
	}

	function useLastCuts() {
		if (editorData.lastCuts) {
			media.setCuts(cropCuts(editorData.lastCuts.cuts, 0, media.duration));
		}
	}

	return (
		<div class="AudioEditor">
			<div class="preview">
				<media.Component />
			</div>

			<Controls onSubmit={handleSubmit} onCancel={onCancel}>
				<SpeedFPSControls
					value={audioOptions.speed}
					onSpeedChange={(speed) => {
						setAudioOption('speed', speed);
						media.setSpeed(speed);
					}}
				/>
				<CutsControls
					cuts={media.cuts}
					duration={media.duration}
					speed={audioOptions.speed}
					onChange={media.setCuts}
					onUseLastCuts={editorData.lastCuts ? useLastCuts : undefined}
				/>
				<AudioEncoderControls
					audioOptions={payload.options.audio}
					onChange={(audio) => setPayload({...payload, options: {...payload.options, audio}})}
				/>
				<SavingControls
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

// Quick options to control the quality of the encoder selected in profile's options
function AudioEncoderControls({
	audioOptions,
	onChange,
}: {
	audioOptions: AudioOptions;
	onChange: (audioOptions: AudioOptions) => void;
}) {
	let title = audioOptions.codec.toUpperCase();
	let controls: h.JSX.Element[] = [];
	const {codec} = audioOptions;

	if (codec === 'wav') return null;

	switch (codec) {
		case 'mp3': {
			const codecOptions = audioOptions[codec];
			const {mode} = codecOptions;
			title += ` (${mode.toUpperCase()})`;

			switch (mode) {
				case 'vbr':
					controls.push(
						<MiscControlItem>
							<label>
								<span
									class="title"
									title={`Variable bitrate level\n0 = best, biggest file; 9 = worst, smallest file`}
								>
									VBR
								</span>
								<Slider
									class="input"
									min={0}
									max={9}
									step={1}
									value={codecOptions.vbr}
									onChange={(value) => {
										onChange({...audioOptions, [codec]: {...codecOptions, vbr: value}});
									}}
								/>
								<span class="value" style="width:3ch">
									{codecOptions.vbr}
								</span>
							</label>
						</MiscControlItem>
					);
					break;

				case 'cbr':
					controls.push(
						<MiscControlItem>
							<label title="Constant bitrate PER CHANNEL per second">
								<span class="title">CBR ⚠</span>
								<Slider
									class="input"
									min={16}
									max={160}
									step={16}
									value={codecOptions.cbrpch}
									onChange={(value) => {
										onChange({...audioOptions, [codec]: {...codecOptions, cbrpch: value}});
									}}
								/>
								<span class="value" style="width:3ch">
									{codecOptions.cbrpch}
								</span>
								<span class="hint">Kb/ch/s</span>
							</label>
						</MiscControlItem>
					);
					break;
			}

			break;
		}

		case 'opus': {
			const codecOptions = audioOptions[codec];
			const {mode} = codecOptions;
			title = `OGG/Opus (${mode.toUpperCase()})`;

			controls.push(
				<MiscControlItem>
					<label title="Constant bitrate PER CHANNEL per second">
						<span class="title">Bitrate ⚠</span>
						<Slider
							class="input"
							min={16}
							max={160}
							step={16}
							value={codecOptions.bpch}
							onChange={(value) => {
								onChange({...audioOptions, [codec]: {...codecOptions, bpch: value}});
							}}
						/>
						<span class="value" style="width:3ch">
							{codecOptions.bpch}
						</span>
						<span class="hint">Kb/ch/s</span>
					</label>
				</MiscControlItem>
			);

			break;
		}

		default:
			return null;
	}

	return <MiscControls title={title}>{controls}</MiscControls>;
}
