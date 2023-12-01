import {openContextMenu} from '@drovp/utils/modal-window';
import {MenuItemConstructorOptions} from '@drovp/types';
import {h, RenderableProps} from 'preact';
import {useState, useMemo, useLayoutEffect, useRef} from 'preact/hooks';
import {useElementSize} from 'lib/hooks';
import {Cropper} from 'components/Cropper';
import {Icon, Help} from 'components/Icon';
import {clamp, indexOfClosestTo, rotateCrop, flipCropHorizontal, flipCropVertical} from 'lib/utils';
import {useShortcuts} from 'lib/hooks';
import * as shortcuts from 'config/shortcuts';

const {min, max, round} = Math;

export type PreviewProps = RenderableProps<{
	width: number;
	height: number;
	rotate: Rotation;
	flipVertical: boolean;
	flipHorizontal: boolean;
	crop: Region | undefined;
	cropRounding?: number;
	enableCursorCropping?: boolean;
	background?: string;
	/** Fired every time crop changes. */
	onCropChange: (crop: Region | undefined) => void;
	/** Fired when user requests current crop to be canceled (removed) by parent component. */
	onCropCancel: () => void;
	/** Fired when cursor cropping should be disabled/stopped/canceled (Escape pressed when it's enabled). */
	onCancelCropping?: () => void;
	onUseLastCrop?: () => void;
	/**
	 * Fired when user requests crop detection via context menu. Doesn't
	 * actually crop detect, that should be handled by parent component.
	 */
	onCropDetect?: () => void;
}>;

