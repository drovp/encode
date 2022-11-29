import {useEffect, useRef, useState, useCallback, Ref, useLayoutEffect} from 'preact/hooks';
import {observeElementSize} from 'lib/elementSize';
import {isInteractiveElement, idKey, tapTheme} from 'lib/utils';
import {isEditingShortcut} from 'config/shortcuts';

/**
 * Binds event callback to an element ref or window when omitted.
 *
 * ```
 * const elementRef = useRef<HTMLElement>();
 * useEventListener('click', (event) => {}, elementRef);
 * ```
 */
export function useEventListener<E extends Event = Event>(
	name: string,
	callback: (event: E) => void,
	ref: Ref<HTMLElement | Window | null> = {current: window},
	options?: AddEventListenerOptions
) {
	useEffect(() => {
		ref.current?.addEventListener(name, callback as any, options);
		return () => ref.current?.removeEventListener(name, callback as any);
	}, [callback, ref.current]);
}

/**
 * Adds scrolling overflow fades to scrollable elements.
 *
 * ```
 * useScrollableFades(elementRef);
 * ```
 */
export function useScrollableFades(
	ref: Ref<HTMLElement | null>,
	{direction}: {direction?: 'horizontal' | 'vertical'} = {}
) {
	useEffect(() => {
		if (!ref.current) return;

		const isVertical = direction !== 'horizontal';
		const container = ref.current;

		let wasAtTop: boolean | null = null;
		let wasAtBottom: boolean | null = null;
		let wasScrollable: boolean | null = null;
		const leeway = 6;

		function check() {
			// These are all naive checks and un-reliable values due to all the
			// quirks around scrolling properties and dimensions. But they should
			// work for majority of use cases.
			const scrollStartMax = isVertical
				? container.scrollHeight - container.clientHeight
				: container.scrollWidth - container.clientWidth;
			const isScrollable = scrollStartMax > leeway;
			const isAtStart = !isScrollable || container[isVertical ? 'scrollTop' : 'scrollLeft'] < leeway;
			const isAtEnd =
				!isScrollable || container[isVertical ? 'scrollTop' : 'scrollLeft'] >= scrollStartMax - leeway;

			if (isScrollable !== wasScrollable) {
				container.classList[isScrollable ? 'add' : 'remove']('-scrollable');
				wasScrollable = isScrollable;
			}
			if (isAtStart !== wasAtTop) {
				container.classList[isAtStart ? 'remove' : 'add'](`-overflow-${isVertical ? 'top' : 'left'}`);
				wasAtTop = isAtStart;
			}
			if (isAtEnd !== wasAtBottom) {
				container.classList[isAtEnd ? 'remove' : 'add'](`-overflow-${isVertical ? 'bottom' : 'right'}`);
				wasAtBottom = isAtEnd;
			}
		}

		// Initial set on load
		check();

		// Set on scroll & resize
		const disposeElementResizeObserver = observeElementSize(ref.current, check);
		container.addEventListener('scroll', check);

		return () => {
			disposeElementResizeObserver();
			container.removeEventListener('scroll', check);
		};
	}, [ref, ref.current]);
}

/**
 * Sets up element Resize Observer, extracts element sizes, and returns them as
 * a `[number, number]` tuple. Initial call returns `[null, null]`.
 *
 * Note: uses `observeElementSize` utility, which throttles all dimension
 * retrieval from all of its consumers to a 1-2 frame interval, and then batches
 * it all before triggering callbacks (commits). This eliminates layout trashing
 * to allow fast UI rendering with no stutters and CPU meltdowns when you drag
 * something. The disadvantage is that initial dimension retrieval is impossible
 * to get before 1st render. If this is needed, a custom useLayoutEffect solution
 * with `tapElementSize` utility is required.
 *
 * ```ts
 * const containerRef = useRef<HTMLElement>();
 * const [width, height] = useElementSize(containerRef, 'content-box');
 * ```
 */
export function useElementSize(ref: Ref<HTMLElement | null>, box: 'border-box' | 'padding-box' = 'border-box') {
	const [sizes, setSizes] = useState<[number, number] | [null, null]>([null, null]);

	useLayoutEffect(() => {
		if (!ref.current) throw new Error(`Element reference is empty.`);
		return observeElementSize(ref.current, setSizes, {box});
	}, [box]);

	return sizes;
}

