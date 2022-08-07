import {h} from 'preact';
import {useState, useEffect, useMemo} from 'preact/hooks';
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
import {
	isInteractiveElement,
	seekTimeFromModifiers,
	idKey,
	clamp,
	sanitizeCrop,
	countCutsDuration,
	moveItem,
} from 'lib/utils';
import * as shortcuts from 'config/shortcuts';

export interface VideoEditorOptions {
	ffmpegPath: string;
	metas: VideoMeta[];
	payload: Payload;
	onSubmit: (payload: Payload) => void;
	onCancel: () => void;
}

export function VideoEditor({ffmpegPath, metas, payload: initPayload, onSubmit, onCancel}: VideoEditorOptions) {
	const firstMeta = metas?.[0];
	if (!metas || !firstMeta) return <Vacant>No video passed.</Vacant>;

	const [crop, setCrop] = useState<Region | undefined>(undefined);
	const [cropLimit, setCropLimit] = useState(0.03);
	const [payload, setPayload] = useState(initPayload);
	const videoOptions = payload.options.video;
	initPayload = useMemo(() => JSON.parse(JSON.stringify(initPayload)), []);
	const initVideoOptions = initPayload.options.video;
	const [rotate, setRotation] = useState<Rotation | undefined>(undefined);
	const [flipHorizontal, setFlipHorizontal] = useState<true | undefined>(undefined);
	const [flipVertical, setFlipVertical] = useState<true | undefined>(undefined);
	const [enableCursorCropping, setEnableCursorCropping] = useState(false);
	const media = useCombinedMediaPlayer(metas, ffmpegPath);

	useEffect(() => {
		function handleKeyDown(event: KeyboardEvent) {
			if (isInteractiveElement(event.target)) return;

			switch (idKey(event)) {
				case shortcuts.playToggle:
					if (!event.repeat) media.togglePlay();
					break;
				case shortcuts.seekToStart:
					media.seekTo(0);
					break;
				case shortcuts.seekToEnd:
					media.seekTo(media.duration);
					break;
				case shortcuts.seekToPrevCutPoint:
					media.seekToPrevCutPoint();
					break;
				case shortcuts.seekToNextCutPoint:
					media.seekToNextCutPoint();
					break;
				case shortcuts.volumeUp:
					media.setVolume(clamp(0, media.volume + 0.1, 1));
					break;
				case shortcuts.volumeDown:
					media.setVolume(clamp(0, media.volume - 0.1, 1));
					break;
				case shortcuts.cutDelete:
					media.deleteCurrentCut();
					break;
				case shortcuts.cutDeleteAll:
					media.setCuts(undefined);
					break;
				case shortcuts.cutStart:
					media.startCut();
					break;
				case shortcuts.cutEnd:
					media.endCut();
					break;
				case shortcuts.seekForward:
				case `${shortcuts.seekFrameModifier}+${shortcuts.seekForward}`:
				case `${shortcuts.seekMoreModifier}+${shortcuts.seekForward}`:
				case `${shortcuts.seekMediumModifier}+${shortcuts.seekForward}`:
				case `${shortcuts.seekBigModifier}+${shortcuts.seekForward}`:
					media.seekBy(seekTimeFromModifiers(event, media.frameTime));
					break;
				case shortcuts.seekBackward:
				case `${shortcuts.seekFrameModifier}+${shortcuts.seekBackward}`:
				case `${shortcuts.seekMoreModifier}+${shortcuts.seekBackward}`:
				case `${shortcuts.seekMediumModifier}+${shortcuts.seekBackward}`:
				case `${shortcuts.seekBigModifier}+${shortcuts.seekBackward}`:
					media.seekBy(-seekTimeFromModifiers(event, media.frameTime));
					break;
			}
		}

		addEventListener('keydown', handleKeyDown);

		return () => {
			removeEventListener('keydown', handleKeyDown);
		};
	}, []);

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
		const newCrop = await media.cropDetect({limit: cropLimit});
		setCrop(newCrop ? sanitizeCrop(newCrop, {roundBy: 2}) : undefined);
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
				>
					<media.Component />
				</Preview>
			</div>

			<Controls onSubmit={handleSubmit} onCancel={onCancel}>
				<CropControl
					width={media.width}
					height={media.height}
					crop={crop}
					cropLimit={cropLimit}
					warnRounding={true}
					onCropWithCursor={() => setEnableCursorCropping((value) => !value)}
					onCropLimitChange={setCropLimit}
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
				fallbackWarning={(player) =>
					`This media (${player.meta.codec} inside ${player.meta.container}) can't be played natively, so we're using a fallback player which is slower, lower quality, and audio can get out of sync during playback.\nThis only affects the preview, the final encode will be as expected.`
				}
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
