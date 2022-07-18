/**
 * This file is intended to be used as a node input file with an image as next
 * parameter.
 *
 * It then emits sharp image meta JSON, and image raw data as binary stream
 * delimited by a magic delimiter.
 */
import {nativeImport} from 'lib/nativeImport';
import {META_DATA_BINARY_DELIMITER} from 'config';

const path = process.argv[process.argv.length - 1];

(async () => {
	if (!path) throw new Error(`Missing input path parameter.`);
	const sharp = await nativeImport('sharp');
	const image = sharp(path);
		const meta = await image.metadata();
		process.stdout.write(Buffer.from(JSON.stringify(meta)));
		process.stdout.write(META_DATA_BINARY_DELIMITER);
		const buffer = await image.ensureAlpha().raw().toBuffer();
		process.stdout.write(buffer);
})();
