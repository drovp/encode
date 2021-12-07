import {Plugin, PayloadData, OptionsSchema, makeAcceptsFlags} from '@drovp/types';
import {makeOptionSchema as makeSavingOptionSchema, Options as SavingOptions} from '@drovp/save-as-path';
import {ImageOptions} from './lib/image';
import {AudioOptions} from './lib/audio';
import {VideoOptions} from './lib/video';
import {numberToPercent} from './lib/utils';
import {makeResizeDimensionsOptionsSchema} from './lib/dimensions';

/**
 * Types & schemas.
 */

type Options = SavingOptions & {
	image: Omit<ImageOptions, 'saving'> & {
		ignore: boolean;
		skipThreshold: number | null;
	};
	audio: Omit<AudioOptions, 'saving'> & {
		ignore: boolean;
		skipThreshold: number | null;
	};
	video: Omit<VideoOptions, 'saving'> & {
		ignore: boolean;
		skipThreshold: number | null;
	};
	ffmpegPath: string;
	ffprobePath: string;
};

// Options schema for the Options type above
const optionsSchema: OptionsSchema<Options> = [
	makeSavingOptionSchema({
		extraVariables: {
			codec: `name of the codec used to encode the file`,
		},
	}),
	{
		type: 'divider',
		title: `Input types`,
	},
	{
		name: 'category',
		type: 'category',
		options: {
			video: 'Video',
			audio: 'Audio',
			image: 'Images',
		},
		default: 'video',
	},
	{
		name: 'video',
		type: 'namespace',
		isHidden: (_, options) => options.category !== 'video',
		schema: [
			{
				name: 'ignore',
				type: 'boolean',
				default: false,
				title: `Ignore`,
				description: `Don't process video files when dropped into this profile.`,
			},
			{
				name: 'dimensions',
				type: 'namespace',
				isHidden: (_, {video}) => video.ignore,
				schema: makeResizeDimensionsOptionsSchema(),
			},
			{
				name: 'codec',
				type: 'select',
				options: {
					h264: 'H.264',
					h265: 'H.265',
					vp8: 'VP8',
					vp9: 'VP9',
					av1: 'AV1',
				},
				default: 'h264',
				title: 'Codec',
				description: (_, {video}) =>
					`Creates <code>.${
						video.codec.startsWith('vp') ? 'webm' : 'mp4'
					}</code> files, or <code>.mkv</code> when output needs subtitles.`,
				isHidden: (_, {video}) => video.ignore,
			},
			{
				name: 'h264',
				type: 'namespace',
				isHidden: (_, {video}) => video.ignore || video.codec !== 'h264',
				schema: [
					{
						name: 'mode',
						type: 'select',
						options: ['quality', 'bitrate', 'size'],
						default: 'quality',
						title: 'Mode',
						description: `Rate control mode. Select wether the output should target constant quality, bitrate, or final file size.`,
					},
					{
						name: 'crf',
						type: 'number',
						min: 0,
						max: 51,
						step: 1,
						default: 23,
						title: 'CRF',
						hint: (value) => value,
						description: `Constant quality rate factor. 0 = lossless, biggest file; 51 = worst, smallest file.<br>Subjectively sane range is 17–28. Consider 17-18 to be visually lossless.`,
						isHidden: (_, {video}) => video.h264.mode !== 'quality',
					},
					{
						name: 'bitrate',
						type: 'number',
						default: 2000,
						title: 'Bitrate',
						hint: 'Kbpspmpx',
						description: `Desired bitrate in KB per second per million pixels. This value will be used to calculate the actual bitrate based on the output resolution, as we don't know it upfront.<br><code>1280x720</code> videos are around 1Mpx, so set this to whatever bitrate you'd use for 720p videos.`,
						isHidden: (_, {video}) => video.h264.mode !== 'bitrate',
					},
					{
						name: 'size',
						type: 'number',
						default: 0,
						nullable: false,
						title: 'Size',
						hint: 'MB',
						description: `Desired output file size. This value will be used to calculate bitrate based on output duration, and video then encoded in bitrate mode. It is highly recommended to use 2 pass encode, as it greatly helps the encoder hit the desired size.`,
						isHidden: (_, {video}) => video.h264.mode !== 'size',
					},
					{
						name: 'twoPass',
						type: 'boolean',
						default: true,
						title: '2 pass',
						description: `Encodes video in 2 passes, 1st one to prepare a lookahead information so that the actual 2nd encode can do its job better. This takes a bit longer than simple 1 pass encode though.<br>It is highly recommended to use 2 pass encoding in bitrate, and especially in size rate control mode.`,
						isHidden: (_, {video}) => video.h264.mode !== 'bitrate' && video.h264.mode !== 'size',
					},
					{
						name: 'preset',
						type: 'select',
						// prettier-ignore
						options: ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow'],
						default: 'medium',
						title: 'Preset',
						description: (_, {video}) =>
							video.h264.mode === 'quality'
								? `Slower presets will produce smaller files.`
								: `Slower presets will produce higher quality video.`,
					},
					{
						name: 'tune',
						type: 'select',
						// prettier-ignore
						options: ['', 'film', 'animation', 'grain', 'stillimage', 'fastdecode', 'zerolatency'],
						default: '',
						title: 'Tune',
						description: (_, {video}) =>
							`Changes encoding settings based upon the specifics of your input.<br>
<b>film</b> – use for high quality movie content; lowers deblocking</br>
<b>animation</b> – good for cartoons; uses higher deblocking and more reference frames</br>
<b>grain</b> – preserves the grain structure in old, grainy film material</br>
<b>stillimage</b> – good for slideshow-like content</br>
<b>fastdecode</b> – allows faster decoding by disabling certain filters</br>
<b>zerolatency</b> – good for fast encoding and low-latency streaming</br>`,
					},
					{
						name: 'profile',
						type: 'select',
						options: ['auto', 'baseline', 'main', 'high'],
						default: 'auto',
						title: 'Profile',
						description: `
<b>auto</b> (recommended) - This will automatically set the profile based on all the options that have been selected.<br>
<b>baseline</b> - The most basic form of encoding. Decoding is easier, but it requires higher bit-rates to maintain the same quality.<br>
<b>main</b> - The middle ground. Most modern / current devices will support this profile.<br>
<b>high</b> - For best quality and filesize at the expense of CPU time in both decode and encode.`,
					},
				],
			},
			{
				name: 'h265',
				type: 'namespace',
				isHidden: (_, {video}) => video.ignore || video.codec !== 'h265',
				schema: [
					{
						name: 'mode',
						type: 'select',
						options: ['quality', 'bitrate', 'size'],
						default: 'quality',
						title: 'Mode',
						description: `Rate control mode. Select wether the output should target constant quality, bitrate, or final file size.`,
					},
					{
						name: 'crf',
						type: 'number',
						min: 0,
						max: 51,
						step: 1,
						default: 28,
						title: 'CRF',
						hint: (value) => value,
						description: `Constant quality rate factor. 0 = lossless, biggest file; 51 = worst, smallest file. 28 is equivalent to H.264's 23.`,
						isHidden: (_, {video}) => video.h265.mode !== 'quality',
					},
					{
						name: 'bitrate',
						type: 'number',
						default: 2000,
						title: 'Bitrate',
						hint: 'Kbpspmpx',
						description: `Desired bitrate in KB per second per million pixels. This value will be used to calculate the actual bitrate based on the output resolution, as we don't know it upfront.<br><code>1280x720</code> videos are around 1Mpx, so set this to whatever bitrate you'd use for 720p videos.`,
						isHidden: (_, {video}) => video.h265.mode !== 'bitrate',
					},
					{
						name: 'size',
						type: 'number',
						default: 0,
						nullable: false,
						title: 'Size',
						hint: 'MB',
						description: `Desired output file size. This value will be used to calculate bitrate based on output duration, and video then encoded in bitrate mode. It is highly recommended to use 2 pass encode, as it greatly helps the encoder hit the desired size.`,
						isHidden: (_, {video}) => video.h265.mode !== 'size',
					},
					{
						name: 'twoPass',
						type: 'boolean',
						default: true,
						title: '2 pass',
						description: `Encodes video in 2 passes, 1st one to prepare a lookahead information so that the actual 2nd encode can do its job better. This takes a bit longer than simple 1 pass encode though.<br>It is highly recommended to use 2 pass encoding in bitrate, and especially in size rate control mode.`,
						isHidden: (_, {video}) => video.h265.mode !== 'bitrate' && video.h265.mode !== 'size',
					},
					{
						name: 'preset',
						type: 'select',
						// prettier-ignore
						options: ['ultrafast', 'superfast', 'veryfast', 'faster', 'fast', 'medium', 'slow', 'slower', 'veryslow'],
						default: 'medium',
						title: 'Preset',
						description: (_, {video}) =>
							video.h265.mode === 'quality'
								? `Slower presets will produce smaller files.`
								: `Slower presets will produce higher quality video.`,
					},
					{
						name: 'tune',
						type: 'select',
						// prettier-ignore
						options: ['', 'grain', 'zerolatency', 'fastdecode'],
						default: '',
						title: 'Tune',
						description: (_, {video}) =>
							`Changes encoding settings based upon the specifics of your input.<br>
<b>grain</b> – preserves the grain structure in old, grainy film material</br>
<b>fastdecode</b> – allows faster decoding by disabling certain filters</br>
<b>zerolatency</b> – good for fast encoding and low-latency streaming</br>`,
					},
					{
						name: 'profile',
						type: 'select',
						// prettier-ignore
						options: [
							'auto', 'main', 'main-intra', 'mainstillpicture', 'main444-8', 'main444-intra', 'main444-stillpicture',
							'main10', 'main10-intra', 'main422-10', 'main422-10-intra', 'main444-10', 'main444-10-intra', 'main12',
							'main12-intra', 'main422-12', 'main422-12-intra', 'main444-12', 'main444-12-intra'
						],
						default: 'auto',
						title: 'Profile',
						description: `<b>auto</b> (recommended) will automatically set the profile based on all the options that have been selected.`,
					},
				],
			},
			{
				name: 'vp8',
				type: 'namespace',
				isHidden: (_, {video}) => video.ignore || video.codec !== 'vp8',
				schema: [
					{
						name: 'mode',
						type: 'select',
						options: ['quality', 'constrained-quality', 'bitrate', 'size'],
						default: 'quality',
						title: 'Mode',
						description: `Rate control mode. Select wether the output should target constant quality, constrained quality, average bitrate, or final file size.<br><b>Constrained quality</b> ensures bitrate will stay below a specified upper bound.`,
					},
					{
						name: 'crf',
						type: 'number',
						min: 0,
						max: 63,
						step: 1,
						default: 10,
						title: 'CRF',
						hint: (value) => value,
						description: `Constant quality rate factor. 0 = lossless, biggest file; 63 = worst, smallest file. Value has to be between <code>qmin</code> and <code>qmax</code> below.`,
						isHidden: (_, {video}) =>
							video.vp8.mode !== 'quality' && video.vp8.mode !== 'constrained-quality',
					},
					{
						name: 'qmin',
						type: 'number',
						min: 0,
						max: 63,
						step: 1,
						default: 4,
						title: 'qmin',
						hint: (value) => value,
						description: `The minimum range of quantizers that the rate control algorithm may use.`,
						isHidden: (_, {video}) => video.vp8.mode !== 'quality',
					},
					{
						name: 'qmax',
						type: 'number',
						min: 0,
						max: 63,
						step: 1,
						default: 63,
						title: 'qmax',
						hint: (value) => value,
						description: `The maximum range of quantizers that the rate control algorithm may use.`,
						isHidden: (_, {video}) => video.vp8.mode !== 'quality',
					},
					{
						name: 'bitrate',
						type: 'number',
						default: 2000,
						title: 'Bitrate',
						hint: 'Kbpspmpx',
						description: `Desired bitrate in KB per second per million pixels. This value will be used to calculate the actual bitrate based on the output resolution, as we don't know it upfront.<br><code>1280x720</code> videos are around 1Mpx, so set this to whatever bitrate you'd use for 720p videos.`,
						isHidden: (_, {video}) =>
							video.vp8.mode !== 'bitrate' && video.vp8.mode !== 'constrained-quality',
					},
					{
						name: 'minrate',
						type: 'number',
						default: 500,
						title: 'Minrate',
						hint: 'Kbpspmpx',
						description: `Min bitrate in KB per second per million pixels.`,
						isHidden: (_, {video}) => video.vp8.mode !== 'bitrate',
					},
					{
						name: 'maxrate',
						type: 'number',
						default: 2500,
						title: 'Maxrate',
						hint: 'Kbpspmpx',
						description: `Max bitrate in KB per second per million pixels.`,
						isHidden: (_, {video}) => video.vp8.mode !== 'bitrate',
					},
					{
						name: 'size',
						type: 'number',
						default: 0,
						nullable: false,
						title: 'Size',
						hint: 'MB',
						description: `Desired output file size. This value will be used to calculate bitrate based on output duration, and video then encoded in bitrate mode. It is highly recommended to use 2 pass encode, as it greatly helps the encoder hit the desired size.`,
						isHidden: (_, {video}) => video.vp8.mode !== 'size',
					},
					{
						name: 'twoPass',
						type: 'boolean',
						default: true,
						title: '2 pass',
						description: `Encodes video in 2 passes, 1st one to prepare a lookahead information so that the actual 2nd encode can do its job better. This takes a bit longer than simple 1 pass encode though.<br>It is highly recommended to use 2 pass encoding in bitrate, and especially in size rate control mode.<br>
						2 pass is also useful in CRF mode, as lbvpx disables some useful encoding features when doing only 1 pass.`,
					},
					{
						name: 'speed',
						type: 'number',
						min: 0,
						max: 5,
						step: 1,
						default: 1,
						title: 'Speed',
						hint: (value) => value,
						description: `Set quality/speed ratio modifier. Higher values speed up the encode at the cost of quality.`,
					},
				],
			},
			{
				name: 'vp9',
				type: 'namespace',
				isHidden: (_, {video}) => video.ignore || video.codec !== 'vp9',
				schema: [
					{
						name: 'mode',
						type: 'select',
						options: ['quality', 'constrained-quality', 'bitrate', 'size', 'lossless'],
						default: 'quality',
						title: 'Mode',
						description: `Rate control mode. Select wether the output should target constant quality, constrained quality, average bitrate, final file size, or should be lossless.<br><b>Constrained quality</b> ensures bitrate will stay below a specified upper bound.`,
					},
					{
						name: 'crf',
						type: 'number',
						min: 0,
						max: 63,
						step: 1,
						default: 30,
						title: 'CRF',
						hint: (value) => value,
						description: `Constant quality rate factor. 0 = lossless, biggest file; 63 = worst, smallest file. Value has to be between <code>qmin</code> and <code>qmax</code> below.`,
						isHidden: (_, {video}) =>
							video.vp9.mode !== 'quality' && video.vp9.mode !== 'constrained-quality',
					},
					{
						name: 'qmin',
						type: 'number',
						min: 0,
						max: 63,
						step: 1,
						default: 4,
						title: 'qmin',
						hint: (value) => value,
						description: `The minimum range of quantizers that the rate control algorithm may use.`,
						isHidden: (_, {video}) => video.vp9.mode !== 'quality',
					},
					{
						name: 'qmax',
						type: 'number',
						min: 0,
						max: 63,
						step: 1,
						default: 63,
						title: 'qmax',
						hint: (value) => value,
						description: `The maximum range of quantizers that the rate control algorithm may use.`,
						isHidden: (_, {video}) => video.vp9.mode !== 'quality',
					},
					{
						name: 'bitrate',
						type: 'number',
						default: 2000,
						title: 'Bitrate',
						hint: 'Kbpspmpx',
						description: (_, {video}) =>
							`${
								video.vp9.mode === 'constrained-quality' ? 'Max desired' : 'Desired'
							} bitrate in KB per second per million pixels. This value will be used to calculate the actual bitrate based on the output resolution, as we don't know it upfront.<br><code>1280x720</code> videos are around 1Mpx, so set this to whatever bitrate you'd use for 720p videos.`,
						isHidden: (_, {video}) =>
							video.vp9.mode !== 'bitrate' && video.vp9.mode !== 'constrained-quality',
					},
					{
						name: 'minrate',
						type: 'number',
						default: 500,
						title: 'Minrate',
						hint: 'Kbpspmpx',
						description: `Min bitrate in KB per second per million pixels.`,
						isHidden: (_, {video}) => video.vp9.mode !== 'bitrate',
					},
					{
						name: 'maxrate',
						type: 'number',
						default: 2500,
						title: 'Maxrate',
						hint: 'Kbpspmpx',
						description: `Max bitrate in KB per second per million pixels.`,
						isHidden: (_, {video}) => video.vp9.mode !== 'bitrate',
					},
					{
						name: 'size',
						type: 'number',
						default: 0,
						nullable: false,
						title: 'Size',
						hint: 'MB',
						description: `Desired output file size. This value will be used to calculate bitrate based on output duration, and video then encoded in bitrate mode. It is highly recommended to use 2 pass encode, as it greatly helps the encoder hit the desired size.`,
						isHidden: (_, {video}) => video.vp9.mode !== 'size',
					},
					{
						name: 'twoPass',
						type: 'boolean',
						default: true,
						title: '2 pass',
						description: `Encodes video in 2 passes, 1st one to prepare a lookahead information so that the actual 2nd encode can do its job better. This takes a bit longer than simple 1 pass encode though.<br>It is highly recommended to use 2 pass encoding in bitrate, and especially in size rate control mode.<br>
						This is also useful in quality mode, as some quality-enhancing encoder features are only available in 2-pass mode.`,
					},
					{
						name: 'speed',
						type: 'number',
						min: 0,
						max: 5,
						step: 1,
						default: 0,
						title: 'Speed',
						hint: (value) => value,
						description: `Set quality/speed ratio modifier. Using 1 or 2 will increase encoding speed at the expense of having some impact on quality and rate control accuracy. 4 or 5 will turn off rate distortion optimization, having even more of an impact on quality.`,
					},
					{
						name: 'threads',
						type: 'number',
						min: 0,
						max: 5,
						step: 1,
						default: 0,
						title: 'Threads',
						hint: (value) => (!value ? 1 : Math.pow(2, value)),
						description: `Splits the video into rectangular regions, and encodes each in its own thread.`,
					},
				],
			},
			{
				name: 'av1',
				type: 'namespace',
				isHidden: (_, {video}) => video.ignore || video.codec !== 'av1',
				schema: [
					{
						name: 'mode',
						type: 'select',
						options: ['quality', 'constrained-quality', 'bitrate', 'size'],
						default: 'quality',
						title: 'Mode',
						description: `Rate control mode. Select wether the output should target constant quality, constrained quality, average bitrate, or final file size.<br><b>Constrained quality</b> ensures bitrate will stay below a specified upper bound.`,
					},
					{
						name: 'crf',
						type: 'number',
						min: 0,
						max: 63,
						step: 1,
						default: 30,
						title: 'CRF',
						hint: (value) => value,
						description: `Constant quality rate factor. 0 = lossless, biggest file; 63 = worst, smallest file. Value has to be between <code>qmin</code> and <code>qmax</code> below.`,
						isHidden: (_, {video}) =>
							video.av1.mode !== 'quality' && video.av1.mode !== 'constrained-quality',
					},
					{
						name: 'qmin',
						type: 'number',
						min: 0,
						max: 63,
						step: 1,
						default: 0,
						title: 'qmin',
						hint: (value) => value,
						description: `The minimum range of quantizers that the rate control algorithm may use.`,
						isHidden: (_, {video}) => video.av1.mode !== 'quality',
					},
					{
						name: 'qmax',
						type: 'number',
						min: 0,
						max: 63,
						step: 1,
						default: 63,
						title: 'qmax',
						hint: (value) => value,
						description: `The maximum range of quantizers that the rate control algorithm may use.`,
						isHidden: (_, {video}) => video.av1.mode !== 'quality',
					},
					{
						name: 'bitrate',
						type: 'number',
						default: 2000,
						title: 'Bitrate',
						hint: 'Kbpspmpx',
						description: (_, {video}) =>
							`${
								video.av1.mode === 'constrained-quality' ? 'Max desired' : 'Desired'
							} bitrate in KB per second per million pixels. This value will be used to calculate the actual bitrate based on the output resolution, as we don't know it upfront.<br><code>1280x720</code> videos are around 1Mpx, so set this to whatever bitrate you'd use for 720p videos.`,
						isHidden: (_, {video}) =>
							video.av1.mode !== 'bitrate' && video.av1.mode !== 'constrained-quality',
					},
					{
						name: 'minrate',
						type: 'number',
						default: 500,
						title: 'Minrate',
						hint: 'Kbpspmpx',
						description: `Min bitrate in KB per second per million pixels.`,
						isHidden: (_, {video}) => video.av1.mode !== 'bitrate',
					},
					{
						name: 'maxrate',
						type: 'number',
						default: 2500,
						title: 'Maxrate',
						hint: 'Kbpspmpx',
						description: `Max bitrate in KB per second per million pixels.`,
						isHidden: (_, {video}) => video.av1.mode !== 'bitrate',
					},
					{
						name: 'size',
						type: 'number',
						default: 0,
						nullable: false,
						title: 'Size',
						hint: 'MB',
						description: `Desired output file size. This value will be used to calculate bitrate based on output duration, and video then encoded in bitrate mode. It is highly recommended to use 2 pass encode, as it greatly helps the encoder hit the desired size.`,
						isHidden: (_, {video}) => video.av1.mode !== 'size',
					},
					{
						name: 'maxKeyframeInterval',
						type: 'number',
						kind: 'float',
						min: 0,
						max: 10,
						softMax: true,
						step: 0.1,
						default: 10,
						title: 'Max keyframe interval',
						hint: `s`,
						description: `Set the maximum keyframe interval in seconds. Setting to 0 will use the default keyframe interval of 9999 frames, which can lead to slow seeking.`,
					},
					{
						name: 'twoPass',
						type: 'boolean',
						default: true,
						title: '2 pass',
						description: `Encodes video in 2 passes, 1st one to prepare a lookahead information so that the actual 2nd encode can do its job better. This takes a bit longer than simple 1 pass encode though.`,
					},
					{
						name: 'speed',
						type: 'number',
						min: 0,
						max: 8,
						step: 1,
						default: 1,
						title: 'Speed',
						hint: (value) => value,
						description: `Sets how efficient the compression will be. Lower values mean slower encoding with better quality, and vice-versa.`,
					},
					{
						name: 'multithreading',
						type: 'boolean',
						default: true,
						title: 'Multithreading',
						description: `Enables row-based multi-threading which maximizes CPU usage.`,
					},
				],
			},
			{
				name: 'stripSubtitles',
				type: 'boolean',
				default: false,
				title: 'Strip subtitles',
				description: `Removes subtitles from output container. Ensures the output won't have to be an <code>.mkv</code> file if that is important to you.`,
				isHidden: (_, {video}) => video.ignore,
			},
			{
				name: 'pixelFormat',
				type: 'select',
				// prettier-ignore
				options: [
					'yuv420p', 'yuyv422', 'rgb24', 'bgr24', 'yuv422p', 'yuv444p', 'yuv410p', 'yuv411p', 'gray', 'monow',
					'monob', 'pal8', 'yuvj420p', 'yuvj422p', 'yuvj444p', 'uyvy422', 'uyyvyy411', 'bgr8', 'bgr4',
					'bgr4_byte', 'rgb8', 'rgb4', 'rgb4_byte', 'nv12', 'nv21', 'argb', 'rgba', 'abgr', 'bgra',
					'gray16be', 'gray16le', 'yuv440p', 'yuvj440p', 'yuva420p', 'rgb48be', 'rgb48le', 'rgb565be',
					'rgb565le', 'rgb555be', 'rgb555le', 'bgr565be', 'bgr565le', 'bgr555be', 'bgr555le', 'vaapi_moco',
					'vaapi_idct', 'vaapi_vld', 'yuv420p16le', 'yuv420p16be', 'yuv422p16le', 'yuv422p16be',
					'yuv444p16le', 'yuv444p16be', 'dxva2_vld', 'rgb444le', 'rgb444be', 'bgr444le', 'bgr444be', 'ya8',
					'bgr48be', 'bgr48le', 'yuv420p9be', 'yuv420p9le', 'yuv420p10be', 'yuv420p10le', 'yuv422p10be',
					'yuv422p10le', 'yuv444p9be', 'yuv444p9le', 'yuv444p10be', 'yuv444p10le', 'yuv422p9be', 'yuv422p9le',
					'gbrp', 'gbrp9be', 'gbrp9le', 'gbrp10be', 'gbrp10le', 'gbrp16be', 'gbrp16le', 'yuva422p',
					'yuva444p', 'yuva420p9be', 'yuva420p9le', 'yuva422p9be', 'yuva422p9le', 'yuva444p9be',
					'yuva444p9le', 'yuva420p10be', 'yuva420p10le', 'yuva422p10be', 'yuva422p10le', 'yuva444p10be',
					'yuva444p10le', 'yuva420p16be', 'yuva420p16le', 'yuva422p16be', 'yuva422p16le', 'yuva444p16be',
					'yuva444p16le', 'vdpau', 'xyz12le', 'xyz12be', 'nv16', 'nv20le', 'nv20be', 'rgba64be', 'rgba64le',
					'bgra64be', 'bgra64le', 'yvyu422', 'ya16be', 'ya16le', 'gbrap', 'gbrap16be', 'gbrap16le', 'qsv',
					'mmal', 'd3d11va_vld', 'cuda', '0rgb', 'rgb0', '0bgr', 'bgr0', 'yuv420p12be', 'yuv420p12le',
					'yuv420p14be', 'yuv420p14le', 'yuv422p12be', 'yuv422p12le', 'yuv422p14be', 'yuv422p14le',
					'yuv444p12be', 'yuv444p12le', 'yuv444p14be', 'yuv444p14le', 'gbrp12be', 'gbrp12le', 'gbrp14be',
					'gbrp14le', 'yuvj411p', 'bayer_bggr8', 'bayer_rggb8', 'bayer_gbrg8', 'bayer_grbg8',
					'bayer_bggr16le', 'bayer_bggr16be', 'bayer_rggb16le', 'bayer_rggb16be', 'bayer_gbrg16le',
					'bayer_gbrg16be', 'bayer_grbg16le', 'bayer_grbg16be', 'xvmc', 'yuv440p10le', 'yuv440p10be',
					'yuv440p12le', 'yuv440p12be', 'ayuv64le', 'ayuv64be', 'videotoolbox_vld', 'p010le', 'p010be',
					'gbrap12be', 'gbrap12le', 'gbrap10be', 'gbrap10le', 'mediacodec', 'gray12be', 'gray12le',
					'gray10be', 'gray10le', 'p016le', 'p016be', 'd3d11', 'gray9be', 'gray9le', 'gbrpf32be', 'gbrpf32le',
					'gbrapf32be', 'gbrapf32le', 'drm_prime', 'opencl', 'gray14be', 'gray14le', 'grayf32be', 'grayf32le',
					'yuva422p12be', 'yuva422p12le', 'yuva444p12be', 'yuva444p12le', 'nv24', 'nv42', 'vulkan', 'y210be',
					'y210le', 'x2rgb10le', 'x2rgb10be',
				],
				default: 'yuv420p',
				title: 'Pixel format',
				isHidden: (_, {video}) => video.ignore,
			},
			{
				name: 'maxFps',
				type: 'number',
				default: 0,
				title: 'Max FPS',
				hint: (value) => (!value ? 'disabled' : ''),
				description: `Limits output video to not have a higher framerate than  defined. Has no effect if source video is equal or lower than the limit. Set to <code>0</code> to disable.`,
				isHidden: (_, {video}) => video.ignore,
			},
			{
				name: 'scaler',
				type: 'select',
				options: [
					'fast_bilinear',
					'bilinear',
					'bicubic',
					'neighbor',
					'area',
					'gauss',
					'sinc',
					'lanczos',
					'spline',
				],
				default: 'lanczos',
				title: 'Scaler',
				description: `What scaling algorithm to use when resizing.`,
				isHidden: (_, {video}) => video.ignore,
			},
			{
				name: 'deinterlace',
				type: 'boolean',
				default: false,
				title: 'Deinterlace',
				description: `Turns on deinterlace filter.`,
				isHidden: (_, {video}) => video.ignore,
			},
			{
				name: 'maxAudioChannels',
				type: 'number',
				min: 0,
				max: 8,
				step: 1,
				softMax: true,
				default: 8,
				title: 'Max audio channels',
				description: `Converts audio from higher number channels to lower. No effect when source audio has equal or lover number of channels. Set to 0 to strip audio completely.`,
				isHidden: (_, {video}) => video.ignore,
			},
			{
				name: 'audioChannelBitrate',
				type: 'number',
				min: 16,
				max: 160,
				step: 16,
				softMax: true,
				default: 64,
				title: 'Audio channel bitrate',
				hint: 'Kbps',
				description: `Set the desired <b>opus</b> audio bitrate <b>PER CHANNEL</b>.<br>For example, if you want a standard stereo (2 channels) audio to have a <code>96Kbps</code> bitrate, set this to <code>48</code>.`,
				isHidden: (_, {video}) => video.ignore || video.maxAudioChannels === 0,
			},
			{
				name: 'skipThreshold',
				type: 'number',
				title: 'Skip threshold',
				description: `Skip encoding of videos that are already compressed enough by setting a min relative bitrate threshold.<br>
				This value is in kilobytes per megapixel per minute, a unit that can be used to measure compression of a video agnostic to its resolution and duration. If input has KB/Mpx/m <b>lower</b> than this value, encoding will be skipped, and input itself emited as a result.<br>
				For reference, 720p videos are 0.92 Mpx, so you can think of this as the number of KB per minute of 720p video below which you don't feel the need to compress the file further.<br>
				<code>5000</code> is a pretty safe value. Leave empty to never skip encoding.`,
				hint: 'KB/Mpx/m',
				isHidden: (_, {video}) => video.ignore,
			},
			{
				name: 'minSavings',
				type: 'number',
				min: 0,
				max: 0.99,
				step: 0.01,
				default: 0,
				title: 'Min savings',
				description: `Require that the output is at least this much smaller than the original. If the output doesn't satisfy this, it'll be discarded, and the original file emitted as a result.`,
				hint: (value) => (value === 0 ? 'disabled' : numberToPercent(value!)),
				isHidden: (_, {video}) => video.ignore,
			},
		],
	},
	{
		name: 'audio',
		type: 'namespace',
		isHidden: (_, options) => options.category !== 'audio',
		schema: [
			{
				name: 'ignore',
				type: 'boolean',
				default: false,
				title: `Ignore`,
				description: `Don't process audio files when dropped into this profile.`,
			},
			{
				name: 'codec',
				type: 'select',
				options: {
					mp3: 'MP3',
					opus: 'OPUS (OGG)',
				},
				default: 'mp3',
				title: 'Codec',
				description: (_, {audio}) =>
					audio.codec === 'opus'
						? `NOTE: FFmpeg doesn't support encoding cover art into ogg files yet, so if the source has one, it'll be dropped.<br>You can track the progress of this feature, or maybe bug them to implement it here: <a href="https://trac.ffmpeg.org/ticket/4448">ticket/4448</a>`
						: '',
				isHidden: (_, {audio}) => audio.ignore,
			},
			{
				name: 'mp3',
				type: 'namespace',
				isHidden: (_, {audio}) => audio.ignore || audio.codec !== 'mp3',
				schema: [
					{
						name: 'mode',
						type: 'select',
						options: {
							vbr: 'VBR',
							cbr: 'CBR',
						},
						default: 'vbr',
						title: 'Mode',
						description: `Variable or constant bitrate mode.`,
					},
					{
						name: 'vbr',
						type: 'number',
						min: 0,
						max: 9,
						step: 1,
						default: 1,
						title: 'VBR',
						hint: (value) => `${value}`,
						description: `Variable bitrate level. 0 = best, biggest file; 9 = worst, smallest file.`,
						isHidden: (_, {audio}) => audio.mp3.mode !== 'vbr',
					},
					{
						name: 'cbr',
						type: 'number',
						min: 32,
						max: 320,
						step: 32,
						default: 256,
						title: 'CBR',
						description: `Constant bitrate.`,
						hint: (value) => `${value}Kbps`,
						isHidden: (_, {audio}) => audio.mp3.mode !== 'cbr',
					},
					{
						name: 'compression_level',
						type: 'number',
						min: 0,
						max: 9,
						step: 1,
						default: 0,
						title: 'Compression level',
						description: `Speed/effort to put into compression. 0 = high quality/slow, 9 = low quality/fast.`,
						hint: (value) => `${value}`,
					},
				],
			},
			{
				name: 'opus',
				type: 'namespace',
				isHidden: (_, {audio}) => audio.ignore || audio.codec !== 'opus',
				schema: [
					{
						name: 'mode',
						type: 'select',
						options: {
							vbr: 'VBR',
							cvbr: 'CVBR',
							cbr: 'CBR',
						},
						default: 'vbr',
						title: 'Mode',
						description: `Variable, constrained variable, or constant bitrate mode.`,
					},
					{
						name: 'bitrate',
						type: 'number',
						min: 32,
						max: 320,
						step: 32,
						default: 192,
						title: 'Bitrate',
						hint: (value) => `${value}Kbps`,
					},
					{
						name: 'compression_level',
						type: 'number',
						min: 0,
						max: 10,
						step: 1,
						default: 10,
						title: 'Compression level',
						description: `0 = low quality/fast, 10 = high quality/slow`,
						hint: (value) => `${value}`,
					},
					{
						name: 'application',
						type: 'select',
						options: ['audio', 'lowdelay', 'voip'],
						default: 'audio',
						title: 'Application',
					},
				],
			},
			{
				name: 'skipThreshold',
				type: 'number',
				title: 'Skip threshold',
				description: `Skip encoding of audio files that are already compressed enough by setting a min relative bitrate threshold.<br>
				This value is in kilobytes per channel per minute. If input's KB/ch/m is <b>lower</b> than this value, encoding will be skipped, and input itself emited as a result.<br>
				For reference, 128kbs stereo mp3 files have a bitrate of 470 KB/ch/m.<br>
				Leave empty to never skip encoding.`,
				hint: 'KB/ch/m',
				isHidden: (_, {audio}) => audio.ignore,
			},
			{
				name: 'minSavings',
				type: 'number',
				min: 0,
				max: 0.99,
				step: 0.01,
				default: 0,
				title: 'Min savings',
				description: `Require that the output is at least this much smaller than the original. If the output doesn't satisfy this, it'll be discarded, and the original file emitted as a result.`,
				hint: (value) => (value === 0 ? 'disabled' : numberToPercent(value!)),
				isHidden: (_, {audio}) => audio.ignore,
			},
		],
	},
	{
		name: 'image',
		type: 'namespace',
		isHidden: (_, options) => options.category !== 'image',
		schema: [
			{
				name: 'ignore',
				type: 'boolean',
				default: false,
				title: `Ignore`,
				description: `Don't process images when dropped into this profile.`,
			},
			{
				name: 'dimensions',
				type: 'namespace',
				isHidden: (_, {image}) => image.ignore,
				schema: makeResizeDimensionsOptionsSchema(),
			},
			{
				name: 'codec',
				type: 'select',
				options: {
					jpg: 'JPG',
					webp: 'WEBP',
				},
				default: 'jpg',
				title: 'Codec',
				isHidden: (_, {image}) => image.ignore,
			},
			{
				name: 'jpg',
				type: 'namespace',
				isHidden: (_, {image}) => image.ignore || image.codec !== 'jpg',
				schema: [
					{
						name: 'quality',
						type: 'number',
						min: 1,
						max: 31,
						step: 1,
						default: 3,
						title: 'Quality',
						description: `FFmpeg's <code>jpeg2000</code> encoder quality. 1 = best, biggest file; 31 = worst, smallest file.`,
						hint: (value) => value,
					},
				],
			},
			{
				name: 'webp',
				type: 'namespace',
				isHidden: (_, {image}) => image.ignore || image.codec !== 'webp',
				schema: [
					{
						name: 'quality',
						type: 'number',
						min: 1,
						max: 100,
						step: 1,
						default: 75,
						title: 'Quality',
						description: `<code>libwebp</code> encoder quality. 1 = worst, smallest file; 100 = best, biggest file.`,
						hint: (value) => value,
					},
					{
						name: 'compression',
						type: 'number',
						min: 1,
						max: 6,
						step: 1,
						default: 6,
						title: 'Compression',
						description: `<code>libwebp</code> encoder compression. 0 = fastest/worst; 6 = slowest/best.`,
						hint: (value) => value,
					},
					{
						name: 'preset',
						type: 'select',
						options: ['none', 'default', 'picture', 'photo', 'drawing', 'icon', 'text'],
						default: 'picture',
						title: 'Preset',
					},
					{
						name: 'opaque',
						type: 'boolean',
						default: false,
						title: 'Opaque',
						description: `Add background to transparent images.`,
					},
				],
			},
			{
				name: 'scaler',
				type: 'select',
				options: [
					'fast_bilinear',
					'bilinear',
					'bicubic',
					'neighbor',
					'area',
					'gauss',
					'sinc',
					'lanczos',
					'spline',
				],
				default: 'lanczos',
				title: 'Scaler',
				description: `Scaling algorithm to use.`,
				isHidden: (_, {image}) => image.ignore,
			},
			{
				name: 'background',
				type: 'color',
				default: 'white',
				title: 'Background',
				description: `Background color to use when removing alpha channel.<br>Format: <code>#RRGGBB</code>, or name of the color as defined <a href="https://ffmpeg.org/ffmpeg-utils.html#Color">here</a>.`,
				isHidden: (_, {image}) => image.ignore,
			},
			{
				name: 'skipThreshold',
				type: 'number',
				title: 'Skip threshold',
				description: `Skip encoding of image files that are already compressed enough by setting a min relative data density threshold.<br>
				This value is in kilobytes per megapixel. If input's KB/Mpx is <b>lower</b> than this value, encoding will be skipped, and input itself emited as a result.<br>
				For reference, JPG images encoded with 80% quality have a data density of around 270 KB/Mpx.<br>
				Leave empty to never skip encoding.`,
				hint: 'KB/Mpx',
				isHidden: (_, {image}) => image.ignore,
			},
			{
				name: 'minSavings',
				type: 'number',
				min: 0,
				max: 0.99,
				step: 0.01,
				default: 0,
				title: 'Min savings',
				description: `Require that the output is at least this much smaller than the original. If the output doesn't satisfy this, it'll be discarded, and the original file emitted as a result.`,
				hint: (value) => (value === 0 ? 'disabled' : numberToPercent(value!)),
				isHidden: (_, {image}) => image.ignore,
			},
		],
	},
	{
		type: 'divider',
		title: 'Advanced',
	},
	{
		name: 'ffmpegPath',
		type: 'path',
		title: 'FFmpeg path',
		description: `Path to your own FFmpeg binary that should be used instead of the one that comes with this plugin. Can be just <code>ffmpeg</code> if you have it available in your platform's environment <code>PATH</code>.`,
	},
	{
		name: 'ffprobePath',
		type: 'path',
		title: 'FFprobe path',
		description: `Path to your own FFprobe binary that should be used instead of the one that comes with this plugin. Can be just <code>ffprobe</code> if you have it available in your platform's environment <code>PATH</code>.`,
	},
];

