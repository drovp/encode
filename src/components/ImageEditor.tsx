import {h} from 'preact';
import {useState} from 'preact/hooks';
import {ImageMeta} from 'ffprobe-normalized';
import type {Payload} from '../';
import {Vacant} from 'components/Vacant';
import {Preview, previewHelp} from 'components/Preview';
import {ImageView} from 'components/ImageView';
import {Slider} from 'components/Slider';
import {HelpToggle} from 'components/HelpToggle';
import {
	Controls,
	LoadingBox,
	CropControls,
	RotateFlipControls,
	ResizeControls,
	SavingControls,
	MiscControls,
	MiscControlItem,
} from 'components/Controls';
import {cropDetect, sanitizeCrop, resizeRegion} from 'lib/utils';
import {ImageOptions} from 'lib/image';
import * as shortcuts from 'config/shortcuts';

export interface ImageEditorOptions {
	nodePath: string;
	ffmpegPath: string;
	meta: ImageMeta;
	imageData: ImageData;
	editorData: EditorData;
	payload: Payload;
	onSubmit: (payload: Payload) => void;
	onCancel: () => void;
}

export function ImageEditor({
	nodePath,
	ffmpegPath,
	meta,
	imageData,
	editorData,
	payload: initPayload,
	onSubmit,
	onCancel,
}: ImageEditorOptions) {
	if (!meta) return <Vacant>No image passed.</Vacant>;

	const [crop, setCrop] = useState<Region | undefined>(undefined);
	const [cropThreshold, setCropThreshold] = useState(0.1);
	const [payload, setPayload] = useState(initPayload);
	const [rotate, setRotation] = useState<Rotation | undefined>(undefined);
	const [flipHorizontal, setFlipHorizontal] = useState<true | undefined>(undefined);
	const [flipVertical, setFlipVertical] = useState<true | undefined>(undefined);
	const [enableCursorCropping, setEnableCursorCropping] = useState(false);

	async function handleCropDetect() {
		if (imageData) setCrop(cropDetect(imageData, {threshold: cropThreshold}));
	}

	function handleSubmit() {
		onSubmit({...payload, edits: {crop, rotate, flipHorizontal, flipVertical}});
	}

	function usePreviousCrop() {
		if (!editorData.lastCrop) return;
		setCrop(sanitizeCrop(resizeRegion(editorData.lastCrop, meta.width, meta.height), {roundBy: 1}));
	}

	return (
		<div class="ImageEditor">
			<div class="preview">
				<Preview
					width={meta.width}
					height={meta.height}
					rotate={rotate || 0}
					flipHorizontal={flipHorizontal || false}
					flipVertical={flipVertical || false}
					crop={crop}
					enableCursorCropping={enableCursorCropping}
					onCropChange={(crop) => {
						setEnableCursorCropping(false);
						setCrop(crop);
					}}
					onCancelCropping={() => setEnableCursorCropping(false)}
					onCropDetect={handleCropDetect}
					onCropCancel={() => setCrop(undefined)}
					onUseLastCrop={editorData.lastCrop ? usePreviousCrop : undefined}
				>
					<ImageView data={imageData} />
				</Preview>

				<HelpToggle>
					{imageEditorHelp}
					{previewHelp}
				</HelpToggle>
			</div>
			<Controls onSubmit={handleSubmit} onCancel={onCancel}>
				{imageData == null ? (
					<LoadingBox>Loading media</LoadingBox>
				) : (
					[
						<CropControls
							width={meta.width}
							height={meta.height}
							crop={crop}
							threshold={cropThreshold}
							onCropWithCursor={() => setEnableCursorCropping(true)}
							onThresholdChange={setCropThreshold}
							onChange={setCrop}
							onCropDetect={handleCropDetect}
							onUseLastCrop={editorData.lastCrop ? usePreviousCrop : undefined}
						/>,
						<RotateFlipControls
							rotation={rotate || 0}
							onRotationChange={(rotation) => setRotation(rotation === 0 ? undefined : rotation)}
							flipVertical={flipVertical || false}
							onVerticalChange={(value) => setFlipVertical(value || undefined)}
							flipHorizontal={flipHorizontal || false}
							onHorizontalChange={(value) => setFlipHorizontal(value || undefined)}
						/>,
						<ResizeControls
							config={payload.options.image.resize}
							onChange={(resize) => {
								setPayload({
									...payload,
									options: {...payload.options, image: {...payload.options.image, resize}},
								});
							}}
						/>,
						<ImageEncoderControls
							imageOptions={payload.options.image}
							onChange={(image) => setPayload({...payload, options: {...payload.options, image}})}
						/>,
						<SavingControls
							saving={payload.options.saving}
							defaultPath={meta.path}
							onChange={(saving) => setPayload({...payload, options: {...payload.options, saving}})}
						/>,
					]
				)}
			</Controls>
		</div>
	);
}

const imageEditorHelp = [
	<h3>Editing</h3>,
	<table>
		<tr>
			<td>
				<kbd>{shortcuts.crop}</kbd>
			</td>
			<td>crop with cursor</td>
		</tr>
		<tr>
			<td>
				<kbd>{shortcuts.useLastCrop}</kbd>
			</td>
			<td>use last crop</td>
		</tr>
	</table>,
];

// Quick options to control the quality of the encoder selected in profile's options
function ImageEncoderControls({
	imageOptions,
	onChange,
}: {
	imageOptions: ImageOptions;
	onChange: (imageOptions: ImageOptions) => void;
}) {
	let controls: h.JSX.Element[] = [];
	const {codec} = imageOptions;
	const codecOptions = imageOptions[codec];

	if (codec === 'png') return null;

	controls.push(
		<MiscControlItem>
			<label>
				<span class="title">Quality</span>
				<Slider
					class="input"
					min={1}
					max={100}
					step={1}
					value={codecOptions.quality}
					onChange={(value) => {
						onChange({...imageOptions, [codec]: {...codecOptions, quality: value}});
					}}
				/>
				<span class="value" style="width:3ch">
					{codecOptions.quality}
				</span>
			</label>
		</MiscControlItem>
	);

	return <MiscControls title={imageOptions.codec.toUpperCase()}>{controls}</MiscControls>;
}
