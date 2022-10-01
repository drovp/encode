import * as Path from 'path';
import {h, RenderableProps, VNode} from 'preact';
import {useState, useMemo, useRef, useEffect} from 'preact/hooks';
import {Payload} from '../';
import {
	uid,
	clamp,
	idKey,
	msToIsoTime,
	msToHumanTime,
	isIsoTime,
	isoTimeToMS,
	isCropValid,
	countCutsDuration,
} from 'lib/utils';
import {SetOptional} from 'type-fest';
import {useForceUpdate} from 'lib/hooks';
import {ResizeOptions, makePixelsHint, Fit} from 'lib/dimensions';
import * as shortcuts from 'config/shortcuts';
import {Button} from 'components/Button';
import {Input} from 'components/Input';
import {Slider} from 'components/Slider';
import {Checkbox} from 'components/Checkbox';
import {Dropdown} from 'components/Dropdown';
import {Scrollable} from 'components/Scrollable';
import {Spinner} from 'components/Spinner';
import {Icon, Help} from 'components/Icon';

export type ControlsProps = RenderableProps<{
	submittable?: boolean;
	onSubmit: () => void;
	onCancel: () => void;
}>;

export function Controls({children, submittable = true, onSubmit, onCancel}: ControlsProps) {
	useEffect(() => {
		function handleKeyDown(event: KeyboardEvent) {
			const keyId = idKey(event);

			switch (keyId) {
				// Cancel
				case shortcuts.cancel:
					onCancel();
					break;

				// Submit
				case shortcuts.submit:
					onSubmit();
					break;
			}
		}

		addEventListener('keydown', handleKeyDown);

		return () => {
			removeEventListener('keydown', handleKeyDown);
		};
	}, []);

	return (
		<div class="Controls">
			<header>
				<Button
					class="submit"
					variant="success"
					disabled={!submittable}
					onClick={onSubmit}
					tooltip={`Submit edits and encode (${shortcuts.submit})`}
				>
					Encode
				</Button>
				<Button
					class="cancel"
					variant="danger"
					semitransparent
					onClick={onCancel}
					tooltip={`Cancel operation (${shortcuts.cancel})`}
				>
					Cancel
				</Button>
			</header>
			<Scrollable>{children}</Scrollable>
		</div>
	);
}

export type ControlBoxProps = RenderableProps<{
	class?: string;
	title?: string;
	titleButton?: VNode;
	variant?: Variant;
	disabled?: boolean;
	onCancel?: () => void;
}>;

export function ControlBox({
	children,
	class: className,
	title,
	variant = 'primary',
	titleButton,
	disabled,
	onCancel,
}: ControlBoxProps) {
	let classNames = 'ControlBox';
	if (variant) classNames += ` -${variant}`;
	if (disabled) classNames += ' -disabled';
	if (className) classNames += ` ${className}`;

	return (
		<div class={classNames}>
			{(title != null || onCancel != null) && (
				<header>
					<h1>{title}</h1>
					{titleButton}
					{onCancel && (
						<Button variant="danger" muted class="cancel" onClick={onCancel}>
							Cancel
						</Button>
					)}
				</header>
			)}
			{children}
		</div>
	);
}

export type LoadingBoxProps = RenderableProps<{}>;

export function LoadingBox({children}: LoadingBoxProps) {
	return (
		<ControlBox class="LoadingBox">
			<Spinner />
			{children && <div class="message">{children}</div>}
		</ControlBox>
	);
}

