import {h} from 'preact';
import {useRef, useEffect, useLayoutEffect, useState} from 'preact/hooks';
import {useElementSize} from 'lib/hooks';
import {eem, TargetedEvent, idModifiers, idKey, isInteractiveElement, rafThrottle, msToIsoTime, clamp} from 'lib/utils';
import {openContextMenu} from '@drovp/utils/modal-window';
import * as shortcuts from 'config/shortcuts';
import {Button} from 'components/Button';
import {Scrollable} from 'components/Scrollable';
import {Icon} from 'components/Icon';
import {Pre} from 'components/Pre';
import {Spinner} from 'components/Spinner';
import {ImageView} from 'components/ImageView';
import {openDialog} from 'components/Dialog';
import {MediaPlayer, CombinedMediaPlayer} from 'components/MediaPlayer';

const {abs, max, min, round} = Math;
const HOUR = 3_600_000;
const MINUTE = 60_000;
const HALF_MINUTE = 30_000;
const SECOND = 1_000;

export interface TimelineProps {
	media: CombinedMediaPlayer;
	fallbackWarning: (player: MediaPlayer) => string;
	onMove?: (fromIndex: number, toIndex: number) => void;
}

export function Timeline({media, fallbackWarning, onMove}: TimelineProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const gutterRef = useRef<HTMLCanvasElement>(null);
	const timelineRef = useRef<HTMLDivElement>(null);
	const cursorRef = useRef<HTMLDivElement>(null);
	const viewWidth = useElementSize(containerRef, 'padding-box')[0] ?? window.innerWidth;
	const [modifiersDown, setModifiersDown] = useState('');
	const [isGrabbing, setIsGrabbing] = useState(false);
	// Time in ms
	const [cursor, setCursor] = useState<number | null>(null);
	// Timeline view multiplication floating point
	const [zoom, setZoom] = useState(1);
	// How much time in ms should the timeline be panned to the left
	const [pan, setPan] = useState(0);
	// Ref containing a function that makes current cursor reset its context
	const cursorResetRef = useRef<{
		reset: () => void;
		pause: () => void;
		resume: () => void;
		handleMove: (event: {x: number}) => void;
	} | null>(null);
	// Limits and rendering sizes
	const timelineWidth = round(viewWidth * zoom);
	const panMax = max(0, ((timelineWidth - viewWidth) / timelineWidth) * media.duration);
	const panPx = round(min(panMax, (pan / media.duration) * timelineWidth));

	useEffect(() => {
		const container = containerRef.current;
		if (!container) return;

		// Ensure container doesn't scroll
		const resetScroll = () => container.scrollTo(0, 0);
		container.addEventListener('scroll', resetScroll);

		// Keyboard shortcuts
		const handleKeyDown = (event: KeyboardEvent) => {
			if (event.repeat || isInteractiveElement(event.target)) return;

			setModifiersDown(idModifiers(event));
			const disable = (event: KeyboardEvent) => {
				if (event.repeat) return;
				removeEventListener('keyup', disable);
				removeEventListener('keydown', disable);
				setModifiersDown('');
			};
			addEventListener('keydown', disable);
			addEventListener('keyup', disable);

			switch (idKey(event)) {
				case 'Ctrl++':
					handleZoom(1, pan + (media.duration - panMax) / 2);
					break;

				case 'Ctrl+-':
					handleZoom(-1, pan + (media.duration - panMax) / 2);
					break;
			}
		};

		addEventListener('keydown', handleKeyDown);

		return () => {
			container.removeEventListener('scroll', resetScroll);
			removeEventListener('keydown', handleKeyDown);
		};
	}, [handleZoom]);

	// Render gutter
	useLayoutEffect(() => {
		const canvas = gutterRef.current!;
		const ctx = canvas.getContext('2d')!;
		const width = canvas.clientWidth;
		const height = canvas.clientHeight;

		canvas.width = width;
		canvas.height = height;
		ctx.clearRect(0, 0, width, height);

		const timeStart = pan;
		const timeEnd = timeStart + (viewWidth / timelineWidth) * media.duration;
		const renderedDuration = timeEnd - timeStart;
		const minNotchDistance = 4;
		const lowestSpacing =
			[SECOND, HALF_MINUTE, MINUTE, HOUR].find(
				(ms) => timelineWidth / (media.duration / ms) > minNotchDistance
			) ?? HOUR;
		const roundedTimeStart = Math.floor(timeStart / lowestSpacing) * lowestSpacing;
		const roundedTimeEnd = Math.ceil(timeEnd / lowestSpacing) * lowestSpacing;
		const viewDuration = (viewWidth / timelineWidth) * media.duration;
		const renderedWidth = (viewDuration / renderedDuration) * viewWidth;

		// Render seconds, minutes, and hours
		for (let time = roundedTimeStart; time <= roundedTimeEnd; time = time + lowestSpacing) {
			const x = ((time - timeStart) / renderedDuration) * renderedWidth;
			if (time % HOUR === 0) {
				ctx.fillStyle = '#fff6';
				ctx.fillRect(x - 2, 0, 4, 12);
			} else if (time % MINUTE === 0) {
				ctx.fillStyle = '#fff4';
				ctx.fillRect(x - 1, 0, 2, 9);
			} else if (time % HALF_MINUTE === 0) {
				ctx.fillStyle = '#fff4';
				ctx.fillRect(x - 1, 0, 2, 6);
			} else if (time % SECOND === 0) {
				ctx.fillStyle = '#fff3';
				ctx.fillRect(x, 0, 1, 6);
			}
		}

		// Render frames
		if (timelineWidth / (media.duration / media.frameTime) > minNotchDistance) {
			const frameTimeStart = Math.floor(timeStart / media.frameTime) * media.frameTime;
			for (let time = frameTimeStart; time <= roundedTimeEnd; time = time + media.frameTime) {
				const x = ((time - timeStart) / renderedDuration) * renderedWidth;
				ctx.fillStyle = '#fff3';
				ctx.fillRect(x, 0, 1, 4);
			}
		}
	}, [viewWidth, timelineWidth, pan, media.duration]);

	// Ensure cursor time tip is not overflowing screen
	useLayoutEffect(() => {
		const cursor = cursorRef.current;
		const tip = cursor?.children[0] as HTMLDivElement | undefined;
		if (!cursor || !tip) return;

		const cursorRect = cursor.getBoundingClientRect();
		const tipLeft = cursorRect.left - tip.clientWidth / 2;
		const tipRight = cursorRect.right + tip.clientWidth / 2;
		const margin = 2;
		const neededLeftOffset =
			tipLeft < margin
				? margin - tipLeft
				: window.innerWidth - tipRight < margin
				? -(tipRight - window.innerWidth + margin)
				: 0;
		tip.style.left = neededLeftOffset !== 0 ? `${round(neededLeftOffset)}px` : '';
	}, [cursorRef.current, cursor]);

	function handleZoom(delta: number, timeCursor?: number) {
		const stepSize = 0.2;
		// Max zoom should display a frame for every 10 pixels
		const maxZoom = max(1, ((media.duration / media.frameTime) * 10) / viewWidth);
		const newZoom = clamp(1, zoom + zoom * (delta > 0 ? stepSize : -stepSize), maxZoom);

		// Reposition pan so that the cursor doesn't move on the screen
		if (timeCursor != null) {
			const zoomDeltaFraction = newZoom / zoom;
			const newTimelineWidth = timelineWidth * zoomDeltaFraction;
			const cursorOffsetPx = ((timeCursor - pan) / media.duration) * timelineWidth;
			const newCursorOffsetMs = (cursorOffsetPx / newTimelineWidth) * media.duration;
			const newPan = timeCursor - newCursorOffsetMs;
			const panMax = max(0, ((newTimelineWidth - viewWidth) / newTimelineWidth) * media.duration);
			setPan(clamp(0, newPan, panMax));
		}

		setZoom(newZoom);
		cursorResetRef.current?.reset();
	}

	function handleTimelineMouseDown(event: TargetedEvent<HTMLDivElement, MouseEvent>) {
		/**
		 * Panning.
		 */
		if (zoom > 1) {
			const panPerPx = media.duration / timelineWidth;
			const initX = event.x;
			const initPan = pan;
			const initialCursor = document.documentElement.style.cursor;
			document.documentElement.style.cursor = 'grabbing';

			const handleMove = rafThrottle((event: MouseEvent) => {
				const delta = initX - event.x;
				setPan(clamp(0, initPan + panPerPx * delta, panMax));
				cursorResetRef.current?.reset();
			});
			const cancel = () => {
				document.documentElement.style.cursor = initialCursor;
				removeEventListener('mousemove', handleMove);
				removeEventListener('mouseup', cancel);
				cursorResetRef.current?.reset();
				cursorResetRef.current?.resume();
				setIsGrabbing(false);
			};

			setIsGrabbing(true);
			cursorResetRef.current?.pause();
			addEventListener('mousemove', handleMove);
			addEventListener('mouseup', cancel);
			return;
		}
	}

	// Segment drag & drop re-ordering
	function handleTitleMouseDown(event: TargetedEvent<HTMLElement, MouseEvent>) {
		const initCurrentTarget = event.currentTarget;
		const draggedElement = initCurrentTarget.parentElement;
		const container = draggedElement?.parentElement;
		const tabElements = container ? ([...container.children] as HTMLElement[]) : null;
		const draggedIndex = tabElements?.indexOf(draggedElement as any);

		// Ignore non primary mouse buttons, invalid initial index, and events originating inside button elements
		if (
			idModifiers(event) !== shortcuts.Ctrl_OR_Meta ||
			event.button !== 0 ||
			!container ||
			!tabElements ||
			draggedIndex == null ||
			draggedIndex < 0 ||
			draggedIndex >= media.players.length ||
			(event.target as HTMLElement | null)?.closest('button') != null
		) {
			return;
		}

		event.stopPropagation();
		setIsGrabbing(true);

		let targetIndex = draggedIndex;
		const containerRect = container.getBoundingClientRect();
		const rects = tabElements.map(getPositionContext);
		const spacing = rects.length > 1 ? rects[1]!.start - rects[0]!.end : 0;
		const draggedRect = rects[draggedIndex]!;
		const cursorCenterOffset = event.x - (draggedRect.start + draggedRect.size / 2);
		const initialX = event.x - containerRect.left;
		const cursor = {initialX, x: initialX};
		const initialCursor = document.documentElement.style.cursor;

		document.documentElement.style.cursor = 'grabbing';

		// Apply styles
		for (const element of tabElements) {
			if (element === draggedElement) {
				element.classList.add('-dragged');
				element.style.position = 'relative';
				element.style.zIndex = '2';
			} else {
				element.style.transition = 'transform 100ms ease-out';
			}
		}

		const updateStyles = rafThrottle(() => {
			// Dragged element simply mirrors cursor position
			draggedElement.style.transform = `translateX(${Math.round(cursor.x - cursor.initialX)}px)`;

			// Find element that has at least half of its width covered by dragged element
			const draggedLeftEdge = cursor.x + containerRect.left - cursorCenterOffset - draggedRect.size / 2;
			const draggedRightEdge = draggedLeftEdge + draggedRect.size;

			parent: for (let i = 0; i < rects.length; i++) {
				const {center} = rects[i]!;

				if (i < draggedIndex) {
					if (center >= draggedLeftEdge) {
						targetIndex = i;
						break;
					}
				} else {
					for (let i = rects.length - 1; i >= draggedIndex; i--) {
						const {center} = rects[i]!;
						if (center <= draggedRightEdge) {
							targetIndex = i;
							break parent;
						}
					}
					targetIndex = draggedIndex;
					break;
				}
			}

			// Shift element
			const shiftStart = Math.min(draggedIndex, targetIndex);
			const shiftEnd = Math.max(draggedIndex, targetIndex);

			for (let i = 0; i < rects.length; i++) {
				const {element} = rects[i]!;
				if (element === draggedElement) continue;
				const isBetween = i >= shiftStart && i <= shiftEnd;
				const shiftLeft = draggedIndex < targetIndex;
				element.style.transform = `translateX(${
					isBetween ? (draggedRect.size + spacing) * (shiftLeft ? -1 : 1) : 0
				}px)`;
			}
		});

		const handleMove = (event: MouseEvent) => {
			cursor.x = event.x - containerRect.left;
			updateStyles();
		};

		const handleUp = (event: MouseEvent) => {
			updateStyles.cancel();
			document.documentElement.style.cursor = initialCursor;

			for (const element of tabElements) {
				if (element === draggedElement) element.classList.remove('-dragged');
				for (const prop of ['position', 'zIndex', 'transition', 'transform'] as const) {
					element.style[prop] = '';
				}
			}

			window.removeEventListener('mousemove', handleMove);
			window.removeEventListener('mouseup', handleUp);

			// Handle move
			if (onMove && draggedIndex !== targetIndex) onMove(draggedIndex, targetIndex);
			setIsGrabbing(false);
		};

		window.addEventListener('mousemove', handleMove);
		window.addEventListener('mouseup', handleUp);
	}

	function handleTrackMouseDown(event: TargetedEvent<HTMLDivElement, MouseEvent>) {
		/**
		 * Middle mouse button: reset zoom.
		 */
		if (event.button === 1) {
			setZoom(1);
			setPan(0);
			cursorResetRef.current?.reset();
			return;
		}

		event.stopPropagation();

		/**
		 * Seeking & cutting.
		 */
		if (event.button !== 0 || idModifiers(event) !== '') return;
		const rect = event.currentTarget.getBoundingClientRect();
		const initX = event.x;
		const positionFraction = (initX - rect.left) / rect.width;
		const targetTime = media.duration * positionFraction;
		const wasPlaying = media.isPlaying;

		media.pause();
		media.seekTo(targetTime);

		// Cuts editing below
		const initCursor = document.documentElement.style.cursor;

		// Determine cut underneath the cursor
		const newDirtyCuts = media.cuts?.map((cut) => [...cut] as Cut) ?? [];
		const eventTarget = event.target as HTMLElement;
		const datasetFrom = eventTarget.dataset.from;
		const datasetTo = eventTarget.dataset.to;
		const requestedMode = !!datasetFrom || !!datasetTo;
		let moveAction: (timeDelta: number, xDelta: number, currentTime: number) => void;

		const initSideMove = (cut: Cut, movedIndex: 0 | 1) => {
			const initTime = cut[movedIndex];
			moveAction = (timeDelta, _, currentTime) => {
				cut![movedIndex] = initTime + timeDelta;
				media.setCuts(newDirtyCuts);
				media.seekTo(currentTime);
			};
		};

		if (requestedMode) {
			let requestedIndex = datasetFrom ? parseInt(datasetFrom, 10) : datasetTo ? parseInt(datasetTo, 10) : -1;
			let targetCut = newDirtyCuts[requestedIndex];
			const movedIndex = datasetFrom ? 0 : 1;

			if (targetCut) initSideMove(targetCut, movedIndex);
		} else {
			let targetCut = newDirtyCuts.find((cut) => targetTime >= cut[0] && targetTime <= cut[1]);

			moveAction = (_, xDelta) => {
				if (abs(xDelta) < 4) return;

				document.documentElement.style.cursor = 'ew-resize';

				if (!targetCut) {
					// No cut underneath the cursor, create a new one
					targetCut = [targetTime, targetTime];
					newDirtyCuts.push(targetCut);
					initSideMove(targetCut, 1);
				} else {
					// Moving cut
					const initFrom = Math.min(...targetCut);
					const cutDuration = Math.abs(targetCut[1] - targetCut[0]);
					moveAction = (timeDelta) => {
						targetCut![0] = initFrom + timeDelta;
						targetCut![1] = targetCut![0] + cutDuration;
						media.setCuts(newDirtyCuts);
					};
				}
			};
		}

		const handleMove = rafThrottle((event: MouseEvent) => {
			const xDelta = event.x - initX;
			const timeDelta = (xDelta / rect.width) * media.duration;
			const positionFraction = (event.x - rect.left) / rect.width;
			const currentTime = media.duration * positionFraction;
			moveAction(timeDelta, xDelta, currentTime);
		});

		const handleUp = () => {
			document.documentElement.style.cursor = initCursor;
			removeEventListener('mousemove', handleMove);
			removeEventListener('mouseup', handleUp);
			if (wasPlaying) media.play();
		};

		addEventListener('mousemove', handleMove);
		addEventListener('mouseup', handleUp);
	}

	// Track time cursor
	function handleTrackMouseEnter(event: TargetedEvent<HTMLDivElement, MouseEvent>) {
		const timeline = event.currentTarget;

		let rect = timeline.getBoundingClientRect();
		let resetRect = false;
		let paused = false;

		const handleMove = rafThrottle((event: {x: number}) => {
			if (paused) return;
			if (resetRect) {
				rect = timeline.getBoundingClientRect();
				resetRect = false;
			}
			const positionFraction = (event.x - rect.left) / rect.width;
			const positionTime = round((positionFraction * media.duration) / media.frameTime) * media.frameTime;
			setCursor(positionTime);
		});

		cursorResetRef.current = {
			reset: () => (resetRect = true),
			pause: () => (paused = true),
			resume: () => (paused = false),
			handleMove,
		};

		function cancel() {
			cursorResetRef.current = null;
			handleMove.cancel();
			timeline.removeEventListener('mousemove', handleMove);
			timeline.removeEventListener('mouseleave', cancel);
			setCursor(null);
		}

		timeline.addEventListener('mousemove', handleMove);
		timeline.addEventListener('mouseleave', cancel);
		handleMove(event);
	}

	// Pan & Zoom with wheel
	function handleWheel(event: TargetedEvent<HTMLDivElement, WheelEvent>) {
		// Pan
		if (idModifiers(event) === 'Shift') {
			setPan(clamp(0, pan + (event.deltaY > 0 ? 50 : -50) * (media.duration / timelineWidth), panMax));
			cursorResetRef.current?.reset();
			cursorResetRef.current?.handleMove(event);
			return;
		}

		// Zoom
		const timelineRect = timelineRef.current!.getBoundingClientRect();
		const cursor = ((event.x - timelineRect.left) / timelineWidth) * media.duration;
		handleZoom(event.deltaY, cursor);
	}

	function handleTrackContextMenu(event: TargetedEvent<HTMLDivElement, MouseEvent>) {
		event.preventDefault();

		const rect = event.currentTarget.getBoundingClientRect();
		const initX = event.x;
		const positionFraction = (initX - rect.left) / rect.width;
		const targetTime = media.duration * positionFraction;
		let targetCut = media.cuts?.find((cut) => targetTime >= cut[0] && targetTime <= cut[1]);

		openContextMenu([
			{
				label: 'Start cut',
				click: () => media.startCut(targetTime),
				accelerator: shortcuts.shortcutToAccelerator(shortcuts.cutStart),
			},
			{
				label: 'End cut',
				click: () => media.endCut(targetTime),
				accelerator: shortcuts.shortcutToAccelerator(shortcuts.cutEnd),
			},
			{
				label: 'Delete cut',
				enabled: targetCut != null,
				click: () => media.setCuts(media.cuts?.filter((cut) => cut !== targetCut)),
				accelerator: shortcuts.cutDelete,
			},
			{
				label: 'Delete all cuts',
				enabled: media.cuts != null,
				click: () => media.setCuts(undefined),
				accelerator: shortcuts.cutDeleteAll,
			},
		]);
	}

	let classNames = 'Timeline';
	if (isGrabbing) classNames += ' -grabbing';
	else if (zoom > 1 || modifiersDown === shortcuts.Ctrl_OR_Meta) classNames += ' -grab';

	return (
		<div ref={containerRef} class={classNames}>
			<div
				ref={timelineRef}
				class="timeline"
				onWheel={handleWheel}
				style={`width:${timelineWidth}px;left:-${panPx}px`}
				onMouseDown={handleTimelineMouseDown}
			>
				<div class="segments">
					{media.players.map((player) =>
						renderSegment(
							player,
							media.players.length > 1 ? handleTitleMouseDown : undefined,
							fallbackWarning(player)
						)
					)}
				</div>
				<div
					class="time"
					onMouseDown={handleTrackMouseDown}
					onMouseEnter={handleTrackMouseEnter}
					onContextMenu={handleTrackContextMenu}
				>
					{media.cuts && (
						<ul class="cuts">
							{media.cuts.map(([from, to], index) => (
								<li
									style={`left:${(from / media.duration) * 100}%;width:${
										((to - from) / media.duration) * 100
									}%`}
								>
									<div class="handle -start" data-from={index} />
									<div class="handle -end" data-to={index} />
								</li>
							))}
						</ul>
					)}
					<div class="position" style={`--position:${media.currentTime / media.duration}`} />
					{cursor != null && (
						<div ref={cursorRef} class="cursor" style={`--position:${cursor / media.duration}`}>
							<div class="tip">{msToIsoTime(cursor).slice(-media.durationHuman.length)}</div>
						</div>
					)}
				</div>
			</div>
			<canvas ref={gutterRef} class="gutter" />
			{zoom !== 1 && (
				<div class="zoom">
					<Icon name="zoom" />
					{round(zoom * 100)}%
				</div>
			)}
		</div>
	);
}