const acceptsFlags = makeAcceptsFlags<Options>()({
	// prettier-ignore
	files: [
		'264', '265', '3ds', '3g2', '3gp', '3gpp', 'aac', 'aa3', 'ac3', 'adp', 'aif', 'aifc', 'aiff', 'amr', 'apng', 'asf', 'asx', 'au', 'av1', 'avi', 'avif', 'azv', 'b16', 'bmp', 'btif', 'caf', 'cgm', 'cmx', 'dds', 'djv', 'djvu', 'dra', 'drle', 'dts', 'dtshd', 'dvb', 'dwg', 'dxf', 'ecelp4800', 'ecelp7470', 'ecelp9600', 'emf', 'eol', 'exr', 'f4v', 'fbs', 'fh', 'fh4', 'fh5', 'fh7', 'fhc', 'fits', 'flac', 'fli', 'flv', 'fpx', 'fst', 'fvt', 'g3', 'gif', 'h261', 'h263', 'h264', 'h265', 'h26l', 'hca', 'heic', 'hevc', 'heics', 'heif', 'heifs', 'hej2', 'hsj2', 'ico', 'ief', 'jhc', 'jls', 'jng', 'jp2', 'jpe', 'jpeg', 'jpegxl', 'jpf', 'jpg', 'jpg2', 'jpgm', 'jpgv', 'jph', 'jpm', 'jpx', 'jxl', 'jxr', 'jxra', 'jxrs', 'jxs', 'jxsc', 'jxsi', 'jxss', 'kar', 'ktx', 'ktx2', 'lvp', 'm1v', 'm2a', 'm2v', 'm3a', 'm3u', 'm4a', 'm4s', 'm4u', 'm4v', 'mdi', 'mid', 'midi', 'mj2', 'mjp2', 'mk3d', 'mka', 'mks', 'mkv', 'mmr', 'mng', 'mov', 'movie', 'mp2', 'mp2a', 'mp3', 'mp4', 'mp4a', 'mp4v', 'mpe', 'mpeg', 'mpg', 'mpg4', 'mpga', 'mxmf', 'mxu', 'npx', 'oga', 'ogg', 'ogv', 'opus', 'pbm', 'pct', 'pcx', 'pgm', 'pic', 'png', 'pnm', 'ppm', 'psd', 'pti', 'pya', 'pyv', 'qt', 'ra', 'ram', 'ras', 'rgb', 'rip', 'rlc', 'rmi', 'rmp', 's3m', 'sgi', 'sid', 'sil', 'smv', 'snd', 'spx', 'sub', 'svg', 'svgz', 't38', 'tap', 'tfx', 'tga', 'tif', 'tiff', 'ts', 'uva', 'uvg', 'uvh', 'uvi', 'uvm', 'uvp', 'uvs', 'uvu', 'uvv', 'uvva', 'uvvg', 'uvvh', 'uvvi', 'uvvm', 'uvvp', 'uvvs', 'uvvu', 'uvvv', 'viv', 'vob', 'vtf', 'wav', 'wax', 'wbmp', 'wdp', 'weba', 'webm', 'webp', 'wm', 'wma', 'wmf', 'wmv', 'wmx', 'wvx', 'xbm', 'xif', 'xm', 'xpm', 'xwd',
	],
});

export type Payload = PayloadData<Options, typeof acceptsFlags>;

export default (plugin: Plugin) => {
	plugin.registerProcessor<Payload>('encode', {
		main: 'dist/processor.js',
		description: 'Encode images, video and audio into common formats.',
		instructions: 'README.md',
		dependencies: ['@drovp/ffmpeg:ffmpeg', '@drovp/ffmpeg:ffprobe'],
		accepts: acceptsFlags,
		threadType: 'cpu',
		parallelize: true,
		options: optionsSchema,
	});
};
