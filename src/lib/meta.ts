import * as Path from 'path';
import {promises as FSP} from 'fs';
import {eem, extractFileType, exec} from './utils';

export interface RawProbeData {
	streams: {
		index: number;
		codec_name: string; // 'h264'
		codec_long_name: string; // 'H.264 / AVC / MPEG-4 AVC / MPEG-4 part 10'
		profile?: string; // 'High' (mp4, jpg)
		codec_type: string; // 'video'
		codec_tag_string: string; // 'avc1'
		codec_tag: string; // '0x31637661'
		width: number; // 1920
		height: number; // 1080
		coded_width: number; // 1920
		coded_height: number; // 1080
		closed_captions: number; // 0
		has_b_frames: number; // 2
		sample_aspect_ratio?: string; // '1:1' (jpg)
		display_aspect_ratio?: string; // '60:71' (jpg)
		pix_fmt: string; // 'yuv420p'
		level: number; // 42
		color_range?: string; // 'pc' (jpg, png)
		color_space?: string; // 'bt470bg' (jpg)
		chroma_location?: string; // 'left' (mp4, jpg)
		refs: number; // 1
		is_avc?: string; // 'true' (mp4)
		nal_length_size?: string; // '4' (mp4)
		r_frame_rate: string; // '25/1'
		avg_frame_rate: string; // '11250/449'
		time_base: string; // '1/90000'
		start_pts?: number; // 0 (mp4, jpg)
		start_time?: string; // '0.000000' (mp4, jpg)
		duration_ts?: number; // 1616400 (mp4, jpg)
		duration?: string; // '17.960000' (mp4, jpg)
		sample_fmt?: string; // 'fltp' (aac)
		sample_rate?: string; // '48000' (aac)
		channels?: number; // (aac)
		channel_layout?: string; // '5.1' (aac)
		bit_rate?: string; // '3759211' (mp4, jpg)
		bits_per_sample?: number; // (aac)
		bits_per_raw_sample?: string; // '8' (mp4, jpg)
		nb_frames?: string; // '450' (mp4)
		disposition: Disposition;
		// (mp4)
		tags?: {
			language: string; // 'und'
			title?: string; // 'The Second Dream'
			comment?: string; // 'The Second Dream'
			handler_name: string; // 'VideoHandler'
			vendor_id: string; // '[0][0][0][0]'
		};
	}[];
	format: {
		filename: string; // 'sky.mp4'
		nb_streams: number; // 1
		nb_programs: number; // 0
		format_name: string; // 'mov,mp4,m4a,3gp,3g2,mj2'
		format_long_name: string; // 'QuickTime / MOV'
		start_time?: string; // '0.000000' (mp4, jpg)
		duration: number; // milliseconds, normalized manually (mp4, jpg)
		size: number; // bytes, normalized manually
		bit_rate?: string; // '3762044' (mp4, jpg)
		probe_score: number; // 100
		// (mp4)
		tags?: {
			encoder: string; // 'Lavf58.22.100'
			album?: string; // 'Warframe'
			genre?: string; // 'Score'
			title?: string; // 'The Second Dream'
			artist?: string; // 'Keith Power And George Spanos'
			album_artist?: string; // 'Digital Extremes'
			track?: string; // '03'
			date: string; // '2017'
			major_brand?: string; // 'isom'
			minor_version?: string; // '512'
			compatible_brands?: string; // 'isomiso2avc1mp41'
		};
	};
}

export interface Disposition {
	default: number; // 1
	dub: number; // 0
	original: number; // 0
	comment: number; // 0
	lyrics: number; // 0
	karaoke: number; // 0
	forced: number; // 0
	hearing_impaired: number; // 0
	visual_impaired: number; // 0
	clean_effects: number; // 0
	attached_pic: number; // 0
	timed_thumbnails: number; // 0
}

export interface ImageStream {
	type: 'image';
	codec: string; // 'mjpeg', ...
	width: number;
	height: number;
	title?: string;
	disposition: Disposition;
}

export interface VideoStream {
	type: 'video';
	codec: string; // 'h264', ...
	width: number;
	height: number;
	framerate: number;
	title?: string;
	disposition: Disposition;
}

