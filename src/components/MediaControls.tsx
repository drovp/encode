import {h} from 'preact';
import {useMemo} from 'preact/hooks';
import {msToIsoTime, msToHumanTime, seekTimeFromModifiers, clamp} from 'lib/utils';
import {useShortcuts} from 'lib/hooks';
import * as shortcuts from 'config/shortcuts';
import {CombinedMediaPlayer} from 'components/MediaPlayer';
import {Icon} from 'components/Icon';
import {Button} from 'components/Button';
import {Slider} from 'components/Slider';

const seekModifiersDescription = `Default is 1 second. Modifiers:\n${shortcuts.seekFrameModifier}: 1 frame\n${shortcuts.seekMoreModifier}: 5 seconds\n${shortcuts.seekMediumModifier}: 10 seconds\n${shortcuts.seekBigModifier}: 30 seconds`;

export function MediaControls({
	media,
	cutsDuration,
	speed,
}: {
	media: CombinedMediaPlayer;
	cutsDuration?: number;
	speed: number;
}) {
	const currentTimeHuman = msToIsoTime(media.currentTime).slice(-media.durationHuman.length);
	const finalDuration = useMemo(
		() =>
			cutsDuration
				? msToHumanTime(cutsDuration / (speed || 1))
				: speed !== 1
				? msToHumanTime(media.duration / speed)
				: undefined,
		[cutsDuration, speed]
	);

	useShortcuts((id, event) => {
		switch (id) {
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
			case shortcuts.seekTo10p:
				media.seekTo((media.duration / 10) * 1);
				break;
			case shortcuts.seekTo20p:
				media.seekTo((media.duration / 10) * 2);
				break;
			case shortcuts.seekTo30p:
				media.seekTo((media.duration / 10) * 3);
				break;
			case shortcuts.seekTo40p:
				media.seekTo((media.duration / 10) * 4);
				break;
			case shortcuts.seekTo50p:
				media.seekTo((media.duration / 10) * 5);
				break;
			case shortcuts.seekTo60p:
				media.seekTo((media.duration / 10) * 6);
				break;
			case shortcuts.seekTo70p:
				media.seekTo((media.duration / 10) * 7);
				break;
			case shortcuts.seekTo80p:
				media.seekTo((media.duration / 10) * 8);
				break;
			case shortcuts.seekTo90p:
				media.seekTo((media.duration / 10) * 9);
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
			case shortcuts.cutStartTiny:
				media.addCut([media.currentTime, media.currentTime + media.frameTime]);
				break;
			case shortcuts.cutEndTiny:
				media.addCut([media.currentTime - media.frameTime, media.currentTime]);
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
			default:
				return false;
		}

		return true;
	});

	return (
		<div class="MediaControls">
			<div class="time" title={`Current: ${currentTimeHuman}\nDuration: ${media.durationHuman}`}>
				<span class="current">{currentTimeHuman}</span>
				<b>/</b>
				<span class="duration">
					<span class="total">{media.durationHuman}</span>
					{finalDuration && (
						<span class="final" title="Final duration accounted for speed and cuts">
							{finalDuration}
						</span>
					)}
				</span>
			</div>

			<div class="space" />

			<Button
				class="deleteCut"
				semitransparent
				variant="danger"
				onMouseDown={() => media.deleteCurrentCut()}
				tooltip={media.currentCutIndex < 0 ? `Seek to cut to delete it` : `Delete current cut (Delete)`}
				disabled={media.currentCutIndex < 0}
			>
				<Icon name="trash" />
			</Button>

			<Button
				class="seekPrev"
				semitransparent
				onMouseDown={() => media.seekToPrevCutPoint()}
				tooltip="Seek to previous cut point (PageUp)"
			>
				<Icon name="caret-left-stop" />
			</Button>
			<Button
				class="startCut"
				semitransparent
				onMouseDown={() => media.startCut()}
				tooltip={`Start a new cut or edit the nearest one (${shortcuts.cutStart})\nStart a tiny cut (${shortcuts.cutStartTiny})`}
			>
				<Icon name="arrow-left-up" />
			</Button>
			<Button
				class="seek1fb"
				semitransparent
				onMouseDown={(event) => media.seekBy(-seekTimeFromModifiers(event, media.frameTime))}
				tooltip={`Seek backward (ArrowLeft)\n${seekModifiersDescription}`}
			>
				<Icon name="caret-left" />
			</Button>

			<button
				class={`play${media.isPlaying ? ' -active' : ''}`}
				onMouseDown={() => media.togglePlay()}
				title="Play/Pause (Space)"
			>
				<Icon name={media.isPlaying ? 'pause' : 'play'} />
			</button>

			<Button
				class="seek1ff"
				semitransparent
				onMouseDown={(event) => media.seekBy(seekTimeFromModifiers(event, media.frameTime))}
				tooltip={`Seek forward (ArrowRight)\n${seekModifiersDescription}`}
			>
				<Icon name="caret-right" />
			</Button>
			<Button
				class="endCut"
				semitransparent
				onMouseDown={() => media.endCut()}
				tooltip={`End a new cut or edit the nearest one (${shortcuts.cutStart})\nEnd a tiny cut (${shortcuts.cutStartTiny})`}
			>
				<Icon name="arrow-right-up" />
			</Button>
			<Button
				class="seekNext"
				semitransparent
				onMouseDown={() => media.seekToNextCutPoint()}
				tooltip="Seek to next cut point (PageDown)"
			>
				<Icon name="caret-right-stop" />
			</Button>

			<div class="space" />

			<Slider
				class="volume"
				type="volume"
				min={0}
				step={0.05}
				max={1}
				value={media.volume}
				onChange={(value) => media.setVolume(value)}
				tooltip={`Change volume (${shortcuts.volumeUp}/${shortcuts.volumeDown})`}
			/>

			<div class="space" />
		</div>
	);
}
