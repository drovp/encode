/**
 * The code below is HORRIBLE. It's a result of wanting to get it done fast and
 * implementing first solutions that popped in my head. I apologize, and feel
 * ashamed, but I struggle finding time to refactor it, so here we are :(
 */
import * as Path from 'path';
import {h, VNode} from 'preact';
import {useState, useEffect, useMemo, useRef} from 'preact/hooks';
import {VideoMeta, AudioMeta} from 'ffprobe-normalized';
import {useForceUpdate} from 'lib/hooks';
import {
	eem,
	cropDetect,
	msToHumanTime,
	clamp,
	sanitizeCuts,
	throttle,
	promiseThrottle,
	drawImageToCanvas,
	resizeRegion,
	moveItem,
	rafThrottle,
	findCutAtTime,
	splitCutsAtTime,
} from 'lib/utils';
import {tapElementSize} from 'lib/elementSize';
import {getOneRawFrame, getWaveform, makeFrameStream, encodeFallbackAudio} from 'lib/ffmpeg';
import {Spinner} from 'components/Spinner';
import {Vacant} from 'components/Vacant';
import {openDialog, DialogErrorContent} from 'components/Dialog';

const {round, min} = Math;

export type MediaPlayer = ReturnType<typeof makeMediaPlayer>;
export type CombinedMediaPlayer = ReturnType<typeof makeCombinedMediaPlayer>;

export function useCombinedMediaPlayer(media: (VideoMeta | AudioMeta)[], ffmpegPath: string) {
	if (media.length < 0) throw new Error(`useMedia() requires at least 1 media file.`);
	const forceUpdate = useForceUpdate();
	return useMemo(() => makeCombinedMediaPlayer(media, {ffmpegPath, onUpdate: forceUpdate}), []);
}

/**
 * Consolidates multiple media players into one interface on the same timeline.
 */
