import {h} from 'preact';
import {useMemo} from 'preact/hooks';
import {msToIsoTime, msToHumanTime, seekTimeFromModifiers} from 'lib/utils';
import * as shortcuts from 'config/shortcuts';
import {CombinedMediaPlayer} from 'components/MediaPlayer';
import {Icon, Help} from 'components/Icon';
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
				tooltip="Start a new cut or edit the nearest one (ArrowUp)"
			>
				<Icon name="arrow-left-up" />
			</Button>
			<Button
				class="sek1fb"
				semitransparent
				disabled={media.isPlaying}
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
				disabled={media.isPlaying}
				onMouseDown={(event) => media.seekBy(seekTimeFromModifiers(event, media.frameTime))}
				tooltip={`Seek forward (ArrowRight)\n${seekModifiersDescription}`}
			>
				<Icon name="caret-right" />
			</Button>
			<Button
				class="endCut"
				semitransparent
				onMouseDown={() => media.endCut()}
				tooltip="End a new cut or edit the nearest one (ArrowDown)"
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

			<Help
				title={`Timeline controls:
Scroll to zoom.
${shortcuts.zoomTimelineIn} to zoom in
${shortcuts.zoomTimelineOut} to zoom out
Drag title or Shift+Scroll to pan.
Middle mouse button to reset zoom.
Drag timeline to cut.${media.players.length > 1 ? `\n${shortcuts.Ctrl_OR_Meta}+Drag title to re-order.` : ''}`}
			/>

			<div class="space" />

			<Slider
				class="volume"
				type="volume"
				min={0}
				step={0.05}
				max={1}
				value={media.volume}
				onChange={(value) => media.setVolume(value)}
				tooltip="Change volume (+/-)"
			/>
		</div>
	);
}