export interface AudioStream {
	type: 'audio';
	codec: string; // 'aac'
	channels: number;
	language?: string; // 'eng'
	title?: string;
	disposition: Disposition;
}

export interface SubtitlesStream {
	type: 'subtitles';
	codec: string; // 'h264', ...
	language?: string; // 'eng'
	title?: string;
	disposition: Disposition;
}

export type Stream = ImageStream | VideoStream | AudioStream | SubtitlesStream;

export interface ImageData {
	path: string;
	type: 'image';
	format: string; // 'jpg', ...
	size: number;
	codec: string; // 'h264', ...
	width: number; // 0 for audio
	height: number; // 0 for audio
}

export interface AudioData {
	path: string;
	type: 'audio';
	format: string; // 'mp3', ...
	size: number;
	codec: string; // 'mp3', ...
	channels: number;
	duration: number;
	cover?: ImageStream;
	album?: string;
	genre?: string;
	language?: string;
	title?: string;
	artist?: string;
	album_artist?: string;
	track?: string;
}

export interface VideoData {
	path: string;
	type: 'video';
	format: string; // 'mp4', ...
	codec: string; // 'h264', ...
	duration: number; // milliseconds
	framerate: number;
	title?: string;
	size: number; // bytes
	width: number; // width of the first video stream, 0 if no video streams
	height: number; // height of the first video stream, 0 if no video streams
	streams: Stream[];
	audioStreams: AudioStream[];
	subtitlesStreams: SubtitlesStream[];
}

export type MetaData = ImageData | AudioData | VideoData;

/**
 * Get media file meta
 */
export async function getMeta(
	filePath: string,
	{ffprobe}: {ffprobe: string}
): Promise<MetaData> {
	filePath = Path.resolve(filePath);
	const fileType = extractFileType(filePath);
	let rawData: RawProbeData;
	let streams: Stream[];

	try {
		const stat = await FSP.stat(filePath);
		const {stdout, stderr} = await exec(
			[
				`"${ffprobe}"`,
				'-hide_banner',
				'-v error',
				'-show_streams',
				'-show_format',
				'-print_format',
				'json',
				`"${filePath}"`,
			].join(' ')
		);

		if (stderr) throw new Error(stderr);

		rawData = JSON.parse(stdout) as RawProbeData;

		// Loose validity check
		if (!rawData || !Array.isArray(rawData.streams) || !rawData.format || typeof rawData.format !== 'object') {
			throw new Error(`Unsupported format. \n\nInvalid probe output: ${stdout}`);
		}

		// Normalize size
		rawData.format.size = stat.size;

		// Normalize duration
		rawData.format.duration = (parseFloat(`${rawData.format.duration || 0}`) || 0) * 1000;

		streams = normalizeStreams(rawData);
	} catch (error) {
		throw new Error(`Unsupported format. Probing, parsing, or normalizing probed data failed: ${eem(error)}`);
	}

	// We determine the type of file based on the types of streams it contains
	let firstVideoStream: VideoStream | undefined;
	let firstAudioStream: AudioStream | undefined;
	let firstImageStream: ImageStream | undefined;
	let firstSubtitleStream: SubtitlesStream | undefined;

	for (const stream of streams) {
		if (stream.type === 'video' && !firstVideoStream) firstVideoStream = stream;
		if (stream.type === 'audio' && !firstAudioStream) firstAudioStream = stream;
		if (stream.type === 'image' && !firstImageStream) firstImageStream = stream;
		if (stream.type === 'subtitles' && !firstSubtitleStream) firstSubtitleStream = stream;
	}

	// Video
	if (firstVideoStream) {
		const duration = rawData.format.duration;

		if (!duration || duration <= 0) {
			throw new Error(`Unsupported format. Invalid format duration: ${JSON.stringify(rawData, null, 2)}`);
		}

		return {
			path: filePath,
			type: 'video',
			format: rawData.format.format_name,
			codec: firstVideoStream.codec,
			duration,
			title: rawData.format.tags?.title,
			framerate: firstVideoStream.framerate,
			width: firstVideoStream.width,
			height: firstVideoStream.height,
			size: rawData.format.size,
			streams,
			audioStreams: streams.filter(isAudioStream),
			subtitlesStreams: streams.filter(isSubtitlesStream),
		};
	}

	// Audio
	if (firstAudioStream) {
		const duration = rawData.format.duration;

		if (!duration || duration <= 0) {
			throw new Error(`Unsupported format. Invalid format duration: ${JSON.stringify(rawData, null, 2)}`);
		}

		return {
			path: filePath,
			type: 'audio',
			format: rawData.format.format_name,
			size: rawData.format.size,
			codec: firstAudioStream.codec,
			duration,
			channels: firstAudioStream.channels,
			language: firstAudioStream.language,
			cover: firstImageStream,
			album: rawData.format.tags?.album,
			genre: rawData.format.tags?.genre,
			title: rawData.format.tags?.title,
			artist: rawData.format.tags?.artist,
			album_artist: rawData.format.tags?.album_artist,
			track: rawData.format.tags?.track,
		};
	}

	// Image
	if (firstImageStream) {
		return {
			path: filePath,
			type: 'image',
			format: fileType, // ffprobe reports weird stuff like 'image2' for images
			size: rawData.format.size,
			codec: firstImageStream.codec,
			width: firstImageStream.width,
			height: firstImageStream.height,
		};
	}

	throw new Error(`Unknown file, unable to categorize probe data: ${JSON.stringify(rawData, null, 2)}`);
}

