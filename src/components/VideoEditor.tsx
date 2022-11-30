import {h} from 'preact';
import {useState, useMemo} from 'preact/hooks';
import {VideoMeta} from 'ffprobe-normalized';
import type {Payload} from '../';
import {Vacant} from 'components/Vacant';
import {Preview} from 'components/Preview';
import {MediaControls} from 'components/MediaControls';
import {Timeline} from 'components/Timeline';
import {Checkbox} from 'components/Checkbox';
import {useCombinedMediaPlayer} from 'components/MediaPlayer';
import {
	Controls,
	CropControl,
	RotateFlipControl,
	ResizeControl,
	CutsControl,
	MiscControl,
	MiscControlItem,
	SpeedFPSControl,
	SavingControl,
} from 'components/Controls';
import {sanitizeCrop, countCutsDuration, moveItem, resizeRegion} from 'lib/utils';

export interface VideoEditorOptions {
	ffmpegPath: string;
	metas: VideoMeta[];
	payload: Payload;
	editorData: EditorData;
	onSubmit: (payload: Payload) => void;
	onCancel: () => void;
}

export function VideoEditor({
	ffmpegPath,
	metas,
	editorData,
	payload: initPayload,
	onSubmit,
	onCancel,
}: VideoEditorOptions) {
	const firstMeta = metas?.[0];
	if (!metas || !firstMeta) return <Vacant>No video passed.</Vacant>;

	const [crop, setCrop] = useState<Region | undefined>(undefined);
	const [cropThreshold, setCropThreshold] = useState(0.03);
	const [payload, setPayload] = useState(initPayload);
	const videoOptions = payload.options.video;
	initPayload = useMemo(() => JSON.parse(JSON.stringify(initPayload)), []);
	const initVideoOptions = initPayload.options.video;
	const [rotate, setRotation] = useState<Rotation | undefined>(undefined);
	const [flipHorizontal, setFlipHorizontal] = useState<true | undefined>(undefined);
	const [flipVertical, setFlipVertical] = useState<true | undefined>(undefined);
	const [enableCursorCropping, setEnableCursorCropping] = useState(false);
	const media = useCombinedMediaPlayer(metas, ffmpegPath);

	function setVideoOption<N extends keyof Payload['options']['video']>(
		name: N,
		value: Payload['options']['video'][N]
	) {
		setPayload({
			...payload,
			options: {...payload.options, video: {...payload.options.video, [name]: value}},
		});
	}

	function handleSubmit() {
		onSubmit({...payload, edits: {crop, rotate, flipHorizontal, flipVertical, cuts: media.cuts}});
	}

	async function handleCropDetect() {
		const newCrop = await media.cropDetect({threshold: cropThreshold});
		setCrop(newCrop ? sanitizeCrop(newCrop, {roundBy: 2}) : undefined);
	}

	function usePreviousCrop() {
		if (!editorData.previousCrop) return;
		setCrop(sanitizeCrop(resizeRegion(editorData.previousCrop, media.width, media.height), {roundBy: 2}));
	}

	return (
		<div class="VideoEditor">
			<div class="preview">
				<Preview
					width={media.width}
					height={media.height}
					rotate={rotate || 0}
					flipHorizontal={flipHorizontal || false}
					flipVertical={flipVertical || false}
					crop={crop}
					cropRounding={2}
					enableCursorCropping={enableCursorCropping}
					background="black"
					onCropChange={(crop) => {
						setEnableCursorCropping(false);
						setCrop(crop);
					}}
					onCancelCropping={() => setEnableCursorCropping(false)}
					onCropDetect={handleCropDetect}
					onCropCancel={() => setCrop(undefined)}
					onUsePreviousCrop={editorData.previousCrop ? usePreviousCrop : undefined}
				>
					<media.Component />
				</Preview>
			</div>

			<Controls onSubmit={handleSubmit} onCancel={onCancel}>
				<CropControl
					width={media.width}
					height={media.height}
					crop={crop}
					threshold={cropThreshold}
					onUsePreviousCrop={editorData.previousCrop ? usePreviousCrop : undefined}
					warnRounding={true}
					onCropWithCursor={() => setEnableCursorCropping((value) => !value)}
					onThresholdChange={setCropThreshold}
					onChange={setCrop}
					onCropDetect={handleCropDetect}
				/>
				<RotateFlipControl
					rotation={rotate || 0}
					onRotationChange={(rotation) => setRotation(rotation === 0 ? undefined : rotation)}
					flipVertical={flipVertical || false}
					onVerticalChange={(value) => setFlipVertical(value || undefined)}
					flipHorizontal={flipHorizontal || false}
					onHorizontalChange={(value) => setFlipHorizontal(value || undefined)}
				/>
				<ResizeControl config={videoOptions.resize} onChange={(resize) => setVideoOption('resize', resize)} />
				<SpeedFPSControl
					value={videoOptions.speed}
					onSpeedChange={(speed) => {
						setVideoOption('speed', speed);
						media.setSpeed(speed);
					}}
					changeInfo={`Also changes framerate accordingly.`}
					maxFps={videoOptions.maxFps}
					onMaxFpsChange={(fps) => setVideoOption('maxFps', fps)}
				/>
				<CutsControl
					cuts={media.cuts}
					duration={media.duration}
					speed={videoOptions.speed}
					onChange={media.setCuts}
				/>
				<MiscControl>
					<MiscControlItem>
						<label>
							<Checkbox
								checked={videoOptions.maxAudioChannels === 0}
								onChange={(value) =>
									setVideoOption('maxAudioChannels', value ? 0 : initVideoOptions.maxAudioChannels)
								}
							/>
							Strip audio
						</label>
					</MiscControlItem>
				</MiscControl>
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
				speed={videoOptions.speed}
			/>
		</div>
	);
}