export function RotateFlipControl({
	rotation,
	flipHorizontal,
	flipVertical,
	onRotationChange,
	onHorizontalChange,
	onVerticalChange,
}: {
	rotation: Rotation;
	flipHorizontal: boolean;
	flipVertical: boolean;
	onRotationChange: (rotation: Rotation) => void;
	onHorizontalChange: (value: boolean) => void;
	onVerticalChange: (value: boolean) => void;
}) {
	const isRotated = rotation > 0;
	const isActive = isRotated || flipHorizontal || flipVertical;

	function rotate(direction: 1 | -1) {
		const options: Rotation[] = [0, 90, 180, 270];
		const currentIndex = options.indexOf(rotation);
		if (currentIndex === -1) {
			onRotationChange(direction > 0 ? 90 : 270);
		} else {
			let newIndex = currentIndex + direction;
			if (newIndex >= options.length) newIndex = 0;
			else if (newIndex < 0) newIndex = options.length - 1;
			onRotationChange(options[newIndex]!);
		}
	}

	function cancel() {
		onRotationChange(0);
		onHorizontalChange(false);
		onVerticalChange(false);
	}

	return (
		<ControlBox
			title={`Rotate / Flip`}
			variant={isActive ? 'success' : undefined}
			onCancel={isActive ? cancel : undefined}
		>
			<div class="RotateFlipControl">
				<Button
					variant={isRotated ? 'success' : 'primary'}
					onClick={() => rotate(-1)}
					tooltip="Rotate counterclockwise"
				>
					<Icon name="rotate-left" />
				</Button>
				<span class="degrees">{rotation}°</span>
				<Button
					variant={isRotated ? 'success' : 'primary'}
					onClick={() => rotate(1)}
					tooltip="Rotate clockwise"
				>
					<Icon name="rotate-right" />
				</Button>
				<div class="spacer" />
				<Button
					class="flip"
					variant={flipHorizontal ? 'success' : 'primary'}
					onClick={() => onHorizontalChange(!flipHorizontal)}
					tooltip="Flip horizontal"
				>
					<Icon name="arrow-horizontal" />
				</Button>
				<Button
					class="flip"
					variant={flipVertical ? 'success' : 'primary'}
					onClick={() => onVerticalChange(!flipVertical)}
					tooltip="Flip vertical"
				>
					<Icon name="arrow-vertical" />
				</Button>
			</div>
		</ControlBox>
	);
}

