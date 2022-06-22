import {h} from 'preact';
import {useRef, useEffect} from 'preact/hooks';
import {drawImageToCanvas} from 'lib/utils';

export interface ImageViewProps {
	class?: string;
	data: ImageData;
	rotate?: Rotation;
	flipHorizontal?: boolean;
	flipVertical?: boolean;
}

export function ImageView({class: className, data, rotate, flipHorizontal, flipVertical}: ImageViewProps) {
	const canvasRef = useRef<HTMLCanvasElement>(null);

	// Draw to canvas
	useEffect(() => {
		const canvas = canvasRef.current;
		if (canvas && data) drawImageToCanvas(canvas, data, {rotate, flipHorizontal, flipVertical});
	}, [data, rotate, flipHorizontal, flipVertical]);

	let classNames = 'ImageView';
	if (className) classNames += ` ${className}`;

	return <canvas ref={canvasRef} class={classNames} />;
}
