import {h} from 'preact';
import {useState, useMemo} from 'preact/hooks';
import {VideoMeta} from 'ffprobe-normalized';
import type {Payload} from '../';
import {Vacant} from 'components/Vacant';
import {Preview, previewHelp} from 'components/Preview';
import {MediaControls} from 'components/MediaControls';
import {HelpToggle} from 'components/HelpToggle';
import {Timeline, timelineHelp} from 'components/Timeline';
import {useCombinedMediaPlayer} from 'components/MediaPlayer';
import {Input} from 'components/Input';
import {Slider} from 'components/Slider';
import {
	Controls,
	CropControls,
	RotateFlipControls,
	ResizeControls,
	CutsControls,
	MiscControls,
	MiscControlItem,
	SpeedFPSControls,
	SavingControls,
} from 'components/Controls';
import {sanitizeCrop, countCutsDuration, moveItem, resizeRegion, cropCuts} from 'lib/utils';
import {VideoOptions} from 'lib/video';
import * as shortcuts from 'config/shortcuts';

export interface VideoEditorOptions {
	ffmpegPath: string;
	metas: VideoMeta[];
	payload: Payload;
	editorData: EditorData;
	onSubmit: (payload: Payload, meta: {duration: number}) => void;
	onCancel: () => void;
}

export function VideoEditor({
	ffmpegPath,
	metas,
	editorData,
	payload: initPayload,
	onSubmit,
	onCancel,
}: VideoEditorOptions) {
	const firstMeta = metas?.[0];
	if (!metas || !firstMeta) return <Vacant>No video passed.</Vacant>;

	const [crop, setCrop] = useState<Region | undefined>(undefined);
	const [cropThreshold, setCropThreshold] = useState(0.1);
	const [payload, setPayload] = useState(initPayload);
	const videoOptions = payload.options.video;
	initPayload = useMemo(() => JSON.parse(JSON.stringify(initPayload)), []);
	const [rotate, setRotation] = useState<Rotation | undefined>(undefined);
	const [flipHorizontal, setFlipHorizontal] = useState<true | undefined>(undefined);
	const [flipVertical, setFlipVertical] = useState<true | undefined>(undefined);
	const [enableCursorCropping, setEnableCursorCropping] = useState(false);
	const media = useCombinedMediaPlayer(metas, ffmpegPath);

	function setVideoOption<N extends keyof Payload['options']['video']>(
		name: N,
		value: Payload['options']['video'][N]
	) {
		setPayload({
			...payload,
			options: {...payload.options, video: {...payload.options.video, [name]: value}},
		});
	}

	function handleSubmit() {
		onSubmit(
			{...payload, edits: {crop, rotate, flipHorizontal, flipVertical, cuts: media.cuts}},
			{duration: media.duration}
		);
	}

	async function handleCropDetect() {
		const newCrop = await media.cropDetect({threshold: cropThreshold});
		setCrop(newCrop ? sanitizeCrop(newCrop, {roundBy: 2}) : undefined);
	}

	function useLastCrop() {
		if (editorData.lastCrop) {
			setCrop(sanitizeCrop(resizeRegion(editorData.lastCrop, media.width, media.height), {roundBy: 2}));
		}
	}

	function useLastCuts() {
		if (editorData.lastCuts) {
			media.setCuts(cropCuts(editorData.lastCuts.cuts, 0, media.duration));
		}
	}

	return (
		<div class="VideoEditor">
			<div class="preview">
				<Preview
					width={media.width}
					height={media.height}
					rotate={rotate || 0}
					flipHorizontal={flipHorizontal || false}
					flipVertical={flipVertical || false}
					crop={crop}
					cropRounding={2}
					enableCursorCropping={enableCursorCropping}
					background="black"
					onCropChange={(crop) => {
						setEnableCursorCropping(false);
						setCrop(crop);
					}}
					onCancelCropping={() => setEnableCursorCropping(false)}
					onCropDetect={handleCropDetect}
					onCropCancel={() => setCrop(undefined)}
					onUseLastCrop={editorData.lastCrop ? useLastCrop : undefined}
				>
					<media.Component />
				</Preview>

				<HelpToggle>
					{videoEditorHelp}
					{timelineHelp}
					{previewHelp}
				</HelpToggle>
			</div>

			<Controls onSubmit={handleSubmit} onCancel={onCancel}>
				<CropControls
					width={media.width}
					height={media.height}
					crop={crop}
					threshold={cropThreshold}
					onUseLastCrop={editorData.lastCrop ? useLastCrop : undefined}
					warnRounding={true}
					onCropWithCursor={() => setEnableCursorCropping((value) => !value)}
					onThresholdChange={setCropThreshold}
					onChange={setCrop}
					onCropDetect={handleCropDetect}
				/>
				<RotateFlipControls
					rotation={rotate || 0}
					onRotationChange={(rotation) => setRotation(rotation === 0 ? undefined : rotation)}
					flipVertical={flipVertical || false}
					onVerticalChange={(value) => setFlipVertical(value || undefined)}
					flipHorizontal={flipHorizontal || false}
					onHorizontalChange={(value) => setFlipHorizontal(value || undefined)}
				/>
				<ResizeControls config={videoOptions.resize} onChange={(resize) => setVideoOption('resize', resize)} />
				<SpeedFPSControls
					value={videoOptions.speed}
					onSpeedChange={(speed) => {
						setVideoOption('speed', speed);
						media.setSpeed(speed);
					}}
					changeInfo={`Also changes framerate accordingly.`}
					maxFps={videoOptions.maxFps}
					onMaxFpsChange={(fps) => setVideoOption('maxFps', fps)}
				/>
				<CutsControls
					cuts={media.cuts}
					duration={media.duration}
					speed={videoOptions.speed}
					onChange={media.setCuts}
					onUseLastCuts={editorData.lastCuts ? useLastCuts : undefined}
				/>
				<VideoEncoderControls
					videoOptions={payload.options.video}
					initVideoOptions={initPayload.options.video}
					onChange={(video) => setPayload({...payload, options: {...payload.options, video}})}
				/>
				<SavingControls
					saving={payload.options.saving}
					defaultPath={firstMeta.path}
					onChange={(saving) => setPayload({...payload, options: {...payload.options, saving}})}
				/>
			</Controls>

			<Timeline
				media={media}
				onMove={(from, to) => {
					media.movePlayer(from, to);
					setPayload({...payload, inputs: [...moveItem(payload.inputs, from, to)]});
				}}
			/>

			<MediaControls
				media={media}
				cutsDuration={media.cuts ? countCutsDuration(media.cuts) : undefined}
				speed={videoOptions.speed}
			/>
		</div>
	);
}