export function CropControl({
	width,
	height,
	crop,
	threshold,
	onCropWithCursor,
	onThresholdChange,
	warnRounding,
	onChange,
	onCropDetect,
}: {
	width: number;
	height: number;
	crop?: Region;
	threshold: number;
	onCropWithCursor?: () => void;
	onThresholdChange: (limit: number) => void;
	warnRounding?: boolean;
	onChange: (crop?: Region) => void;
	onCropDetect?: (limit: number) => void;
}) {
	const id = useMemo(uid, []);
	const lastCropRef = useRef<Region | undefined>(undefined);
	const inputCrop = useRef<SetOptional<Region, 'x' | 'y' | 'width' | 'height'>>(
		crop || {sourceWidth: width, sourceHeight: height}
	).current;
	const forceUpdate = useForceUpdate();

	// Update input crop with new data
	if (lastCropRef.current !== crop) {
		if (crop) {
			Object.assign(inputCrop, crop);
		} else {
			inputCrop.x = inputCrop.y = inputCrop.width = inputCrop.height = undefined;
		}
		lastCropRef.current = crop;
	}

	function handleInternalCropChange() {
		const newCrop: Region | undefined = isCropValid(inputCrop) ? {...inputCrop} : undefined;
		lastCropRef.current = newCrop;
		onChange(newCrop);
		forceUpdate();
	}

	function handleXChange(value: string) {
		let x = parseInt(value, 10);
		inputCrop.x = Number.isFinite(x) ? clamp(0, x, width - (inputCrop.width || 1)) : undefined;
		handleInternalCropChange();
	}

	function handleYChange(value: string) {
		let y = parseInt(value, 10);
		inputCrop.y = Number.isFinite(y) ? clamp(0, y, height - (inputCrop.height || 1)) : undefined;
		handleInternalCropChange();
	}

	function handleWidthChange(value: string) {
		let newWidth = parseInt(value, 10);
		inputCrop.width = Number.isFinite(newWidth) ? clamp(1, newWidth, width - (inputCrop.x || 0)) : undefined;
		handleInternalCropChange();
	}

	function handleHeightChange(value: string) {
		let newHeight = parseInt(value, 10);
		inputCrop.height = Number.isFinite(newHeight) ? clamp(1, newHeight, height - (inputCrop.y || 0)) : undefined;
		handleInternalCropChange();
	}

	function handleRoundTo2(event: MouseEvent) {
		event.preventDefault();
		const x = inputCrop.x || 0;
		const y = inputCrop.y || 0;
		const cropWidth = inputCrop.width || 2;
		const cropHeight = inputCrop.height || 2;
		const maxWidth = width - x;
		const maxHeight = height - y;
		inputCrop.width = Math.round(cropWidth / 2) * 2;
		if (inputCrop.width > maxWidth) inputCrop.width = Math.floor(maxWidth / 2) * 2;
		inputCrop.height = clamp(1, Math.round(cropHeight / 2) * 2, height - y);
		if (inputCrop.height > maxHeight) inputCrop.height = Math.floor(maxHeight / 2) * 2;
		handleInternalCropChange();
	}

	function handleCancel() {
		onChange(undefined);
		inputCrop.x = inputCrop.y = inputCrop.width = inputCrop.height = undefined;
		forceUpdate();
	}

	const isActive = isCropValid(inputCrop);
	const variant = isActive ? 'success' : undefined;
	const roundingWarning = 'Some encoders require dimensions to be even numbers. Click to quickly round to 2.';
	const widthWarning = warnRounding && inputCrop.width && inputCrop.width % 2 !== 0 ? roundingWarning : undefined;
	const heightWarning = warnRounding && inputCrop.height && inputCrop.height % 2 !== 0 ? roundingWarning : undefined;

	return (
		<ControlBox
			title="Crop"
			titleButton={
				onCropWithCursor && !crop ? (
					<Button tooltip="Crop with cursor" onClick={onCropWithCursor}>
						<Icon name="crop" />
					</Button>
				) : undefined
			}
			variant={variant}
			onCancel={isActive ? handleCancel : undefined}
		>
			<div class="CropControl">
				<ul class="inputs">
					<li>
						<label for={`${id}-x`}>X</label>
						<Input
							type="number"
							variant={variant}
							id={`${id}-x`}
							cols={6}
							value={inputCrop.x}
							placeholder={0}
							onChange={handleXChange}
						/>
					</li>
					<li>
						<label for={`${id}-y`}>Y</label>
						<Input
							type="number"
							variant={variant}
							id={`${id}-y`}
							cols={6}
							value={inputCrop.y}
							placeholder={0}
							onChange={handleYChange}
						/>
					</li>
					<li>
						<label
							for={`${id}-width`}
							class={widthWarning ? '-warning' : undefined}
							title={widthWarning}
							onClick={widthWarning ? handleRoundTo2 : undefined}
						>
							<span class="icon">{widthWarning ? '⚠' : undefined}</span>
							Width
						</label>
						<Input
							type="number"
							variant={variant}
							id={`${id}-width`}
							cols={6}
							value={inputCrop.width}
							placeholder={width}
							onChange={handleWidthChange}
						/>
					</li>
					<li>
						<label
							for={`${id}-height`}
							class={heightWarning ? '-warning' : undefined}
							title={heightWarning}
							onClick={heightWarning ? handleRoundTo2 : undefined}
						>
							<span class="icon">{heightWarning ? '⚠' : undefined}</span>
							Height
						</label>
						<Input
							type="number"
							variant={variant}
							id={`${id}-height`}
							cols={6}
							value={inputCrop.height}
							placeholder={height}
							onChange={handleHeightChange}
						/>
					</li>
				</ul>
				{onCropDetect != null && (
					<form
						class="detect"
						onSubmit={(event) => {
							event.preventDefault();
							onCropDetect(threshold);
						}}
					>
						<label
							htmlFor={`${id}-limit`}
							title={`Crop threshold as a percentage difference from the top left pixel of the image.`}
						>
							T <Help />
						</label>
						<Slider
							variant={variant}
							min={0}
							max={100}
							step={1}
							value={Math.round(threshold * 100)}
							onChange={(value) => onThresholdChange(clamp(0, value / 100, 1))}
						/>
						<Input
							type="number"
							variant={variant}
							cols={4}
							value={Math.round(threshold * 100)}
							onChange={(value) => {
								const float = parseFloat(value);
								const clamped = Number.isFinite(float) ? clamp(0, float, 100) : 0;
								onThresholdChange(clamped / 100);
								if (threshold === clamped && value !== `${clamped}`) forceUpdate();
							}}
						/>
						<Button
							variant={variant}
							class="detect"
							tooltip={`Create a crop rectangle that trims boring pixels from all edges.\nBoring pixels are pixels matching the top left pixel of the image.`}
						>
							Detect
						</Button>
					</form>
				)}
			</div>
		</ControlBox>
	);
}

