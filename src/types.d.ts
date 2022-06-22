type Rotation = 0 | 90 | 180 | 270;
interface Crop {
	x: number;
	y: number;
	width: number;
	height: number;
	sourceWidth: number;
	sourceHeight: number;
}

/**
 * [start, end] - in milliseconds
 */
type Cut = [number, number];
type Cuts = Cut[] | undefined;

type Theme = 'dark' | 'light';
type Variant = 'primary' | 'success' | 'info' | 'warning' | 'danger';
