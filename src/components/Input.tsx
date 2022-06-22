import {h, RenderableProps} from 'preact';
import {useRef, Ref} from 'preact/hooks';
import {TargetedEvent, countDecimals, clamp} from 'lib/utils';

export type StringProps = RenderableProps<{
	id?: string;
	name?: string;
	type?: 'text' | 'number';
	placeholder?: string | number;
	value?: string | number;
	class?: string;
	tooltip?: string;
	variant?: Variant;
	min?: number;
	max?: number;
	step?: number;
	cols?: number;
	spellcheck?: boolean;
	onChange?: (value: string) => void;
	onSubmit?: (event: KeyboardEvent) => void;
	onClick?: (event: TargetedEvent<HTMLInputElement>) => void;
	disabled?: boolean;
	readonly?: boolean;
	innerRef?: Ref<HTMLInputElement | null>;
}>;

export function Input({
	id,
	name,
	type = 'text',
	placeholder,
	class: className,
	tooltip,
	value,
	variant,
	min,
	max,
	step,
	cols: softMax,
	onChange,
	onSubmit,
	disabled,
	spellcheck,
	innerRef,
	...rest
}: StringProps) {
	const inputRef = innerRef || useRef<HTMLInputElement>(null);
	const valueRef = useRef<string | null>(null);

	function handleInput(event: TargetedEvent<HTMLInputElement, Event>) {
		const value = event.currentTarget.value;
		valueRef.current = value;
		onChange?.(value);
	}

	function handleKeyDown(event: TargetedEvent<HTMLInputElement, KeyboardEvent>) {
		if (event.key === 'Enter') onSubmit?.(event);
		else if (type === 'number') handleNumberInputKeyDown(event, {min, max, step});
	}

	// Set variant to danger when value doesn't adhere to min/max/step options
	if (type === 'number') {
		const numberValue = parseFloat(valueRef.current ?? `${value}`);
		if (Number.isFinite(numberValue)) {
			if (
				(max != null && numberValue > max) ||
				(min != null && numberValue < min) ||
				(step != null && numberValue % step !== 0)
			) {
				variant = 'danger';
			}
		}
	}

	let classNames = `Input -${type}`;
	if (className) classNames += ` ${className}`;
	if (variant) classNames += ` -${variant}`;
	if (disabled) classNames += ` -disabled`;

	const inputSize = max || softMax;

	return (
		<div class={classNames} style={inputSize ? `max-width:${inputSize * 0.8}em` : undefined} title={tooltip}>
			<input
				{...rest}
				onKeyDown={handleKeyDown}
				placeholder={`${placeholder ?? ''}`}
				ref={inputRef}
				onInput={handleInput}
				id={id}
				name={name}
				type={type}
				spellcheck={spellcheck === true}
				minLength={min}
				maxLength={max}
				disabled={disabled}
				value={value == null ? '' : value}
			/>
		</div>
	);
}

/**
 * Handles keydown for number based input elements that enables
 * value incrementing/decrementing with Up/Down keyboard arrows.
 *
 * Modifiers:
 * shift      - 10
 * ctrl+shift - 100
 * alt        - 0.1
 * ctrl+alt   - 0.01
 */
function handleNumberInputKeyDown(
	event: TargetedEvent<HTMLInputElement, KeyboardEvent>,
	{min = -Infinity, max = Infinity, step}: {min?: number; max?: number; step?: number} = {}
) {
	if (event.key !== 'ArrowUp' && event.key !== 'ArrowDown') return;

	const target = event.currentTarget;
	const targetValue = target.value.trim();
	const baseAmount = step ?? 1;
	const allowFractions = step !== null;

	if (/^\d+(\.\d+)?$/.exec(targetValue) == null) return;

	const value = !targetValue ? 0 : parseFloat(targetValue);

	if (Number.isFinite(value)) {
		event.preventDefault();

		let amount: number;
		if (event.ctrlKey && event.shiftKey) amount = baseAmount * 100;
		else if (allowFractions && (event.ctrlKey || event.metaKey) && event.altKey) amount = baseAmount * 0.01;
		else if (event.shiftKey) amount = baseAmount * 10;
		else if (allowFractions && event.altKey) amount = baseAmount * 0.1;
		else amount = baseAmount;

		const decimalRounder = Math.pow(10, Math.max(countDecimals(value), countDecimals(amount)));
		const add = event.key === 'ArrowDown' ? -amount : amount;

		// This gets rid of the floating point imprecision noise
		target.value = String(clamp(min, Math.round((value + add) * decimalRounder) / decimalRounder, max));

		target.dispatchEvent(new Event('input', {bubbles: true, cancelable: true}));
	}
}