export function ResizeControl({
	config,
	onChange,
	showRoundBy,
}: {
	config: ResizeOptions;
	onChange: (dimensions: ResizeOptions) => void;
	showRoundBy?: boolean;
}) {
	const id = useMemo(uid, []);
	const isActive = config.width || config.height || config.pixels;
	const variant = isActive ? 'success' : undefined;

	function handleCancel() {
		onChange({...config, width: '', height: '', pixels: ''});
	}

	return (
		<ControlBox title="Resize" variant={variant} onCancel={isActive ? handleCancel : undefined}>
			<ul class="ResizeControl">
				<li class="width">
					<label
						for={`${id}-width`}
						title={`Desired output width limit.\nUse floating point for relative resizing: 0.5 → half, 2.0 → double`}
					>
						Width
						<Help />
					</label>
					<Input
						type="number"
						variant={variant}
						id={`${id}-width`}
						cols={8}
						value={config.width}
						onChange={(width) => onChange({...config, width})}
					/>
				</li>
				<li class="height">
					<label
						for={`${id}-height`}
						title={`Desired output height limit.\nUse floating point for relative resizing: 0.5 → half, 2.0 → double`}
					>
						Height
						<Help />
					</label>
					<Input
						type="number"
						variant={variant}
						id={`${id}-height`}
						cols={8}
						value={config.height}
						onChange={(height) => onChange({...config, height})}
					/>
				</li>
				{!!config.width && !!config.height && (
					<li class="fit">
						<label
							for={`${id}-fit`}
							title={`
fill - stretch to match width & height
inside - scale until it fits inside width & height
outside - scale until it covers width & height
cover - scale until it covers width & height, and chop off parts that stick out
contain - scale until it fits inside width & height, and pad the missing area with background color
`}
						>
							Fit
							<Help />
						</label>
						<Dropdown
							variant={variant}
							value={config.fit}
							onChange={(value) => onChange({...config, fit: value as Fit})}
						>
							<option value="fill">fill</option>
							<option value="inside">inside</option>
							<option value="outside">outside</option>
							<option value="cover">cover</option>
							<option value="contain">contain</option>
						</Dropdown>
					</li>
				)}
				<li class="pixels">
					<label
						for={`${id}-pixels`}
						title={`Limit final resolution to this amount of pixels.\nSupported formats: 921600, 1280x720, 1e6, 921.6K, 0.921M`}
					>
						Pixels
						<Help />
					</label>
					<Input
						id={`${id}-pixels`}
						cols={10}
						value={config.pixels}
						onChange={(pixels) => onChange({...config, pixels})}
					/>
					<span class="hint">{makePixelsHint(config.pixels)}</span>
				</li>
				<li class="downscaleOnly">
					<label for={`${id}-downscaleOnly`}>Downscale only</label>
					<Checkbox
						id={`${id}-downscaleOnly`}
						checked={!!config.downscaleOnly}
						onChange={(downscaleOnly) => onChange({...config, downscaleOnly})}
					/>
				</li>
				{showRoundBy && (
					<li class="roundBy">
						<label
							for={`${id}-roundBy`}
							title="Round final resolution so it's divisible by this number. Some encoders require even number dimensions."
						>
							Round by <Help />
						</label>
						<Slider
							id={`${id}-roundBy`}
							min={1}
							max={16}
							step={1}
							value={config.roundBy || 1}
							onChange={(roundBy) => onChange({...config, roundBy})}
						/>
					</li>
				)}
			</ul>
		</ControlBox>
	);
}

