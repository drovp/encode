const Path = require('path');
const {src, dest, series, parallel, watch: gulpWatch} = require('gulp');

/**
 * Build config.
 */
const PATHS = {
	assets: ['src/*.html', 'src/assets/**/*'],
	build: 'dist',
	scripts: 'src/**/*.ts(|x)',
	styles: 'src/**/*.sass',
	themesFile: Path.join(__dirname, 'src', 'config', 'themes.js'),
};
// prettier-ignore
const NODE_MODULES = [
	'assert', 'buffer', 'child_process', 'cluster', 'crypto', 'dgram', 'dns', 'domain', 'events', 'fs', 'http', 'https', 'net', 'os', 'path', 'punycode', 'querystring', 'readline', 'stream', 'string_decoder', 'timers', 'tls', 'tty', 'url', 'util', 'v8', 'vm', 'zlib'
];

function clean() {
	return require('del')(PATHS.build);
}

async function scripts() {
	const esbuild = require('esbuild');

	return esbuild.build({
		entryPoints: ['src/index.ts', 'src/processor.ts', 'src/editor.tsx', 'src/sharpLoader.ts'],
		external: [...NODE_MODULES, ...NODE_MODULES.map((name) => `node:${name}`), 'electron'],
		format: 'cjs',
		target: ['node15.0.0', 'es2018'],
		logLevel: 'warning',
		bundle: true,
		minify: false,
		// Sourcemaps are useless atm. All errors are reported from wrong places.
		// Might be electron dev tools getting confused or something.
		// sourcemap: ENV.NODE_ENV === 'production' ? false : 'inline',
		outdir: PATHS.build,
		outbase: 'src',
	});
}

function styles() {
	const sassGlob = require('gulp-sass-glob');
	const postcss = require('gulp-postcss');
	const sass = require('gulp-dart-sass');
	const sassOptions = {
		includePaths: ['src'],
	};

	// Delete themes file from require cache so that it gets reloaded
	delete require.cache[PATHS.themesFile];

	/** @type any[] */
	const postCssPlugins = [
		require('postcss-prune-var')(),
		require('postcss-preset-env')({stage: 0, browsers: 'chrome 89'}),
		require('postcss-declarations')(require(PATHS.themesFile)),
	];

	return src('src/*.sass', {base: 'src'})
		.pipe(sassGlob())
		.pipe(sass(sassOptions).on('error', sass.logError))
		.pipe(postcss(postCssPlugins))
		.pipe(dest(PATHS.build));
}

function assets() {
	return src(PATHS.assets, {base: 'src'}).pipe(dest(PATHS.build));
}

async function watch() {
	// Scripts
	gulpWatch(PATHS.scripts, scripts);

	// Styles
	gulpWatch([PATHS.styles, PATHS.themesFile], styles);

	// Assets
	// @ts-ignore
	const assetsWatcher = gulpWatch(PATHS.assets, {events: ['add', 'change']}, assets);
	assetsWatcher.on('unlink', (path) => {
		require('del')(String(path).replace(/^src/, PATHS.build));
	});
}

const build = series(clean, parallel(assets, styles, scripts));

exports.clean = clean;
exports.scripts = scripts;
exports.styles = styles;
exports.assets = assets;
exports.watch = watch;
exports.build = build;
exports.default = series(build, watch);