export function Preview({
	children,
	width,
	height,
	rotate: rotate,
	flipHorizontal,
	flipVertical,
	crop,
	cropRounding = 1,
	enableCursorCropping,
	background,
	onCropChange,
	onCancelCropping,
	onUseLastCrop,
	onCropDetect,
	onCropCancel,
}: PreviewProps) {
	const containerRef = useRef<HTMLDivElement>(null);
	const viewRef = useRef<HTMLDivElement>(null);
	const isTilted = rotate === 90 || rotate === 270;
	const containerSize = useElementSize(containerRef);
	const containerWidth = containerSize[0] ?? 100;
	const containerHeight = containerSize[1] ?? 100;
	const [zoom, setZoom] = useState(1);
	const [isCropMode, setIsCropMode] = useState(false);
	const [mouseAlwaysPans, setMouseAlwaysPans] = useState(false);
	const croppingEnabled = isCropMode || enableCursorCropping;

	const tiltedWidth = isTilted ? height : width;
	const tiltedHeight = isTilted ? width : height;
	const effectiveWidth = round(width * zoom);
	const effectiveHeight = round(height * zoom);
	const viewWidth = isTilted ? effectiveHeight : effectiveWidth;
	const viewHeight = isTilted ? effectiveWidth : effectiveHeight;
	const isViewWider = tiltedWidth / tiltedHeight > containerWidth / containerHeight;
	const fitZoom = isViewWider ? containerWidth / tiltedWidth : containerHeight / tiltedHeight;

	const [isPanning, setIsPanning] = useState(false);
	const [[panX, panY], setPan] = useState<[number, number]>([0, 0]);
	const panXMax = zoom <= fitZoom ? 0 : max(0, round(viewWidth / 2 - containerWidth / 2 + 100));
	const panYMax = zoom <= fitZoom ? 0 : max(0, round(viewHeight / 2 - containerHeight / 2 + 100));
	const effectivePanX = clamp(-panXMax, panX, panXMax);
	const effectivePanY = clamp(-panYMax, panY, panYMax);
	const panningDisabled = panXMax === 0 && panYMax === 0;

	// Rotation and flips aware meta & crop rectangle
	const awareCrop = useMemo(() => {
		if (crop) {
			if (rotate) crop = rotateCrop(crop, rotate);
			if (flipVertical) crop = flipCropVertical(crop);
			if (flipHorizontal) crop = flipCropHorizontal(crop);
		}
		return crop;
	}, [crop, rotate, flipVertical, flipHorizontal]);

	// Undoes rotate & flips from aware crop
	function handleCropChange(newCrop: Region | undefined) {
		if (newCrop) {
			if (flipHorizontal) newCrop = flipCropHorizontal(newCrop);
			if (flipVertical) newCrop = flipCropVertical(newCrop);
			if (rotate) newCrop = rotateCrop(newCrop, -rotate);
		}
		// We don't want to send changes when crop and newCrop are both undefined.
		// Might trigger unnecessary cleanup logic upstream.
		if (crop !== newCrop) onCropChange(newCrop);
	}

	function zoomToFit() {
		setZoom(fitZoom);
		setPan([0, 0]);
	}

	function startCrop() {
		onCropChange?.(undefined);
		setIsCropMode(true);
	}

	function handleContextMenu(event: MouseEvent) {
		event.preventDefault();
		const items: MenuItemConstructorOptions[] = [];

		// Cropping
		items.push(
			crop
				? {label: 'Cancel crop', click: onCropCancel}
				: {label: 'Crop', accelerator: shortcuts.crop, click: startCrop}
		);
		if (onUseLastCrop) {
			items.push({label: 'Use last crop', accelerator: shortcuts.useLastCrop, click: onUseLastCrop});
		}
		if (onCropDetect) items.push({label: 'Crop detect', accelerator: shortcuts.cropDetect, click: onCropDetect});

		// Zoom
		items.push(
			{type: 'separator'},
			{label: 'Zoom to 100%', enabled: zoom !== 1, accelerator: 'CommandOrControl+1', click: () => setZoom(1)},
			{
				label: 'Zoom to fit',
				enabled: zoom !== fitZoom || panX !== 0 || panY !== 0,
				accelerator: 'CommandOrControl+0',
				click: zoomToFit,
			},
			{
				label: 'Center view',
				enabled: panX !== 0 && panY !== 0,
				accelerator: shortcuts.centerView,
				click: () => setPan([0, 0]),
			}
		);

		openContextMenu(items);
	}

	function initPanning(event: MouseEvent) {
		// Middle mouse button resets view
		if (event.button === 1) {
			setZoom(min(1, fitZoom));
			setPan([0, 0]);
		}

		if (event.button !== 0) return;

		setIsPanning(true);

		const handleMove = (event: MouseEvent) => {
			setPan(([panX, panY]) => {
				return [
					clamp(-panXMax, panX + event.movementX, panXMax),
					clamp(-panYMax, panY + event.movementY, panYMax),
				];
			});
		};

		const stop = () => {
			removeEventListener('mousemove', handleMove);
			removeEventListener('mouseup', stop);
			setIsPanning(false);
		};

		addEventListener('mousemove', handleMove);
		addEventListener('mouseup', stop);
	}

	function handleWheel(event: WheelEvent) {
		const view = viewRef.current!;
		const container = containerRef.current!;
		const containerRect = container.getBoundingClientRect();
		const viewRect = view.getBoundingClientRect();
		const newZoom = stepZoom(event.deltaY < 0 ? 1 : -1);

		// Pan to cursor
		const x = ((event.x - viewRect.left) / viewRect.width) * tiltedWidth;
		const y = ((event.y - viewRect.top) / viewRect.height) * tiltedHeight;
		const xPan = tiltedWidth / 2 - x;
		const yPan = tiltedHeight / 2 - y;
		const targetPanX = (containerRect.width / 2 - event.x - containerRect.left) * -1;
		const targetPanY = (containerRect.height / 2 - event.y - containerRect.top) * -1;
		const newPanX = xPan * newZoom + targetPanX;
		const newPanY = yPan * newZoom + targetPanY;

		setPan([round(newPanX), round(newPanY)]);
	}

	function stepZoom(delta: number) {
		const container = containerRef.current!;
		const containerRect = container.getBoundingClientRect();
		const isZoomingIn = delta < 0;

		// Create an array of possible zoom steps
		let minZoom = min(1, 50 / (isViewWider ? tiltedWidth : tiltedHeight));
		let maxZoom = (isViewWider ? containerRect.width : containerRect.height) / 20;
		const staticSteps = [minZoom, fitZoom, 0.5, 1, 2, 3, 4, 5, maxZoom];
		let steps: number[] = [];
		let step = minZoom;

		while (step < maxZoom) {
			step *= 1.2;
			steps.push(step);
		}

		// Remove steps too close to static steps
		for (const staticStep of staticSteps) {
			const closestIndex = indexOfClosestTo(steps, staticStep);
			if (closestIndex > -1) steps.splice(closestIndex, 1);
		}

		// Combine, sort, and find new zoom
		steps = [...steps, ...staticSteps].sort((a, b) => a - b);
		const currentStepIndex = indexOfClosestTo(steps, zoom);
		const newZoom = clamp(minZoom, steps[currentStepIndex + delta] ?? (isZoomingIn ? Infinity : 0), maxZoom);

		setZoom(newZoom);

		return newZoom;
	}

	function cancelCropping() {
		setIsCropMode(false);
		onCancelCropping?.();
	}

	useLayoutEffect(() => {
		// Determine initial zoom so that it fits the window, but only for views
		// that are bigger than preview window.
		const container = containerRef.current!;
		const containerWidth = container.clientWidth;
		const containerHeight = container.clientHeight;
		const isImageWider = width / height > containerWidth / containerHeight;
		const fitZoom = isImageWider ? containerWidth / width : containerHeight / height;
		setZoom(min(1, fitZoom));
	}, []);

	useShortcuts((id, event) => {
		if (event.repeat) return;

		switch (id) {
			case shortcuts.zoomIn:
				stepZoom(1);
				break;
			case shortcuts.zoomOut:
				stepZoom(-1);
				break;
			case shortcuts.zoomTo100p:
				setZoom(1);
				break;
			case shortcuts.zoomToFit:
				setZoom(fitZoom);
				setPan([0, 0]);
				break;
			case shortcuts.centerView:
				setPan([0, 0]);
				break;
			case shortcuts.holdToPan:
				setMouseAlwaysPans(true);
				addEventListener('keyup', () => setMouseAlwaysPans(false), {once: true});
				break;
			case shortcuts.crop:
				startCrop();
				break;
			case shortcuts.useLastCrop:
				onUseLastCrop?.();
				break;
			case shortcuts.cropDetect:
				onCropDetect?.();
				break;
			default:
				return false;
		}

		return true;
	});

	const viewStyle: Record<string, string> = {
		width: `${effectiveWidth}px`,
		height: `${effectiveHeight}px`,
		transform: '',
		left: `${round(containerWidth / 2 - effectiveWidth / 2 + effectivePanX)}px`,
		top: `${round(containerHeight / 2 - effectiveHeight / 2 + effectivePanY)}px`,
	};

	if (background) viewStyle.background = background;
	if (flipHorizontal) viewStyle.transform += `scaleX(-1)`;
	if (flipVertical) viewStyle.transform += `scaleY(-1)`;
	if (rotate) viewStyle.transform += `rotate(${rotate}deg)`;

	const cropperArea = {
		x: round(containerWidth / 2 - viewWidth / 2 + effectivePanX),
		y: round(containerHeight / 2 - viewHeight / 2 + effectivePanY),
		width: viewWidth,
		height: viewHeight,
	};

	return (
		<div
			ref={containerRef}
			class="Preview"
			onContextMenu={handleContextMenu}
			onWheel={handleWheel}
			onMouseDown={!croppingEnabled ? initPanning : undefined}
			style={`cursor:${!panningDisabled || isPanning ? `${isPanning ? 'grabbing' : 'grab'}` : 'inherit'}`}
		>
			<div ref={viewRef} class="view" style={viewStyle}>
				{children}
			</div>
			<Cropper
				width={tiltedWidth}
				height={tiltedHeight}
				area={cropperArea}
				crop={awareCrop}
				rounding={cropRounding}
				onChange={handleCropChange}
				onCrop={() => setIsCropMode(false)}
				enableCursorCropping={croppingEnabled}
				onCancelCropping={cancelCropping}
				allowCropMove={!mouseAlwaysPans || isCropMode}
			/>
			<div class="controls">
				<button
					class={`zoom${zoom === 1 ? ' -active' : ''}`}
					onClick={() => setZoom(1)}
					title="Current zoom. Click for 100%."
				>
					<strong>{round(zoom * 100)}</strong>%
				</button>
				<button class={zoom === fitZoom ? '-active' : ''} onClick={zoomToFit} title="Zoom to fit">
					<Icon name="square-corners" />
				</button>
			</div>
			<Help
				title={`Preview controls:
Middle mouse button to reset view
Hold ${shortcuts.holdToPan} to pan instead of moving cut region
${shortcuts.zoomIn}: zoom in
${shortcuts.zoomOut}: zoom out
${shortcuts.zoomToFit}: zoom to fit
${shortcuts.zoomTo100p}: zoom to 100%
${shortcuts.crop}: crop with cursor`}
			/>
		</div>
	);
}
