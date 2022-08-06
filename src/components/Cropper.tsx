import {h} from 'preact';
import {useRef, Ref, useEffect} from 'preact/hooks';
import {isCropValid, sanitizeCrop} from 'lib/utils';

export interface CropperOptions {
	width: number;
	height: number;
	style?: string | Record<string, string>;
	crop?: Region;
	/** Fired every time crop changes. */
	onChange: (crop?: Region) => void;
	/** Fired when current cropping session is over (mouse up event). */
	onCrop?: (crop?: Region) => void;
	enableCursorCropping?: boolean;
	allowCropMove?: boolean;
	rounding?: number;
	minSize?: number;
	cropInitContainerRef?: Ref<HTMLDivElement | null>;
}

export function Cropper({
	width,
	height,
	style,
	crop,
	onChange,
	onCrop,
	enableCursorCropping,
	allowCropMove = true,
	rounding = 1,
	minSize = 2,
	cropInitContainerRef,
}: CropperOptions) {
	const passedCrop = crop;
	const containerRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		const initiator = cropInitContainerRef?.current ?? containerRef.current;
		if (initiator && enableCursorCropping) {
			initiator.style.cursor = 'crosshair';
			initiator.addEventListener('mousedown', initCrop);

			return () => {
				initiator.style.cursor = '';
				initiator.removeEventListener('mousedown', initCrop);
			};
		}
	}, [enableCursorCropping]);

	function normalizeCrop(crop: Region) {
		return !isCropValid(crop) || (crop.width < minSize && crop.height < minSize) ? undefined : crop;
	}

	function initCrop(event: MouseEvent) {
		const container = containerRef.current;
		if (!enableCursorCropping || !container || event.button !== 0) return;
		const rect = container.getBoundingClientRect();
		const x = event.x - rect.left;
		const y = event.y - rect.top;
		const crop: Region = {
			x: Math.round((x / rect.width) * width),
			y: Math.round((y / rect.height) * height),
			width: 1,
			height: 1,
			sourceWidth: width,
			sourceHeight: height,
		};
		initResize(event, 'bottom-right', crop);
		onChange(normalizeCrop(crop));
	}

	function initResize(
		event: MouseEvent,
		handle:
			| 'left'
			| 'top'
			| 'right'
			| 'bottom'
			| 'top-left'
			| 'top-right'
			| 'bottom-left'
			| 'bottom-right'
			| 'center',
		initCrop: Region | undefined = passedCrop
	) {
		const container = containerRef.current;
		if (!container || !initCrop || event.button !== 0) return;
		event.preventDefault();
		event.stopPropagation();
		const rect = container.getBoundingClientRect();
		const widthRatio = width / rect.width;
		const heightRatio = height / rect.height;
		const initX = event.x;
		const initY = event.y;
		const {x: initCropAX, y: initCropAY, width: initCropWidth, height: initCropHeight} = initCrop;
		const initCropBX = initCropAX + initCropWidth;
		const initCropBY = initCropAY + initCropHeight;
		const isCenter = handle === 'center';
		const resizeHorizontal = handle.includes('left') ? 'left' : handle.includes('right') ? 'right' : false;
		const resizeVertical = handle.includes('top') ? 'top' : handle.includes('bottom') ? 'bottom' : false;
		const initDocumentCursor = document.documentElement.style.cursor;
		let lastCrop: Region | undefined;

		// Raw point on canvas opposite to the dragged handle
		const anchorX = resizeHorizontal ? (resizeHorizontal === 'left' ? initCropBX : initCropAX) / widthRatio : false;
		const anchorY = resizeVertical ? (resizeVertical === 'top' ? initCropBY : initCropAY) / heightRatio : false;

		// Sets document styles cursor relevant to the currently dragged corner
		const updateCursor = (event: MouseEvent) => {
			const cursorX = event.x - rect.left;
			const cursorY = event.y - rect.top;
			let cursor = '';

			if (anchorX === false && anchorY === false) {
				cursor = 'move';
			} else {
				if (anchorX === false) {
					cursor = 'ns';
				} else if (anchorY === false) {
					cursor = 'ew';
				} else {
					const northSide =
						cursorY < anchorY ? (cursorX < anchorX ? 'w' : 'e') : cursorX < anchorX ? 'e' : 'w';
					cursor = `n${northSide}s${northSide === 'e' ? 'w' : 'e'}`;
				}

				cursor += '-resize';
			}

			document.documentElement.style.cursor = cursor;
		};

		container.classList.add('-dragging');
		updateCursor(event);

		const handleMove = (event: MouseEvent) => {
			const deltaX = (event.x - initX) * widthRatio;
			const deltaY = (event.y - initY) * heightRatio;
			const newCrop: Region = {...initCrop};

			if (isCenter) {
				newCrop.x = initCropAX + deltaX;
				newCrop.y = initCropAY + deltaY;
			}

			switch (resizeHorizontal) {
				case 'left': {
					const newAX = initCropAX + deltaX;
					if (newAX > initCropBX) {
						newCrop.x = initCropBX;
						newCrop.width = newAX - initCropBX;
					} else {
						newCrop.x = newAX;
						newCrop.width = initCropBX - newAX;
					}
					break;
				}

				case 'right': {
					const newBX = initCropBX + deltaX;
					if (newBX < initCropAX) {
						newCrop.x = newBX;
						newCrop.width = initCropAX - newBX;
					} else {
						newCrop.width = newBX - initCropAX;
					}
					break;
				}
			}

			switch (resizeVertical) {
				case 'top': {
					const newAY = initCropAY + deltaY;
					if (newAY > initCropBY) {
						newCrop.y = initCropBY;
						newCrop.height = newAY - initCropBY;
					} else {
						newCrop.y = newAY;
						newCrop.height = initCropBY - newAY;
					}
					break;
				}

				case 'bottom': {
					const newBY = initCropBY + deltaY;
					if (newBY < initCropAY) {
						newCrop.y = newBY;
						newCrop.height = initCropAY - newBY;
					} else {
						newCrop.height = newBY - initCropAY;
					}
					break;
				}
			}

			sanitizeCrop(newCrop, {roundBy: rounding, mode: isCenter ? 'move' : 'crop', minSize});
			lastCrop = normalizeCrop(newCrop);
			updateCursor(event);
			onChange(lastCrop);
		};

		const handleUp = (event: MouseEvent) => {
			removeEventListener('mousemove', handleMove);
			removeEventListener('mouseup', handleUp);
			document.documentElement.style.cursor = initDocumentCursor;
			container.classList.remove('-dragging');
			onCrop?.(lastCrop);
		};

		addEventListener('mousemove', handleMove);
		addEventListener('mouseup', handleUp);
	}

	// Percentage values
	let aXP = 0;
	let aYP = 0;
	let widthP = 0;
	let heightP = 0;
	let bXP = 0;
	let bYP = 0;
	let cropCssProps: Record<string, string> | null = null;

	if (crop) {
		aXP = (crop.x / width) * 100;
		aYP = (crop.y / height) * 100;
		widthP = (crop.width / width) * 100;
		heightP = (crop.height / height) * 100;
		bXP = aXP + widthP;
		bYP = aYP + heightP;
		cropCssProps = {left: `${aXP}%`, top: `${aYP}%`, width: `${widthP}%`, height: `${heightP}%`};
	}

	let classNames = 'Cropper';
	if (enableCursorCropping) classNames += ' -cropping';

	return (
		<div ref={containerRef} class={classNames} style={style}>
			{(enableCursorCropping || crop) && (
				<svg class="shade" viewBox="0 0 100 100" preserveAspectRatio="none">
					<path
						d={`M 0 0 L 0 100 L 100 100 L 100 0 z M ${aXP} ${aYP} L ${aXP} ${bYP} L ${bXP} ${bYP} L ${bXP} ${aYP} z`}
						fill="currentColor"
						fill-rule="evenodd"
					/>
				</svg>
			)}
			{cropCssProps && crop && (
				<div
					class={`crop${allowCropMove ? ' -movable' : ''}`}
					style={cropCssProps}
					onMouseDown={allowCropMove ? (event) => initResize(event, 'center') : undefined}
				>
					<div class="top" onMouseDown={(event) => initResize(event, 'top')} />
					<div class="right" onMouseDown={(event) => initResize(event, 'right')} />
					<div class="bottom" onMouseDown={(event) => initResize(event, 'bottom')} />
					<div class="left" onMouseDown={(event) => initResize(event, 'left')} />
					<div class="top-left" onMouseDown={(event) => initResize(event, 'top-left')} />
					<div class="top-right" onMouseDown={(event) => initResize(event, 'top-right')} />
					<div class="bottom-left" onMouseDown={(event) => initResize(event, 'bottom-left')} />
					<div class="bottom-right" onMouseDown={(event) => initResize(event, 'bottom-right')} />
				</div>
			)}
		</div>
	);
}