function renderSegment(
	player: MediaPlayer,
	onTitleMouseDown: ((event: TargetedEvent<HTMLElement, MouseEvent>) => void) | undefined,
	fallbackWarning: string
) {
	const halfLength = round(player.filename.length / 2);
	const hasAudioStreams = player.meta.type === 'video' ? player.meta.audioStreams.length > 0 : true;

	let classNames = '';
	if (player.mode === 'unsupported') classNames += ' -danger';
	else if (player.mode === 'fallback') classNames += ' -warning';
	if (onTitleMouseDown) classNames += ' -draggable';

	return (
		<article
			key={player.meta.path}
			class={classNames}
			style={`flex-grow:${player.meta.duration}`}
			data-duration={player.meta.duration}
		>
			<h1 onMouseDown={onTitleMouseDown}>
				<span class="start">{player.filename.slice(0, halfLength)}</span>
				<span class="end">{player.filename.slice(halfLength)}</span>
				<span class="space" />
				{player.mode === 'unsupported' ? (
					<Icon
						name="error"
						class="error"
						title={`Playback not supported for ${player.meta.codec || 'this type of file'}`}
					/>
				) : player.mode === 'fallback' ? (
					<Icon name="warning" class="warning" title={fallbackWarning} />
				) : null}
				{hasAudioStreams ? (
					!player.isLoadingWaveform &&
					player.waveform == null && (
						<Button
							semitransparent
							onClick={async () => {
								try {
									await player.loadWaveform();
								} catch (error) {
									openDialog({
										title: `Waveform loading error`,
										content: (
											<Scrollable class="WaveformError">
												<p>There has been an error trying to load the waveform for file:</p>
												<p>
													<code>
														<b>{player.meta.path}</b>
													</code>
												</p>
												<Pre>{eem(error)}</Pre>
											</Scrollable>
										),
									});
								}
							}}
							tooltip="Load waveform"
						>
							<Icon name="waveform" />
						</Button>
					)
				) : (
					<Icon class="muted" name="muted" title="This media doesn't have an audio track" />
				)}
			</h1>
			<div class="track">
				{player.isLoadingAudio ? (
					<div class="loading">
						<Spinner /> Loading Audio...
					</div>
				) : player.isLoadingWaveform ? (
					<div class="loading">
						<Spinner /> Loading waveform...
					</div>
				) : player.waveform != null ? (
					<ImageView class="waveform" data={player.waveform} />
				) : null}
			</div>
		</article>
	);
}

function getPositionContext(element: HTMLElement) {
	const rect = element.getBoundingClientRect();
	return {
		element,
		start: rect.left,
		size: rect.width,
		end: rect.left + rect.width,
		center: rect.left + Math.round(rect.width / 2),
	};
}
