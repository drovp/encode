import Sharp from 'sharp';

/**
 * Provides native import that won't be compiled away by ts/esbuild.
 */
export async function nativeImport(name: 'sharp'): Promise<typeof Sharp>;
export async function nativeImport<T = any>(name: string): Promise<T> {
	return (await (0, eval)(`import('${name}')`)).default as T;
}