type SerializedCut = [string, string];

function serializeCuts(cuts: Cuts) {
	return (cuts || []).map(([from, to]) => [msToIsoTime(from), msToIsoTime(to)] as SerializedCut);
}

export function CutsControl({
	cuts,
	duration,
	speed,
	onChange,
}: {
	cuts: Cuts;
	duration: number;
	speed: number;
	onChange: (cuts: Cuts) => void;
}) {
	const isActive = cuts != null && cuts.length > 0;
	const [internalCuts, setInternalCuts] = useState<SerializedCut[]>([]);
	const cutsDuration = useMemo(() => (cuts ? countCutsDuration(cuts) : null), [cuts]);
	const cutsDurationHuman = useMemo(() => (cutsDuration ? msToHumanTime(cutsDuration) : null), [cutsDuration]);
	const speedDurationHuman = useMemo(
		() => (cutsDuration && speed !== 1 ? msToHumanTime(cutsDuration / speed) : null),
		[cutsDuration, speed]
	);

	useEffect(() => {
		setInternalCuts(serializeCuts(cuts));
	}, [cuts]);

	function handleChange(serializedCuts: SerializedCut[]) {
		setInternalCuts([...serializedCuts]);

		// Update upstream cuts if the edits are valid
		let newCuts: Cut[] = [];
		let prevEnd = -Infinity;
		for (let i = 0; i < serializedCuts.length; i++) {
			const [fromIso, toIso] = serializedCuts[i]!;

			if (!isIsoTime(fromIso) || !isIsoTime(toIso)) return;

			const from = isoTimeToMS(fromIso);
			const to = isoTimeToMS(toIso);

			if (from <= prevEnd || to > duration) return;

			newCuts.push([from, to]);

			prevEnd = to;
		}

		onChange(newCuts.length > 0 ? newCuts : undefined);
	}

	function handleCancel() {
		onChange(undefined);
	}

	return (
		<ControlBox
			title="Cuts"
			variant={isActive ? 'success' : undefined}
			onCancel={isActive ? handleCancel : undefined}
		>
			<div class="CutsControl">
				<ul class="cuts">
					{internalCuts.length === 0 && (
						<li class="placeholder">No cuts, the whole timeline will be encoded.</li>
					)}
					{internalCuts.map(([from, to], index) => {
						const prevEnd = cuts?.[index - 1]?.[1] ?? 0;
						const nextStart = cuts?.[index + 1]?.[0] ?? duration;
						const isFromValid = isIsoTime(from) && isoTimeToMS(from) >= prevEnd;
						const isToValid = isIsoTime(to) && isoTimeToMS(to) <= nextStart;

						return (
							<li>
								<input
									type="text"
									value={from}
									class={!isFromValid ? '-danger' : undefined}
									onInput={(event) =>
										handleChange(
											internalCuts.map((cut, c) =>
												c === index ? [event.currentTarget.value, to] : cut
											)
										)
									}
									title={
										!isFromValid
											? `Invalid format, or time precedes previous cut end.\nFormat: HH:MM:SS.sss`
											: undefined
									}
								/>
								<div class="divider" />
								<input
									type="text"
									value={to}
									class={!isToValid ? '-danger' : undefined}
									onInput={(event) =>
										handleChange(
											internalCuts.map((cut, c) =>
												c === index ? [from, event.currentTarget.value] : cut
											)
										)
									}
									title={
										!isToValid
											? `Invalid format, or time is bigger than next cut start.\nFormat: HH:MM:SS.sss`
											: undefined
									}
								/>
								<Button
									semitransparent
									variant="danger"
									onClick={() => handleChange(internalCuts!.filter((_, c) => c !== index))}
									tooltip="Delete cut"
								>
									<Icon name="trash" />
								</Button>
							</li>
						);
					})}
				</ul>
				{cutsDurationHuman && (
					<ul class="duration">
						<li>
							<span class="title">Duration:</span>
							<span class="value">{cutsDurationHuman}</span>
						</li>
						{speedDurationHuman && (
							<li>
								<span class="title">+ Speed:</span>
								<span class="value">{speedDurationHuman}</span>
							</li>
						)}
					</ul>
				)}
			</div>
		</ControlBox>
	);
}

