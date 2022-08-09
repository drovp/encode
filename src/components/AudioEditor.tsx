import {h} from 'preact';
import {useState, useEffect, useMemo} from 'preact/hooks';
import {AudioMeta} from 'ffprobe-normalized';
import type {Payload} from '../';
import {Vacant} from 'components/Vacant';
import {MediaControls} from 'components/MediaControls';
import {Timeline} from 'components/Timeline';
import {useCombinedMediaPlayer} from 'components/MediaPlayer';
import {Controls, CutsControl, SpeedFPSControl, SavingControl} from 'components/Controls';
import {isInteractiveElement, seekTimeFromModifiers, idKey, clamp, countCutsDuration, moveItem} from 'lib/utils';
import * as shortcuts from 'config/shortcuts';

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
				/>,
			</Controls>

			<Timeline
				media={media}
				fallbackWarning={(player) =>
					`This media (${player.meta.codec} inside ${player.meta.container}) can't be played natively.`
				}
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
