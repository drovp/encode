import {h, RenderableProps} from 'preact';
import {useRef, Ref} from 'preact/hooks';
import {useScrollableFades} from 'lib/hooks';

export type ScrollableProps = RenderableProps<{
	class?: string;
	direction?: 'horizontal' | 'vertical';
	style?: string;
	innerRef?: Ref<HTMLDivElement | null>;
	dangerouslySetInnerHTML?: {__html: string};
}>;

export function Scrollable({
	children,
	innerRef,
	class: className,
	style,
	direction = 'vertical',
	dangerouslySetInnerHTML,
}: ScrollableProps) {
	const containerRef = innerRef || useRef<HTMLDivElement>(null);

	useScrollableFades(containerRef, {direction});

	let classNames = `Scrollable -${direction}`;
	if (className) classNames += ` ${className}`;

	return (
		<div class={classNames} ref={containerRef} style={style} dangerouslySetInnerHTML={dangerouslySetInnerHTML}>
			{dangerouslySetInnerHTML ? undefined : children}
		</div>
	);
}