export function SpeedFPSControl({
	value,
	onSpeedChange,
	changeInfo,
	maxFps,
	onMaxFpsChange,
}: {
	value: number;
	onSpeedChange: (value: number) => void;
	changeInfo?: string;
	maxFps?: number;
	onMaxFpsChange?: (value: number) => void;
}) {
	const isActive = value !== 1 || maxFps;
	const isValid = value >= 0.5 && value <= 100;
	const variant = !isValid ? 'danger' : isActive ? 'success' : undefined;

	function handleCancel() {
		onSpeedChange(1);
		onMaxFpsChange?.(0);
	}

	return (
		<ControlBox
			title={`Speed${maxFps != null ? ' / FPS' : ''}`}
			variant={variant}
			onCancel={isActive ? handleCancel : undefined}
		>
			<div class="SpeedFpsControl">
				<div class="controls">
					<Slider variant={variant} value={value} min={0.5} max={2} step={0.05} onChange={onSpeedChange} />
					<Input
						type="number"
						variant={variant}
						cols={4}
						value={Math.round(value * 100)}
						onChange={(value) => {
							const int = parseInt(value, 10);
							if (Number.isFinite(int)) onSpeedChange(int / 100);
						}}
					/>
					<span class="unit">%</span>
				</div>
				{!isValid && <div class="legend">Min: 50%, max: 10000%</div>}
				{changeInfo != null && <div class="info">{changeInfo}</div>}
				{maxFps != null && (
					<label>
						<h1>Max FPS:</h1>
						<Input
							type="number"
							cols={6}
							min={0}
							value={maxFps}
							onChange={(value) => {
								const fps = parseFloat(value);
								if (fps > 0) onMaxFpsChange?.(fps);
							}}
						/>
					</label>
				)}
				{maxFps != null && (
					<div class="info">
						Inputs with higher FPS will be downsampled to this value.
						<br />
						Set to <code>0</code> to disable.
					</div>
				)}
			</div>
		</ControlBox>
	);
}

export function MiscControl({children}: RenderableProps<{}>) {
	return (
		<ControlBox title="Miscellaneous">
			<ul class="MiscControl">{children}</ul>
		</ControlBox>
	);
}

export function MiscControlItem({children, active}: RenderableProps<{active?: boolean}>) {
	let classNames = '';
	if (active) classNames += ` -active`;
	return <li class={classNames}>{children}</li>;
}

export function SavingControl({
	saving,
	defaultPath,
	onChange,
}: {
	saving: Payload['options']['saving'];
	defaultPath: string;
	onChange: (destination: Payload['options']['saving']) => void;
}) {
	function handleDestinationChange(value: string) {
		value = value.replaceAll('\\', '/');
		const extname = Path.extname(value);
		if (extname) value = value.slice(0, -extname.length);
		onChange({...saving, destination: `${value}.\${ext}`});
	}

	return (
		<ControlBox title="Destination">
			<div class="MiscControl">
				<MiscControlItem>
					<Input
						type="path"
						value={saving.destination}
						defaultPath={defaultPath}
						onChange={handleDestinationChange}
						tooltip={saving.destination}
					/>
				</MiscControlItem>
				<MiscControlItem>
					<label>
						<Checkbox
							checked={saving.deleteOriginal}
							onChange={(value) => onChange({...saving, deleteOriginal: value})}
						/>
						Delete original
					</label>
				</MiscControlItem>
				<MiscControlItem>
					<label>
						<Checkbox
							checked={saving.overwriteDestination}
							onChange={(value) => onChange({...saving, overwriteDestination: value})}
						/>
						Overwrite destination
					</label>
				</MiscControlItem>
			</div>
		</ControlBox>
	);
}
