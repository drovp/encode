import {h, RenderableProps} from 'preact';
import {useRef} from 'preact/hooks';
import {useScrollableFades} from 'lib/hooks';

export type PreProps = RenderableProps<{
	class?: string;
	variant?: Variant;
}>;

export function Pre({class: className = '', variant, children}: PreProps) {
	const preRef = useRef<HTMLPreElement>(null);

	useScrollableFades(preRef);

	return (
		<div class={`Pre ${className}${variant ? ` -${variant}` : ''}`}>
			<pre ref={preRef}>
				<code>{children}</code>
			</pre>
		</div>
	);
}