export function makeCombinedMediaPlayer(
	media: (VideoMeta | AudioMeta)[],
	{ffmpegPath, onUpdate}: {ffmpegPath: string; onUpdate?: () => void}
) {
	type Self = typeof self;

	const _players = media.map((meta) => makeMediaPlayer(meta, {ffmpegPath, onPropUpdate: onUpdate}));
	const duration = media.reduce((duration, meta) => duration + meta.duration, 0);
	const displayWidth =
		media.reduce(
			(width, meta) => (meta.type === 'video' && meta.displayWidth > width ? meta.displayWidth : width),
			0
		) || 640;
	const displayHeight =
		media.reduce(
			(height, meta) => (meta.type === 'video' && meta.displayHeight > height ? meta.displayHeight : height),
			0
		) || 480;
	const isAudioOnly = _players.find((player) => player.meta.type !== 'audio') == null;
	const displayAspectRatio = displayWidth / displayHeight;
	const frameTime = (() => {
		let frameTime = _players[0]?.frameTime || 30;
		return frameTime >= 200 ? 100 : frameTime;
	})();
	let visualizerContext: {ctx: CanvasRenderingContext2D; width: number; height: number} | null = null;
	const self = {
		players: _players,
		isAudioOnly,
		duration,
		width: displayWidth,
		height: displayHeight,
		aspectRatio: displayAspectRatio,
		durationHuman: msToHumanTime(duration),
		frameTime,
		isPlaying: false,
		currentPlayer: _players[0]!,
		currentTime: 0,
		cropDetect: _cropDetect,
		movePlayer,
		normalizeTime,
		getTimeAtPosition,
		splitCutsAtTime: (time: number) =>
			self.cuts && setValue('cuts', splitCutsAtTime(self.cuts, time, self.frameTime)),
		splitCuts: () => self.splitCutsAtTime(self.currentTime),

		volume: 0.5,
		setVolume: (volume: number) => setValue('volume', volume),

		speed: 1,
		setSpeed,

		play,
		playFrom,
		pause,
		togglePlay,
		seekTo,
		seekBy,
		seekToPrevCutPoint,
		seekToNextCutPoint,

		cuts: undefined as Cuts,
		setCuts: (cuts: Cuts) => setValue('cuts', cuts),
		currentCutIndex: -1,
		addCut,
		startCut,
		endCut,
		deleteCut,
		deleteCurrentCut,

		Component,
	};

	registerPlayerEvents();

	// Register player events
	function registerPlayerEvents() {
		let lastStartDuration = 0;
		for (let i = 0; i < self.players.length; i++) {
			const player = self.players[i]!;
			const nextPlayer = self.players[i + 1];
			const startDuration = lastStartDuration;
			lastStartDuration += player.meta.duration;

			player.onTimeUpdate = (time) => setValue('currentTime', startDuration + time);
			player.onAlive = () => {
				if (self.currentPlayer !== player) {
					self.currentPlayer.pause();
					setValue('currentPlayer', player);
				}
			};

			if (nextPlayer) {
				player.onEnded = () => {
					nextPlayer.clearCanvas();
					nextPlayer.seekTo(0);
					if (self.isPlaying) nextPlayer.play();
				};
			} else {
				player.onEnded = () => setValue('isPlaying', false);
			}
		}
	}

	function setValue<T extends keyof Self>(name: T, value: Self[T]) {
		self[name] = value;

		// Special handling
		switch (name) {
			case 'cuts': {
				const newCuts = value as Cuts;
				self.cuts = newCuts ? sanitizeCuts(newCuts, self.duration, self.frameTime / 2) : undefined;
				// No break on purpose! We need to update `currentCutIndex` below too.
			}
			case 'currentTime': {
				self.currentCutIndex = findCutAtTime(self.cuts, self.currentTime, self.frameTime);
				break;
			}
		}

		onUpdate?.();
	}

	/**
	 * Returns a tuple of MediaPlayer at passed time, and seeked time within that player's timeline.
	 */
	function getPlayerAtTime(timeMs: number): [MediaPlayer, number] {
		timeMs = normalizeTime(timeMs);
		const lastPlayer = self.players[self.players.length - 1]!;
		let lastDuration = 0;

		for (const player of self.players) {
			const currentTotalDuration = lastDuration + player.meta.duration;
			if (timeMs < currentTotalDuration) return [player, timeMs - lastDuration];
			lastDuration = currentTotalDuration;
		}

		return [lastPlayer, lastPlayer.meta.duration];
	}

	function setSpeed(value: number) {
		if (value < 0.5 || value > 100) throw new Error(`Speed is outside of allowed range of 0.5-100.`);
		self.speed = value;
		for (const player of self.players) player.setSpeed(value);
	}

	/** Returns time rounded to `frameTime` increments. */
	function normalizeTime(time: number): number {
		return clamp(0, round(time / self.frameTime) * self.frameTime, duration);
	}

	/** Returns normalized (`frameTime` rounded) time at `0-1` floating position. */
	function getTimeAtPosition(position: number): number {
		return normalizeTime(self.duration * position);
	}

	async function _cropDetect(options: Parameters<typeof cropDetect>[1]) {
		const player = self.currentPlayer;
		const rawCrop = await player.cropDetect(options);

		if (!rawCrop) return undefined;

		// Rescale the crop to fit media set
		const scaleFactor =
			self.aspectRatio > player.aspectRatio ? self.height / player.height : self.width / player.width;
		const scaledCrop = resizeRegion(
			rawCrop,
			round((rawCrop.sourceWidth * scaleFactor) / 2) * 2,
			round((rawCrop.sourceHeight * scaleFactor) / 2) * 2
		);

		// Adjust scaled crop position for media frame
		scaledCrop.sourceWidth = self.width;
		scaledCrop.sourceHeight = self.height;
		if (self.aspectRatio > player.aspectRatio) {
			const offset = round((self.width - player.width * scaleFactor) / 2);
			scaledCrop.x += offset;
		} else {
			const offset = round((self.height - player.height * scaleFactor) / 2);
			scaledCrop.y += offset;
		}
		scaledCrop.width = min(scaledCrop.width, scaledCrop.sourceWidth - scaledCrop.x);
		scaledCrop.height = min(scaledCrop.height, scaledCrop.sourceHeight - scaledCrop.y);

		return scaledCrop;
	}

	function movePlayer(from: number, to: number) {
		const wasPlaying = self.isPlaying;
		moveItem(self.players, from, to);
		registerPlayerEvents();

		const [newPlayer, seekTime] = getPlayerAtTime(self.currentTime);
		self.currentPlayer.pause();

		if (wasPlaying) newPlayer.playFrom(seekTime);
		else newPlayer.seekTo(seekTime);
	}

	function pause() {
		self.currentPlayer.pause();
		setValue('isPlaying', false);
	}

	function togglePlay() {
		if (self.isPlaying) pause();
		else play();
	}

	function play() {
		let player = self.currentPlayer;

		// If play is requested at the end of timeline, restart from start
		if (duration - self.currentTime < 1) {
			player = self.players[0]!;
			player.playFrom(0);
		} else {
			player.play();
		}

		setValue('isPlaying', true);
		if (isAudioOnly) visualizerLoop();
	}

	function playFrom(timeMs: number) {
		timeMs = normalizeTime(timeMs);
		const [newPlayer, seekTime] = getPlayerAtTime(self.currentTime);
		self.currentPlayer.pause();
		newPlayer.playFrom(seekTime);

		setValue('isPlaying', true);
		if (isAudioOnly) visualizerLoop();
	}

	function seekTo(timeMs: number) {
		timeMs = normalizeTime(timeMs);
		const [newPlayer, seekTime] = getPlayerAtTime(timeMs);

		if (self.currentPlayer !== newPlayer) self.currentPlayer.pause();

		if (self.isPlaying) {
			newPlayer.playFrom(seekTime);
		} else {
			newPlayer.seekTo(seekTime);
		}
	}

	function seekBy(deltaMs: number) {
		seekTo(clamp(0, self.currentTime + deltaMs, duration));
	}

	// Breakpoint is cut edge, or a concat video seam
	function getBreakpoints() {
		const seams: number[] = [];

		if (self.players.length > 1) {
			for (let i = 0; i < self.players.length - 1; i++) {
				const player = self.players[i]!;
				seams.push((seams[seams.length - 1] ?? 0) + player.meta.duration);
			}
		}

		return [...(self.cuts?.flat() ?? []), ...seams].sort((a, b) => a - b);
	}

	function seekToPrevCutPoint() {
		for (const point of getBreakpoints().reverse() || []) {
			if (point < self.currentTime - frameTime / 2) {
				seekTo(point);
				return;
			}
		}

		seekTo(0);
	}

	function seekToNextCutPoint() {
		for (const point of getBreakpoints() || []) {
			if (point > self.currentTime + frameTime / 2) {
				seekTo(point);
				return;
			}
		}

		seekTo(duration);
	}

	function addCut(cut: Cut) {
		setValue('cuts', [...(self.cuts || []), cut]);
	}

	function startCut(time = self.currentTime) {
		if (duration - time < 1) return;

		const newCuts = self.cuts ? [...self.cuts] : [];
		const currentCut = newCuts[findCutAtTime(self.cuts, time, self.frameTime)];
		const nextCut = newCuts.find(([from]) => from > time);

		if (currentCut) {
			currentCut[0] = time;
		} else if (nextCut) {
			nextCut[0] = time;
		} else {
			newCuts.push([time, duration]);
		}

		setValue('cuts', newCuts);
	}

	function endCut(time = self.currentTime) {
		if (time < 1) return;

		const newCuts = self.cuts ? [...self.cuts] : [];
		const currentCut = newCuts[findCutAtTime(self.cuts, time, self.frameTime)];
		const previousCut = [...newCuts].reverse().find(([, to]) => to < time);

		if (currentCut) {
			currentCut[1] = time;
		} else if (previousCut) {
			previousCut[1] = time;
		} else {
			newCuts.unshift([0, time]);
		}

		setValue('cuts', newCuts);
	}

	function deleteCut(index: number) {
		if (self.cuts && index >= 0 && index < self.cuts.length) {
			self.cuts.splice(index, 1);
			setValue('cuts', self.cuts.length > 0 ? [...self.cuts] : undefined);
		}
	}

	function deleteCurrentCut() {
		if (self.currentCutIndex > -1) deleteCut(self.currentCutIndex);
	}

	const visualizerLoop = rafThrottle(() => {
		if (!visualizerContext) return;
		const {ctx, width, height} = visualizerContext;

		ctx.clearRect(0, 0, width, height);
		ctx.fillStyle = '#fff';
		ctx.lineWidth = 2;
		ctx.strokeStyle = '#fff';

		const frequencyData = self.currentPlayer.getByteFrequencyData();
		let maxValue = 0;
		if (frequencyData) {
			const columns = 64;
			const gapSize = 1;
			const barWidth = (width - gapSize * (columns + 1)) / columns;
			const maxBarHeight = height / 2 - gapSize;
			const columnDataPoints = frequencyData.length / columns;

			let maxColumnValue = 0;
			for (let i = 0; i < frequencyData.length; i++) {
				let value = frequencyData[i]!;
				const oneBasedI = i + 1;
				if (value > maxValue) maxValue = value;

				if (oneBasedI % columnDataPoints !== 0) {
					if (value > maxColumnValue) maxColumnValue = value;
					continue;
				} else {
					value = maxColumnValue;
					maxColumnValue = 0;
				}

				let actualI = oneBasedI / columnDataPoints - 1;
				const barHeight = maxBarHeight * (value / 255);
				const x = gapSize * (actualI + 1) + barWidth * actualI;
				const y = gapSize + height - barHeight;
				const w = barWidth;
				const h = barHeight;
				ctx.fillRect(x, y, w, h);
			}
		}

		const timeData = self.currentPlayer.getByteTimeDomainData();
		if (timeData) {
			const yBase = height / 4;
			const maxWaveHeight = height / 4;

			ctx.beginPath();
			ctx.moveTo(-10, yBase);

			for (let i = 0; i < timeData.length; i++) {
				const value = timeData[i]!;
				const x = width * (i / timeData.length);
				const y = yBase + maxWaveHeight * ((value - 128) / 128);
				ctx.lineTo(x, y);
			}

			ctx.lineTo(width + 10, yBase);
			ctx.stroke();
		}

		// If there's only silence, and playback is paused, terminate loop
		if (maxValue > 0 || self.isPlaying) visualizerLoop();
	});

	function Component() {
		const visualizerRef = useRef<HTMLCanvasElement>(null);

		useEffect(() => {
			const canvas = visualizerRef.current;
			if (canvas) {
				const [width, height, dispose] = tapElementSize(canvas, ([width, height]) => {
					if (visualizerContext) {
						canvas.width = visualizerContext.width = width;
						canvas.height = visualizerContext.height = height;
					}
				});
				visualizerContext = {ctx: canvas.getContext('2d')!, width, height};
				canvas.width = width;
				canvas.height = height;
				return dispose;
			} else {
				visualizerContext = null;
			}
		}, [isAudioOnly]);

		return (
			<div
				class="CombinedPlayers"
				style={isAudioOnly ? undefined : `aspect-ratio:${displayWidth}/${displayHeight}`}
			>
				{self.players.map((player) => (
					<player.Component
						key={player.meta.path}
						hidden={isAudioOnly || self.currentPlayer !== player}
						volume={self.volume}
						style={
							isAudioOnly
								? undefined
								: `min-${self.aspectRatio > player.aspectRatio ? 'height' : 'width'}:100%`
						}
					/>
				))}
				{isAudioOnly && <canvas class="visualizer" ref={visualizerRef} />}
			</div>
		);
	}

	return self;
}

