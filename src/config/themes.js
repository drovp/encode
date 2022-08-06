/** @type {any} */
const Color = require('colorjs.io').default;

function themeVariant({name, hue = 0, chroma = 0, min = 100, max = 900, step = 50, flipZ = false}) {
	const vars = {};
	const color = new Color('lch', [0, chroma, hue]);

	vars[`--${name}`] = `var(--${name}-500)`;

	// Color levels
	for (let level = min; level <= max; level += step) {
		const centerDiff = Math.abs(level - 500);
		const zLevel = flipZ ? 1000 - level : level;
		color.lch.l = (level / 1000) * 100;
		const saturationX = (500 - centerDiff) / 500;
		const saturation = 1 - Math.cos((saturationX * Math.PI) / 2);
		color.lch.c = chroma * saturation;
		vars[`--${name}-${level}`] = color.to('srgb').toString({format: 'hex'});
		vars[`--${name}-z${level}`] = `var(--${name}-${zLevel})`;
	}

	// Opacity levels
	color.lch.c = chroma;
	color.lch.l = 50;

	for (let i = 1; i <= 5; i++) {
		color.alpha = i / 10;
		vars[`--${name}-o${i * 100}`] = color.to('srgb').toString({format: 'hex'});
	}

	return vars;
}

themeVariant({name: 'success', hue: 130, chroma: 40});

module.exports = {
	lightTheme: {
		'--brand': '#a767fa',
		'--fg': 'var(--grey-100)',
		'--variant-fg': 'var(--grey-1000)',
		'--bg': 'var(--grey-850)',
		'--bg-darker': 'var(--grey-800)',
		'--bg-lighter': 'var(--grey-900)',
		'--curtain': '#0008',
		'--highlight': '#fff4',
		'--shadow': '#0003',
		'--top-o100': '#0001',

		'--lighten-900': '#fff',
		'--lighten-700': '#fffb',
		'--lighten-500': '#fff8',
		'--lighten-300': '#fff6',
		'--lighten-100': '#fff4',
		'--lighten': 'var(--lighten-500)',

		'--darken-900': '#0003',
		'--darken-700': '#0002',
		'--darken-500': '#0001',
		'--darken-300': '#00000009',
		'--darken-100': '#00000008',
		'--darken': 'var(--darken-500)',

		'--muted-900': 'rgba(0, 0, 0, .9)',
		'--muted-700': 'rgba(0, 0, 0, .7)',
		'--muted-500': 'rgba(0, 0, 0, .5)',
		'--muted-400': 'rgba(0, 0, 0, .4)',
		'--muted-300': 'rgba(0, 0, 0, .3)',
		'--muted-200': 'rgba(0, 0, 0, .2)',
		'--muted-100': 'rgba(0, 0, 0, .1)',
		'--muted-50:': 'rgba(0, 0, 0, .5)',
		'--muted': 'var(--muted-500)',

		...themeVariant({name: 'grey', min: 0, max: 1000, step: 50, flipZ: true}),
		...themeVariant({name: 'accent', hue: 300, chroma: 40, flipZ: true}),
		...themeVariant({name: 'success', hue: 130, chroma: 40, flipZ: true}),
		...themeVariant({name: 'info', hue: 240, chroma: 40, flipZ: true}),
		...themeVariant({name: 'warning', hue: 80, chroma: 40, flipZ: true}),
		...themeVariant({name: 'danger', hue: 26, chroma: 40, flipZ: true}),
	},
	darkTheme: {
		'--brand': '#B882FF',
		'--fg': 'var(--grey-900)',
		'--variant-fg': 'var(--grey-1000)',
		'--bg': 'var(--grey-150)',
		'--bg-darker': 'var(--grey-100)',
		'--bg-lighter': 'var(--grey-200)',
		'--curtain': '#0008',
		'--highlight': '#ffffff18',
		'--shadow': '#0003',
		'--top-o100': '#fff1',

		'--lighten-900': '#ffffff22',
		'--lighten-700': '#ffffff15',
		'--lighten-500': '#ffffff11',
		'--lighten-300': '#ffffff09',
		'--lighten-100': '#ffffff07',
		'--lighten': 'var(--lighten-500)',

		'--darken-900': '#0009',
		'--darken-700': '#0007',
		'--darken-500': '#0005',
		'--darken-300': '#0000003a',
		'--darken-100': '#0002',
		'--darken': 'var(--darken-500)',

		'--muted-900': 'rgba(255, 255, 255, .9)',
		'--muted-700': 'rgba(255, 255, 255, .7)',
		'--muted-500': 'rgba(255, 255, 255, .5)',
		'--muted-400': 'rgba(255, 255, 255, .4)',
		'--muted-300': 'rgba(255, 255, 255, .3)',
		'--muted-200': 'rgba(255, 255, 255, .2)',
		'--muted-100': 'rgba(255, 255, 255, .1)',
		'--muted-50': 'rgba(255, 255, 255, .05)',
		'--muted': 'var(--muted-500)',

		...themeVariant({name: 'grey', min: 0, max: 1000, step: 50}),
		...themeVariant({name: 'accent', hue: 300, chroma: 40}),
		...themeVariant({name: 'success', hue: 130, chroma: 40}),
		...themeVariant({name: 'info', hue: 240, chroma: 40}),
		...themeVariant({name: 'warning', hue: 80, chroma: 40}),
		...themeVariant({name: 'danger', hue: 26, chroma: 40}),
	},
};
