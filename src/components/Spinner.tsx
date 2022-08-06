import {h} from 'preact';

export interface SpinnerProps {
	class?: string;
	variant?: Variant;
}

export const Spinner = ({class: className, variant}: SpinnerProps) => (
	<div className={`Spinner${className ? ` ${className}` : ''}${variant ? ` -${variant}` : ''}`} />
);
