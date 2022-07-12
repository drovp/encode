import * as Path from 'path';
import * as OS from 'os';

export const FALLBACK_AUDIO_DIRECTORY = Path.join(OS.tmpdir(), 'drovp-encode-fallback-audio');
