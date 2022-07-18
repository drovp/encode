import {h} from 'preact';
import {useState} from 'preact/hooks';
import {ImageMeta} from 'ffprobe-normalized';
import type {Payload} from '../';
import {Vacant} from 'components/Vacant';
import {Preview} from 'components/Preview';
import {ImageView} from 'components/ImageView';
import {
	Controls,
	LoadingBox,
	CropControl,
	RotateFlipControl,
	ResizeControl,
	DestinationControl,
} from 'components/Controls';
import {cropDetect} from 'lib/utils';

export interface ImageEditorOptions {
	nodePath: string;
	ffmpegPath: string;
	meta: ImageMeta;
	imageData: ImageData;
	payload: Payload;
	onSubmit: (payload: Payload) => void;
	onCancel: () => void;
}

export function ImageEditor({
	nodePath,
	ffmpegPath,
	meta,
	imageData,
	payload: initPayload,
	onSubmit,
	onCancel,
}: ImageEditorOptions) {
	if (!meta) return <Vacant>No image passed.</Vacant>;

	const [crop, setCrop] = useState<Crop | undefined>(undefined);
	const [cropLimit, setCropLimit] = useState(0.03);
	const [payload, setPayload] = useState(initPayload);
	const [rotate, setRotation] = useState<Rotation | undefined>(undefined);
	const [flipHorizontal, setFlipHorizontal] = useState<true | undefined>(undefined);
	const [flipVertical, setFlipVertical] = useState<true | undefined>(undefined);
	const [enableCursorCropping, setEnableCursorCropping] = useState(false);

	async function handleCropDetect() {
		if (imageData) setCrop(cropDetect(imageData, {limit: cropLimit}));
	}

	function handleSubmit() {
		onSubmit({...payload, edits: {crop, rotate, flipHorizontal, flipVertical}});
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
						if (crop) setEnableCursorCropping(false);
						setCrop(crop);
					}}
					onCropDetect={handleCropDetect}
					onCropCancel={() => setCrop(undefined)}
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
							cropLimit={cropLimit}
							onCropWithCursor={() => setEnableCursorCropping(true)}
							onCropLimitChange={setCropLimit}
							onChange={setCrop}
							onCropDetect={handleCropDetect}
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
							dimensions={payload.options.image.dimensions}
							onChange={(dimensions) => {
								setPayload({
									...payload,
									options: {...payload.options, image: {...payload.options.image, dimensions}},
								});
							}}
						/>,
						<DestinationControl
							destination={payload.options.saving.destination}
							defaultPath={meta.path}
							onChange={(destination) => {
								setPayload({
									...payload,
									options: {...payload.options, saving: {...payload.options.saving, destination}},
								});
							}}
						/>,
					]
				)}
			</Controls>
		</div>
	);
}
