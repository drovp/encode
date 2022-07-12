import {isInputAbleElement} from 'lib/utils';

type NavigationType = 'pointer' | 'keyboard';

interface NavigationSpyOptions {
	minPointerMoveDistance?: number;
	startType?: NavigationType;
	pointerTravelResetTimeout?: number;
}

export interface NavigationTypeSpy {
	get(): string | undefined;
	set(type: NavigationType): void;
	dispose(): void;
}

/**
 * Marks target element with data specifying currently used navigation
 * type. Can be: `keyboard` or `pointer`.
 *
 * Usage:
 *
 * ```
 * const {dispose} = makeNavigationTypeSpy(document.body);
 * dispose(); // terminate spy
 * ```
 *
 * `<body>` will now have `[data-nav-type=pointer]` attribute when last
 * navigation type was mouse or touch, or `[data-nav-type=keyboard]` when
 * keyboard.
 */
export function makeNavigationTypeSpy(
	target: HTMLElement,
	{startType = 'pointer'}: NavigationSpyOptions = {}
): NavigationTypeSpy {
	let disposed = false;
	const get = disposedGated(() => target.dataset.navType);
	const set = disposedGated((type: NavigationType) => {
		target.dataset.navType = type === 'pointer' ? 'pointer' : 'keyboard';
	});

	function disposedGated<T extends (...args: any[]) => any>(fn: T) {
		return (...args: Parameters<T>) => {
			if (disposed) throw new Error(`Attempt to modify disposed navigationTypeSpy.`);
			return fn(...args) as ReturnType<T>;
		};
	}

	// Set initial navigation type
	set(startType);

	// Event handlers

	function onPointerDown() {
		set('pointer');
	}

	function onKeyDown({keyCode, altKey, ctrlKey, metaKey, target}: KeyboardEvent) {
		const isTab = keyCode === 9;
		const isArrow = keyCode >= 37 && keyCode <= 40;

		if (!isTab && !isArrow) return;
		if (isTab && (ctrlKey || altKey || metaKey)) return;
		if (isArrow && isInputAbleElement(target)) return;
		if (target instanceof HTMLElement) set('keyboard');
	}

	// Bind initial listeners
	window.addEventListener('pointerdown', onPointerDown);
	window.addEventListener('keydown', onKeyDown);

	// Return function that cleans up and terminates all listeners
	return {
		set,
		get,
		dispose: () => {
			disposed = true;
			window.removeEventListener('pointerdown', onPointerDown);
			window.removeEventListener('keydown', onKeyDown);
			delete target.dataset.navType;
		},
	};
}