function normalizeStreams(rawData: RawProbeData): Stream[] {
	const rawStreams = rawData.streams;
	const seconds = rawData.format.duration / 1000;
	const streams: Stream[] = [];

	for (const rawStream of rawStreams) {
		const codec = normalizeCodecName(rawStream.codec_name);
		const extractError = (what: string) =>
			new Error(
				`Couldn't extract ${what} out of ${rawStream.codec_type} stream: ${JSON.stringify(rawStream, null, 2)}`
			);

		switch (rawStream.codec_type) {
			case 'subtitle': {
				streams.push({
					type: 'subtitles',
					codec,
					disposition: rawStream.disposition,
					language: rawStream.tags?.language,
					title: rawStream.tags?.title,
				});
				break;
			}

			case 'audio': {
				const channels = rawStream.channels;

				if (channels == null) throw extractError('channels');

				streams.push({
					type: 'audio',
					codec,
					channels,
					disposition: rawStream.disposition,
					language: rawStream.tags?.language,
					title: rawStream.tags?.title,
				});
				break;
			}

			case 'video': {
				const [frNum, frDen] = (rawStream.r_frame_rate || '').split('/').map((part) => parseFloat(part));
				const disposition = rawStream.disposition;
				const framerate = frNum && frDen ? frNum / frDen : false;
				const width = rawStream.width;
				const height = rawStream.height;

				if (typeof framerate !== 'number' || !Number.isFinite(framerate) || framerate <= 0) {
					throw extractError('framerate');
				}
				if (!Number.isInteger(width) || width < 1) throw extractError('width');
				if (!Number.isInteger(height) || height < 1) throw extractError('height');

				// Check if we are dealing with an image (single frame)
				// Checks if duration spans only 1 frame.
				// Or if the stream has a cover art disposition.
				if (
					!seconds ||
					Math.abs(seconds - 1 / framerate) < 0.02 ||
					disposition.attached_pic ||
					disposition.timed_thumbnails
				) {
					streams.push({
						type: 'image',
						codec,
						width,
						height,
						disposition: rawStream.disposition,
						title: rawStream.tags?.title || rawStream.tags?.comment,
					});
				} else {
					streams.push({
						type: 'video',
						codec,
						width,
						height,
						framerate,
						disposition: rawStream.disposition,
						title: rawStream.tags?.title,
					});
				}

				break;
			}
		}
	}

	return streams;
}

function normalizeCodecName(codecName: string) {
	const substitute = codecNameSubstitutes[codecName];
	return substitute ? substitute : codecName;
}

const codecNameSubstitutes: Record<string, string> = {
	mjpeg: 'jpeg',
};

function isAudioStream(value: Stream): value is AudioStream {
	return value.type === 'audio';
}

function isSubtitlesStream(value: Stream): value is SubtitlesStream {
	return value.type === 'subtitles';
}
