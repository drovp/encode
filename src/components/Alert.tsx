import {h, RenderableProps} from 'preact';

export type AlertProps = RenderableProps<{
	variant?: Variant;
	compact?: boolean;
	center?: boolean;
}>;

export function Alert({variant = 'primary', compact, center, children}: AlertProps) {
	let classNames = `Alert -${variant}`;
	if (compact) classNames += ' -compact';
	if (center) classNames += ' -center';
	return <div class={classNames}>{children}</div>;
}
