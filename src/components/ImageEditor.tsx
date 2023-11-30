import {h} from 'preact';
import {useState} from 'preact/hooks';
import {ImageMeta} from 'ffprobe-normalized';
import type {Payload} from '../';
import {Vacant} from 'components/Vacant';
import {Preview} from 'components/Preview';
import {ImageView} from 'components/ImageView';
import {Controls, LoadingBox, CropControl, RotateFlipControl, ResizeControl, SavingControl} from 'components/Controls';
import {cropDetect, sanitizeCrop, resizeRegion} from 'lib/utils';

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
		if (!editorData.previousCrop) return;
		setCrop(sanitizeCrop(resizeRegion(editorData.previousCrop, meta.width, meta.height), {roundBy: 1}));
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
					onUsePreviousCrop={editorData.previousCrop ? usePreviousCrop : undefined}
				>
					<ImageView data={imageData} />
				</Preview>
			</div>
			<Controls onSubmit={handleSubmit} onCancel={onCancel}>
				{imageData == null ? (
					<LoadingBox>Loading media</LoadingBox>
				) : (
					[
						<CropControl
							width={meta.width}
							height={meta.height}
							crop={crop}
							threshold={cropThreshold}
							onCropWithCursor={() => setEnableCursorCropping(true)}
							onThresholdChange={setCropThreshold}
							onChange={setCrop}
							onCropDetect={handleCropDetect}
							onUsePreviousCrop={editorData.previousCrop ? usePreviousCrop : undefined}
						/>,
						<RotateFlipControl
							rotation={rotate || 0}
							onRotationChange={(rotation) => setRotation(rotation === 0 ? undefined : rotation)}
							flipVertical={flipVertical || false}
							onVerticalChange={(value) => setFlipVertical(value || undefined)}
							flipHorizontal={flipHorizontal || false}
							onHorizontalChange={(value) => setFlipHorizontal(value || undefined)}
						/>,
						<ResizeControl
							config={payload.options.image.resize}
							onChange={(resize) => {
								setPayload({
									...payload,
									options: {...payload.options, image: {...payload.options.image, resize}},
								});
							}}
						/>,
						<SavingControl
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