const videoEditorHelp = [
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
function VideoEncoderControls({
	videoOptions,
	initVideoOptions,
	onChange,
}: {
	videoOptions: VideoOptions;
	initVideoOptions: VideoOptions;
	onChange: (videoOptions: VideoOptions) => void;
}) {
	let title = videoOptions.codec.toUpperCase();
	let controls: h.JSX.Element[] = [];
	const {codec} = videoOptions;

	switch (codec) {
		case 'h265':
		case 'h264': {
			const codecOptions = videoOptions[codec];
			const {mode} = codecOptions;
			title += ` (${mode})`;

			switch (mode) {
				case 'size':
				case 'bitrate': {
					const isSize = mode === 'size';
					controls.push(
						<MiscControlItem>
							<label>
								<span class="title">{isSize ? `Size` : `Bitrate`}</span>
								<Input
									class="input"
									value={codecOptions[mode]}
									onChange={(value) => {
										onChange({
											...videoOptions,
											[codec]: {
												...codecOptions,
												[mode]: (isSize ? parseFloat(value) : parseInt(value, 10)) || 0,
											},
										});
									}}
								/>
								<span
									class="hint"
									title={
										isSize
											? undefined
											: `Value in KB per megapixel per second. Will be used to calculate the actual bitrate based on the output resolution, as we don't know it upfront.\n720p videos are around 1Mpx, so set this to whatever bitrate you'd use for 720p videos.`
									}
								>
									{isSize ? `MB` : `KB/Mpx/s`}
								</span>
							</label>
						</MiscControlItem>
					);
					break;
				}

				case 'quality':
					controls.push(
						<MiscControlItem>
							<label>
								<span class="title" title="Constant Rate Factor">
									CRF
								</span>
								<Slider
									class="input"
									min={0}
									max={51}
									step={1}
									value={codecOptions.crf}
									onChange={(value) => {
										onChange({...videoOptions, [codec]: {...codecOptions, crf: value}});
									}}
								/>
								<span class="value" style="width:3ch">
									{codecOptions.crf}
								</span>
							</label>
						</MiscControlItem>
					);
					break;
			}
			break;
		}

		case 'vp8':
		case 'vp9': {
			const codecOptions = videoOptions[codec];
			const {mode} = codecOptions;
			title += ` (${mode})`;

			if (mode === 'quality' || mode === 'constrained-quality') {
				controls.push(
					<MiscControlItem>
						<label>
							<span class="title" title="Constant Rate Factor">
								CRF
							</span>
							<Slider
								class="input"
								min={0}
								max={63}
								step={1}
								value={codecOptions.crf}
								onChange={(value) => {
									onChange({...videoOptions, [codec]: {...codecOptions, crf: value}});
								}}
							/>
							<span class="value" style="width:3ch">
								{codecOptions.crf}
							</span>
						</label>
					</MiscControlItem>
				);
			}

			if (mode === 'quality') {
				controls.push(
					<MiscControlItem>
						<label>
							<span class="title" title="Min quality">
								QMIN
							</span>
							<Slider
								class="input"
								min={0}
								max={63}
								step={1}
								value={codecOptions.qmin}
								onChange={(value) => {
									onChange({...videoOptions, [codec]: {...codecOptions, qmin: value}});
								}}
							/>
							<span class="value" style="width:3ch">
								{codecOptions.qmin}
							</span>
						</label>
					</MiscControlItem>,
					<MiscControlItem>
						<label>
							<span class="title" title="Max quality">
								QMAX
							</span>
							<Slider
								class="input"
								min={0}
								max={63}
								step={1}
								value={codecOptions.qmax}
								onChange={(value) => {
									onChange({...videoOptions, [codec]: {...codecOptions, qmax: value}});
								}}
							/>
							<span class="value" style="width:3ch">
								{codecOptions.qmax}
							</span>
						</label>
					</MiscControlItem>
				);
			}

			if (mode === 'bitrate' || mode === 'constrained-quality') {
				controls.push(
					<MiscControlItem>
						<label>
							<span class="title">Bitrate</span>
							<Input
								class="input"
								value={codecOptions.bitrate}
								onChange={(value) => {
									onChange({
										...videoOptions,
										[codec]: {...codecOptions, bitrate: parseInt(value, 10) || 0},
									});
								}}
							/>
							<span
								class="hint"
								title={`Value in KB per megapixel per second. Will be used to calculate the actual bitrate based on the output resolution, as we don't know it upfront.\n720p videos are around 1Mpx, so set this to whatever bitrate you'd use for 720p videos.`}
							>
								KB/Mpx/s
							</span>
						</label>
					</MiscControlItem>
				);
			}

			if (mode === 'bitrate') {
				controls.push(
					<MiscControlItem>
						<label>
							<span class="title">Minrate</span>
							<Input
								class="input"
								value={codecOptions.minrate}
								onChange={(value) => {
									onChange({
										...videoOptions,
										[codec]: {...codecOptions, minrate: parseInt(value, 10) || 0},
									});
								}}
							/>
							<span
								class="hint"
								title={`Value in KB per megapixel per second. Will be used to calculate the actual bitrate based on the output resolution, as we don't know it upfront.\n720p videos are around 1Mpx, so set this to whatever bitrate you'd use for 720p videos.`}
							>
								KB/Mpx/s
							</span>
						</label>
					</MiscControlItem>,
					<MiscControlItem>
						<label>
							<span class="title">Maxrate</span>
							<Input
								class="input"
								value={codecOptions.maxrate}
								onChange={(value) => {
									onChange({
										...videoOptions,
										[codec]: {...codecOptions, maxrate: parseInt(value, 10) || 0},
									});
								}}
							/>
							<span
								class="hint"
								title={`Value in KB per megapixel per second. Will be used to calculate the actual bitrate based on the output resolution, as we don't know it upfront.\n720p videos are around 1Mpx, so set this to whatever bitrate you'd use for 720p videos.`}
							>
								KB/Mpx/s
							</span>
						</label>
					</MiscControlItem>
				);
			}
			break;
		}

		case 'av1': {
			const codecOptions = videoOptions[codec];
			const {mode} = codecOptions;
			title += ` (${mode.toUpperCase()})`;

			if (mode === 'crf') {
				controls.push(
					<MiscControlItem>
						<label>
							<span class="title" title="Constant Rate Factor">
								CRF
							</span>
							<Slider
								class="input"
								min={0}
								max={63}
								step={1}
								value={codecOptions.crf}
								onChange={(value) => {
									onChange({...videoOptions, [codec]: {...codecOptions, crf: value}});
								}}
							/>
							<span class="value" style="width:3ch">
								{codecOptions.crf}
							</span>
						</label>
					</MiscControlItem>
				);

				if (initVideoOptions.av1.maxBitrate !== 0) {
					controls.push(
						<MiscControlItem>
							<label>
								<span class="title">Max bitrate</span>
								<Input
									class="input"
									value={codecOptions.maxBitrate}
									onChange={(value) => {
										onChange({
											...videoOptions,
											[codec]: {...codecOptions, maxBitrate: parseInt(value, 10) || 0},
										});
									}}
								/>
								<span
									class="hint"
									title={`Value in KB per megapixel per second. Will be used to calculate the actual bitrate based on the output resolution, as we don't know it upfront.\n720p videos are around 1Mpx, so set this to whatever bitrate you'd use for 720p videos.`}
								>
									KB/Mpx/s
								</span>
							</label>
						</MiscControlItem>
					);
				}
			}

			if (mode === 'vbr' || mode === 'cbr') {
				controls.push(
					<MiscControlItem>
						<label>
							<span class="title">Target bitrate</span>
							<Input
								class="input"
								value={codecOptions.targetBitrate}
								onChange={(value) => {
									onChange({
										...videoOptions,
										[codec]: {...codecOptions, targetBitrate: parseInt(value, 10) || 0},
									});
								}}
							/>
							<span
								class="hint"
								title={`Value in KB per megapixel per second. Will be used to calculate the actual bitrate based on the output resolution, as we don't know it upfront.\n720p videos are around 1Mpx, so set this to whatever bitrate you'd use for 720p videos.`}
							>
								KB/Mpx/s
							</span>
						</label>
					</MiscControlItem>,
					<MiscControlItem>
						<label>
							<span class="title" title="Minimum allowed quantizer (highest allowed quality)">
								Min QP
							</span>
							<Slider
								min={1}
								max={63}
								step={1}
								value={codecOptions.minQp}
								onChange={(value) => {
									onChange({...videoOptions, [codec]: {...codecOptions, minQp: value}});
								}}
							/>
							<span class="value" style="width:3ch">
								{codecOptions.minQp}
							</span>
						</label>
					</MiscControlItem>,
					<MiscControlItem>
						<label>
							<span class="title" title="Maximum allowed quantizer (lowest allowed quality)">
								Max QP
							</span>
							<Slider
								min={1}
								max={63}
								step={1}
								value={codecOptions.maxQp}
								onChange={(value) => {
									onChange({...videoOptions, [codec]: {...codecOptions, maxQp: value}});
								}}
							/>
							<span class="value" style="width:3ch">
								{codecOptions.maxQp}
							</span>
						</label>
					</MiscControlItem>
				);
			}

			if (mode === 'size') {
				controls.push(
					<MiscControlItem>
						<label>
							<span class="title">Size</span>
							<Input
								value={codecOptions.size}
								onChange={(value) => {
									onChange({
										...videoOptions,
										[codec]: {...codecOptions, size: parseFloat(value) || 0},
									});
								}}
							/>
							<span class="hint">MB</span>
						</label>
					</MiscControlItem>
				);
			}

			break;
		}

		case 'gif': {
			const codecOptions = videoOptions[codec];
			controls.push(
				<MiscControlItem>
					<label>
						<span class="title">Colors</span>
						<Slider
							min={4}
							max={256}
							step={1}
							value={codecOptions.colors}
							onChange={(value) => {
								onChange({...videoOptions, [codec]: {...codecOptions, colors: value}});
							}}
						/>
						<span class="value" style="width:3ch">
							{codecOptions.colors}
						</span>
					</label>
				</MiscControlItem>
			);
			break;
		}
	}

	return (
		<MiscControls title={title}>
			{controls}
			<li class="divider"></li>
			<MiscControlItem>
				<label
					title={`Converts audio from higher number channels to lower.\nNo effect when source audio has equal or lover number of channels.\nSet to 0 to strip audio completely.`}
				>
					<span class="title">Max audio channels</span>
					<Slider
						class="input"
						min={0}
						max={8}
						step={1}
						value={videoOptions.maxAudioChannels}
						onChange={(value) => {
							onChange({...videoOptions, maxAudioChannels: value});
						}}
					/>
					<span class="value" style="width:3ch">
						{videoOptions.maxAudioChannels}
					</span>
				</label>
			</MiscControlItem>
			{videoOptions.maxAudioChannels > 0 && (
				<MiscControlItem>
					<label title={`Audio (${videoOptions.audioCodec}) bitrate PER CHANNEL per second`}>
						<span class="title">Audio ⚠</span>
						<Slider
							class="input"
							min={16}
							max={160}
							step={16}
							value={videoOptions.audioChannelBitrate}
							onChange={(value) => {
								onChange({...videoOptions, audioChannelBitrate: value});
							}}
						/>
						<span class="value" style="width:3ch">
							{videoOptions.audioChannelBitrate}
						</span>
						<span class="hint">Kb/ch/s</span>
					</label>
				</MiscControlItem>
			)}
		</MiscControls>
	);
}