/**
 * Remembers element's scroll position, and recovers it next time the element is
 * created.
 */
export function useScrollPosition(id: string, ref: Ref<HTMLElement | null>, {delay = 0}: {delay?: number} = {}) {
	const cacheId = `${id}.scrollPosition`;
	let [scrollPosition, setScrollPosition] = useCache<number>(cacheId, 0);

	useLayoutEffect(() => {
		const container = ref.current;
		if (!container) return;
		const set = () => (container.scrollTop = scrollPosition);
		const savePosition = () => setScrollPosition(container.scrollTop);

		if (delay > 0) setTimeout(set, delay);
		else set();

		container.addEventListener('scroll', savePosition);

		return () => container.removeEventListener('scroll', savePosition);
	}, []);

	return () => setScrollPosition(0);
}

/**
 * Retrieves/saves value to store cache: a non-reactive storage with an optional
 * expiration timeout.
 *
 * ```
 * const [value, setValue] = useCachedState('cache.value.identifier', 'default value');
 * ```
 */
export function useCache<T>(key: unknown, defaultValue: T, timeout?: number): [T, (value: T) => void] {
	return [
		(CACHE.has(key) ? CACHE.get(key)!.value : defaultValue) as T,
		(value: T, timeoutOverride?: number) => {
			const old = CACHE.get(key);
			if (old?.timeoutId != null) clearTimeout(old.timeoutId);
			const requestedTimeout = timeoutOverride ?? timeout;
			const timeoutId = requestedTimeout ? setTimeout(() => CACHE.delete(key), requestedTimeout) : null;
			CACHE.set(key, {timeoutId, value});
		},
	];
}

const CACHE = new Map<any, {timeoutId: ReturnType<typeof setTimeout> | null; value: unknown}>();
const CACHE_SUBS = new Map<unknown, Set<() => void>>();

function registerCacheSub(key: unknown, reload: () => void) {
	let maybeSet = CACHE_SUBS.get(key);
	if (!maybeSet) {
		maybeSet = new Set<() => void>();
		CACHE_SUBS.set(key, maybeSet);
	}
	const set = maybeSet;
	set.add(reload);
	return () => set.delete(reload);
}

function triggerCacheSubs(key: unknown) {
	let set = CACHE_SUBS.get(key);
	if (set) {
		for (const trigger of set) trigger();
	}
}

/**
 * Same as `useCache()`, but redraws current component on `setValue()`.
 *
 * ```
 * const [value, setValue] = useCachedState('cache.value.identifier', 'default value');
 * ```
 */
export function useCachedState<T>(key: unknown, defaultValue: T, timeout?: number): [T, (value: T) => void] {
	const [value, setCache] = useCache<T>(key, defaultValue, timeout);
	const forceUpdate = useForceUpdate();

	useLayoutEffect(() => registerCacheSub(key, forceUpdate), [key]);

	return [
		value,
		(value: T) => {
			setCache(value);
			triggerCacheSubs(key);
		},
	];
}

/**
 * Creates function that re-renders current component when called.
 *
 * ```
 * const forceUpdate = useForceUpdate();
 * forceUpdate();
 * ```
 */
export function useForceUpdate() {
	const [, setState] = useState(NaN);
	return useCallback(() => setState(NaN), [setState]);
}

/**
 * Returns current theme.
 */
export function useTheme(ref: Ref<HTMLElement | null>, initial: Theme = 'dark') {
	const [theme, setTheme] = useState(initial);

	useLayoutEffect(() => {
		const element = ref.current;
		if (element) return tapTheme(element, setTheme);
	}, []);

	return theme;
}

/**
 * Handler should return `true` if the shortcut was been used.
 * This will prevent default actions.
 */
export function useShortcuts(handler: (shortcutId: string, event: KeyboardEvent) => boolean | undefined | null) {
	const handlerRef = useRef(handler);
	handlerRef.current = handler;

	useEffect(() => {
		function handleKeyDown(event: KeyboardEvent) {
			const activeElement = document.activeElement;
			const id = idKey(event);
			if (!(isInteractiveElement(activeElement) && isEditingShortcut(id)) && handlerRef.current(id, event)) {
				event.preventDefault();
				event.stopPropagation();
			}
		}

		addEventListener('keydown', handleKeyDown);
		return () => removeEventListener('keydown', handleKeyDown);
	}, []);
}
