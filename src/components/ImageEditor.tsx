import {h} from 'preact';
import {useState, useLayoutEffect} from 'preact/hooks';
import {ImageMeta} from 'ffprobe-normalized';
import type {Payload} from '../';
import {Spinner} from 'components/Spinner';
import {Vacant} from 'components/Vacant';
import {Preview} from 'components/Preview';
import {ImageView} from 'components/ImageView';
import {Controls, LoadingBox, CropControl, RotateFlipControl, ResizeControl} from 'components/Controls';
import {getOneRawFrame} from 'lib/ffmpeg';
import {eem, cropDetect} from 'lib/utils';

export interface ImageEditorOptions {
	ffmpegPath: string;
	meta: ImageMeta;
	payload: Payload;
	onSubmit: (payload: Payload) => void;
	onCancel: () => void;
}

export function ImageEditor({ffmpegPath, meta, payload: initPayload, onSubmit, onCancel}: ImageEditorOptions) {
	const [crop, setCrop] = useState<Crop | undefined>(undefined);
	const [cropLimit, setCropLimit] = useState(0.03);
	const [payload, setPayload] = useState(initPayload);
	const [rotate, setRotation] = useState<Rotation | undefined>(undefined);
	const [flipHorizontal, setFlipHorizontal] = useState<true | undefined>(undefined);
	const [flipVertical, setFlipVertical] = useState<true | undefined>(undefined);
	const [imageData, setImageData] = useState<ImageData | null>(null);
	const [isLoading, setIsLoading] = useState(true);
	const [loadingError, setLoadingError] = useState<string | null>(null);
	const [enableCursorCropping, setEnableCursorCropping] = useState(false);

	// Load ImageData
	useLayoutEffect(() => {
		setIsLoading(true);
		getOneRawFrame({ffmpegPath, meta})
			.then(setImageData)
			.catch((error) => setLoadingError(eem(error)))
			.finally(() => setIsLoading(false));
	}, []);

	async function handleCropDetect() {
		if (imageData) setCrop(cropDetect(imageData, {limit: cropLimit}));
	}

	function handleSubmit() {
		onSubmit({...payload, edits: {crop, rotate, flipHorizontal, flipVertical}});
	}

	return (
		<div class="ImageEditor">
			<div class="preview">
				{isLoading ? (
					<Spinner />
				) : loadingError ? (
					<Vacant variant="danger" title="Error" details={loadingError} />
				) : imageData ? (
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
				) : (
					<Vacant variant="danger" title="Error">
						Image data is missing.
					</Vacant>
				)}
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
					]
				)}
			</Controls>
		</div>
	);
}