interface AudioInterface {
	timeData: Uint8Array;
	frequencyData: Uint8Array;
	audioCtx: AudioContext;
	source: AudioNode;
	analyser: AnalyserNode;
}

/**
 * Creates an interface and component renderer for a single media file.
 */
export function makeMediaPlayer(
	meta: VideoMeta | AudioMeta,
	{
		ffmpegPath,
		onPropUpdate,
		onTimeUpdate,
		onEnded,
		onAlive,
	}: {
		ffmpegPath: string;
		onPropUpdate?: () => void;
		onTimeUpdate?: (timeMs: number) => void;
		onEnded?: () => void;
		onAlive?: () => void;
	}
) {
	type Self = typeof self;
	type Mode = 'native' | 'fallback' | 'unsupported' | 'loading';
	const frameTime = 1000 / (meta.type === 'video' ? meta.framerate || 30 : 30);
	const width = meta.type === 'video' ? meta.width : 640;
	const height = meta.type === 'video' ? meta.height : 480;
	const displayWidth = meta.type === 'video' ? meta.displayWidth : width;
	const displayHeight = meta.type === 'video' ? meta.displayHeight : height;
	const displayAspectRatio = displayWidth / displayHeight;
	const isAudio = meta.type === 'audio';
	let video: HTMLVideoElement | null = null;
	let canvas: HTMLCanvasElement | null = null;
	let fallbackAudio: HTMLAudioElement | null = null;
	let frameStreamDisposer: (() => void) | null = null;
	let audioInterface: AudioInterface | null = null;
	let nativeVideoPlayerNeedsFallbackAudio: false | string = false; // false or unsupported codec
	// Timestamp of a full frame currently rendered in canvas.
	let currentFullFrameTime: number | null = null;
	const srcSafePath = meta.path
		.split(/\\|\//)
		.map((part, i) => (i === 0 && part.match(/^\w+:$/) != null ? part : encodeURIComponent(part)))
		.join('/');

	const loading = new Promise<Mode>((resolve) => {
		const video = document.createElement('video');
		video.oncanplaythrough = () => {
			/**
			 * 1st event is useless, as the video will always have webkitAudioDecodedByteCount set to 0.
			 * To fix that, we seek, and listen for the 2nd one, which SHOULD have that data.
			 * These APIs are a nightmare to work with.
			 */
			video.oncanplaythrough = () => {
				// Determine if video can be played natively
				const playerType = meta.type === 'video' && video.videoWidth === 0 ? 'fallback' : 'native';
				const firstAudioStream = meta.type === 'video' ? meta.audioStreams[0] : undefined;

				// Some videos have audio track that is not supported by web player
				if (
					playerType === 'native' &&
					firstAudioStream &&
					!(video as any).webkitAudioDecodedByteCount &&
					!(video as any).mozHasAudio
				) {
					nativeVideoPlayerNeedsFallbackAudio = firstAudioStream.codec;
				}

				resolve(playerType);
			};

			video.currentTime = 0;
		};
		video.onerror = () => resolve('fallback');
		video.src = srcSafePath;
	});

	loading.then((mode) => {
		self.mode = mode;

		if (
			(mode === 'native' && meta.type === 'video' && nativeVideoPlayerNeedsFallbackAudio) ||
			(meta.type === 'audio' && mode === 'fallback')
		) {
			const unsupportedCodec = meta.type === 'video' ? nativeVideoPlayerNeedsFallbackAudio : meta.codec;
			self.warningMessage = `Playback of "${unsupportedCodec}" audio is not supported natively, so we are using a fallback audio stream which is limited to mono.`;
		} else if (mode === 'fallback') {
			self.warningMessage = `Native player is missing decoders for "${meta.codec}" inside "${meta.container}", so we're using a fallback ffmpeg based player which is slower, lower quality, and audio can get out of sync during editing.\nThis only affects the preview, the final encode will be as expected`;
		}

		self.onPropUpdate?.();
	});

	const self = {
		isPlaying: false,
		currentTime: 0,
		mode: 'loading' as Mode,
		meta,
		frameTime,
		width: displayWidth,
		height: displayHeight,
		aspectRatio: displayAspectRatio,
		filename: Path.basename(meta.path),
		loading,
		reload,
		getByteFrequencyData,
		getByteTimeDomainData,
		Component,
		warningMessage: null as null | string,

		speed: 1,
		setSpeed,

		play,
		playFrom,
		pause,
		seekTo,
		cropDetect: _cropDetect,
		isLoadingAudio: false,
		isLoadingWaveform: false,
		waveform: undefined as undefined | ImageData,
		loadWaveform,
		clearCanvas,

		onPropUpdate: onPropUpdate as typeof onPropUpdate | undefined | null,
		onTimeUpdate: onTimeUpdate as typeof onTimeUpdate | undefined | null,
		onEnded: onEnded as typeof onEnded | undefined | null,
		onAlive: onAlive as typeof onAlive | undefined | null,
	};

	function setValue<T extends keyof Self>(name: T, value: Self[T]) {
		if (self[name] !== value) {
			self[name] = value;
			self.onPropUpdate?.();
		}
	}

	function normalizeTime(time: number) {
		return clamp(0, round(time / self.frameTime) * self.frameTime, meta.duration);
	}

	const requestTimeUpdate = throttle(() => self.onTimeUpdate?.(self.currentTime), 200);

	function setSpeed(value: number) {
		if (value < 0.5 || value > 100) throw new Error(`Speed is outside of allowed range of 0.5-100.`);
		self.speed = value;

		if (fallbackAudio) fallbackAudio.playbackRate = self.speed;

		switch (self.mode) {
			case 'native':
				if (video) video.playbackRate = self.speed;
				break;

			case 'fallback':
				if (self.isPlaying) startRawFrameStream();
				break;
		}
	}

	function reload() {
		switch (self.mode) {
			case 'native':
				if (video) {
					video.load();
				}
				break;
		}
	}

	function play() {
		if (self.isPlaying) return;

		switch (self.mode) {
			case 'native':
				if (video) {
					video.currentTime = self.currentTime / 1000;
					video.play();
				}
				if (fallbackAudio) {
					fallbackAudio.currentTime = self.currentTime / 1000;
					fallbackAudio.play();
				}
				self.onAlive?.();
				break;

			case 'fallback':
				if (self.meta.duration - self.currentTime < 1) self.currentTime = 0;
				startRawFrameStream();
				break;
		}

		setValue('isPlaying', true);
	}

	function playFrom(timeMs: number) {
		if (self.isPlaying) {
			self.seekTo(timeMs);
		} else {
			self.currentTime = normalizeTime(timeMs);
			if (self.mode === 'native' && video) video.currentTime = timeMs / 1000;
			self.play();
		}
	}

	function pause() {
		if (!self.isPlaying) return;

		setValue('isPlaying', false);

		switch (self.mode) {
			case 'native':
				if (video) {
					video.pause();
					self.onTimeUpdate?.(video.currentTime * 1000);
				}
				if (fallbackAudio) fallbackAudio.pause();
				break;

			case 'fallback': {
				frameStreamDisposer?.();
				renderFullFrameToCanvas();
				break;
			}
		}
	}

	function seekTo(timeMs: number) {
		self.currentTime = normalizeTime(timeMs);

		switch (self.mode) {
			case 'native':
				if (video) video.currentTime = timeMs / 1000;
				if (fallbackAudio) fallbackAudio.currentTime = timeMs / 1000;
				if (self.isPlaying) self.onTimeUpdate?.(timeMs);
				self.onAlive?.();
				break;

			case 'fallback': {
				if (self.isPlaying) {
					startRawFrameStream();
				} else {
					self.onAlive?.();
					renderFullFrameToCanvas();
				}
				self.onTimeUpdate?.(timeMs);
				break;
			}
		}
	}

	function clearCanvas() {
		if (self.mode === 'fallback') canvas?.getContext('2d')?.clearRect(0, 0, canvas.width, canvas.height);
	}

	const renderFullFrameToCanvas = promiseThrottle(async () => {
		if (meta.type !== 'video' || !canvas || self.isPlaying || currentFullFrameTime === self.currentTime) return;

		try {
			const imageData = await getOneRawFrame({
				ffmpegPath,
				meta,
				seekTo: clamp(0, self.currentTime, meta.duration),
			});
			// Drop the frame if user started playback while we were fetching it
			if (!self.isPlaying) {
				drawImageToCanvas(canvas, imageData);
				currentFullFrameTime = self.currentTime;
			}
		} catch (error) {
			handleFallbackError('full frame rendering', error);
		}
	}, 'queue');

	function startRawFrameStream() {
		frameStreamDisposer?.();

		if (meta.type === 'audio') {
			if (fallbackAudio) {
				fallbackAudio.currentTime = self.currentTime / 1000;
				fallbackAudio.play();
			}
			return;
		}

		// We use this awkward requestAnimationFrame loop since it's the only API
		// providing accurate timings. Date.now(), timeouts, or intervals can
		// round from 2ms to 100ms or more...
		let firstFrameTime: number | null = null;
		let firstFrameArrived = false;
		const startTime = self.currentTime;
		let timeupdateLoop = (time: number) => {
			timeupdateAnimationFrameId = requestAnimationFrame(timeupdateLoop);
			if (!firstFrameArrived) return;
			if (firstFrameTime == null) firstFrameTime = time;

			const timeDelta = (time - firstFrameTime) * self.speed;

			self.currentTime = round((startTime + timeDelta) / frameTime) * frameTime;

			if (self.currentTime >= meta.duration) {
				// Stream end
				self.currentTime = meta.duration;
				stopTimeupdateLoop();
				frameStreamDisposer?.();
				requestTimeUpdate.cancel();
				self.onTimeUpdate?.(self.currentTime);
				setValue('isPlaying', false);
				self.onEnded?.();
				renderFullFrameToCanvas();
			} else {
				requestTimeUpdate();
			}

			// If fallbackAudio was loaded after playback started, lets pick up
			if (fallbackAudio && fallbackAudio.paused) {
				fallbackAudio.currentTime = self.currentTime / 1000;
				fallbackAudio.play();
			}
		};
		let timeupdateAnimationFrameId = requestAnimationFrame(timeupdateLoop);
		let stopTimeupdateLoop = () => cancelAnimationFrame(timeupdateAnimationFrameId);

		let killStream = makeFrameStream({
			ffmpegPath,
			meta,
			seekTo: self.currentTime,
			outputSize: 360,
			speed: self.speed,
			onFrame: (image) => {
				if (!firstFrameArrived) {
					firstFrameArrived = true;

					if (fallbackAudio) {
						fallbackAudio.currentTime = self.currentTime / 1000;
						fallbackAudio.play();
					}
				}

				if (canvas) {
					drawImageToCanvas(canvas, image);
					self.onAlive?.();
					currentFullFrameTime = null;
				}
			},
			onEnd: () => {
				// Frame stream end doesn't mean file ended, since video tracks might be
				// shorter than audio tracks. So we just ignore this event, and trigger
				// the end manually with timers.
			},
			onError: (error) => {
				stopTimeupdateLoop();
				setValue('isPlaying', false);
				handleFallbackError('playback', error);
			},
		});

		frameStreamDisposer = () => {
			if (fallbackAudio) fallbackAudio.pause();
			stopTimeupdateLoop();
			killStream?.();
			frameStreamDisposer = null;
		};
	}

	function handleFallbackError(namespace: string, error: any) {
		openDialog({
			modal: true,
			title: `Fallback ${namespace} error`,
			content: (
				<DialogErrorContent
					message={`Media can't be played natively, so we used a fallback canvas player which itself experienced following
				error during ${namespace}:`}
					error={error}
				/>
			),
		});
	}

	async function _cropDetect(options: Parameters<typeof cropDetect>[1]) {
		if (meta.type === 'video') {
			try {
				const imageData = await getOneRawFrame({ffmpegPath, meta, seekTo: self.currentTime});
				const crop = cropDetect(imageData, options);

				// Adjust for different sars
				const widthDifferenceRatio = meta.displayWidth / crop.sourceWidth;
				const heightDifferenceRatio = meta.displayHeight / crop.sourceHeight;

				if (widthDifferenceRatio !== 1) {
					crop.x = round(crop.x * widthDifferenceRatio);
					crop.width = min(meta.displayWidth - crop.x, round(crop.width * widthDifferenceRatio));
					crop.sourceWidth = meta.displayWidth;
				}

				if (heightDifferenceRatio !== 1) {
					crop.y = round(crop.y * heightDifferenceRatio);
					crop.height = min(meta.displayHeight - crop.y, round(crop.height * heightDifferenceRatio));
					crop.sourceHeight = meta.displayHeight;
				}

				return crop;
			} catch (error) {
				openDialog({
					title: `Crop detect error`,
					modal: true,
					align: 'top',
					content: <DialogErrorContent message={`Couldn't detect crop region`} error={eem(error)} />,
				});
			}
		}
	}

	function Component({
		hidden,
		volume = 0.5,
		style: passedStyle,
	}: {
		hidden?: boolean;
		volume?: number;
		style?: string;
	}) {
		const [, setReload] = useState(NaN);
		const videoRef = useRef<HTMLVideoElement>(null);
		const canvasRef = useRef<HTMLCanvasElement>(null);
		const audioRef = useRef<HTMLAudioElement>(null);
		const [videoSrc, setVideoSrc] = useState(srcSafePath);
		const [fallbackAudioPath, setFallbackAudioPath] = useState<string | undefined>(undefined);

		useEffect(() => {
			loading.then(() => setReload(NaN));
		}, []);

		useEffect(() => {
			video = videoRef.current;
			canvas = canvasRef.current;
			const audio = audioRef.current;

			const loadFallbackAudio = () => {
				if (!audio) throw new Error(`Can't load fallback audio, audio element not rendered.`);
				setValue('isLoadingAudio', true);
				encodeFallbackAudio(meta.path, {ffmpegPath})
					.then((path) => {
						// For video, we give fallback player audio element to control
						if (meta.type === 'video') {
							setFallbackAudioPath(path);
							fallbackAudio = audio;
							fallbackAudio.playbackRate = self.speed;
						}

						// For audio, we just replace video src with fallback
						// audio and pretend it's native
						if (meta.type === 'audio') {
							setVideoSrc(path);
							setValue('mode', path ? 'native' : 'unsupported');
						}
					})
					.finally(() => {
						setValue('isLoadingAudio', false);
					});
			};

			if (self.mode === 'fallback') {
				renderFullFrameToCanvas();

				// Load fallback audio
				if (audio && (meta.type === 'audio' || meta.audioStreams.length > 0)) {
					loadFallbackAudio();
				}
			} else {
				if (nativeVideoPlayerNeedsFallbackAudio) loadFallbackAudio();

				// When user requested payback while media was loading, pick it up
				if (video && self.isPlaying && video.paused) {
					const localVideo = video;
					const play = () => {
						self.isPlaying = false;
						self.play();
					};
					if (localVideo.readyState > 0) {
						play();
					} else {
						localVideo.addEventListener('canplay', play, {once: true});
						new Promise((resolve) => setTimeout(resolve, 1000)).then(() => {
							localVideo.removeEventListener('canplay', play);
						});
					}
				}
			}

			// Create audio interface
			if (isAudio && video) {
				if (audioInterface) {
					audioInterface.source.disconnect();
					audioInterface.audioCtx.close();
				}

				const audioCtx = new AudioContext();
				const analyser = audioCtx.createAnalyser();
				const source = audioCtx.createMediaElementSource(video);
				source.connect(analyser);
				source.connect(audioCtx.destination);

				analyser.fftSize = 2048;
				const timeData = new Uint8Array(analyser.frequencyBinCount);
				const frequencyData = new Uint8Array(analyser.frequencyBinCount);
				audioInterface = {
					audioCtx,
					analyser,
					source,
					timeData,
					frequencyData,
				};
			} else {
				audioInterface = null;
			}
		}, [self.mode]);

		function updateTime(timeMs: number) {
			self.currentTime = timeMs;
			self.onTimeUpdate?.(self.currentTime);
		}

		let styles: string[] = [];
		if (!isAudio) styles.push(`aspect-ratio:${displayWidth}/${displayHeight}`);
		if (hidden) styles.push('display:none');
		if (passedStyle) styles.push(passedStyle);
		let style = styles.join(';');

		const children: VNode[] = [];

		switch (self.mode) {
			case 'native':
				children.push(
					<video
						ref={videoRef}
						class="MediaPlayer"
						src={videoSrc}
						onEnded={() => {
							setValue('isPlaying', false);
							self.onEnded?.();
						}}
						volume={nativeVideoPlayerNeedsFallbackAudio ? 0 : volume}
						width={displayWidth}
						height={displayHeight}
						onTimeUpdate={(event) => updateTime(event.currentTarget.currentTime * 1000)}
					/>
				);
				if (nativeVideoPlayerNeedsFallbackAudio) {
					children.push(
						<audio ref={audioRef} class="fallbackAudio" src={fallbackAudioPath} volume={volume} />
					);
				}
				break;

			case 'fallback':
				children.push(
					<canvas ref={canvasRef} class="MediaPlayer" />,
					<audio ref={audioRef} class="fallbackAudio" src={fallbackAudioPath} volume={volume} />
				);
				break;

			default:
				children.push(self.mode === 'loading' ? <Spinner /> : <Vacant>Playback not supported.</Vacant>);
		}

		return (
			<div class="MediaPlayer" style={style}>
				{children}
			</div>
		);
	}

	function getByteFrequencyData() {
		if (audioInterface) {
			audioInterface.analyser.getByteFrequencyData(audioInterface.frequencyData);
			return audioInterface.frequencyData;
		}
	}

	function getByteTimeDomainData() {
		if (audioInterface) {
			audioInterface.analyser.getByteTimeDomainData(audioInterface.timeData);
			return audioInterface.timeData;
		}
	}

	async function loadWaveform({
		width,
		height,
		colors = 'ffffff',
	}: {width?: number; height?: number; colors?: string} = {}) {
		if (meta.type === 'video' && meta.audioStreams.length === 0) return;

		setValue('isLoadingWaveform', true);

		try {
			const defaultWidth = window.screen.availWidth * 2;
			self.waveform = await getWaveform({
				ffmpegPath,
				path: meta.path,
				width: width ?? defaultWidth,
				height: height ?? round((defaultWidth * 0.18) / 2) * 2,
				colors,
			});
		} catch (error) {
			self.waveform = undefined;
			throw error;
		} finally {
			setValue('isLoadingWaveform', false);
		}
	}

	// If duration is shorter than 30 minutes, load waveform by default
	if (meta.duration < 60_000 * 30) {
		// Don't cause unnecessary initial updates
		const originalOnPropUpdate = self.onPropUpdate;
		self.onPropUpdate = null;
		loadWaveform();
		self.onPropUpdate = originalOnPropUpdate;
	}

	return self;
}
