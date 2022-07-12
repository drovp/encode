import {h, RenderableProps, ComponentChildren} from 'preact';
import {Pre} from 'components/Pre';
import {Spinner} from 'components/Spinner';

export type VacantProps = RenderableProps<{
	class?: string;
	variant?: Variant;
	loading?: boolean;
	title?: ComponentChildren;
	details?: string;
}>;

export function Vacant({class: className, variant, loading, title, children, details}: VacantProps) {
	let classNames = 'Vacant';
	if (className) classNames += ` ${className}`;
	if (variant) classNames += ` -${variant}`;

	return (
		<div class={classNames}>
			{loading && <Spinner />}
			{title && <h1>{title}</h1>}
			{children && <div class="content">{children}</div>}
			{details && (
				<Pre class="details" variant={variant}>
					{details}
				</Pre>
			)}
		</div>
	);
}
