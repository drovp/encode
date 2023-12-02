export const IS_MAC = process.platform === 'darwin';
export const Ctrl_OR_Meta = IS_MAC ? 'Meta' : 'Ctrl';
export const Ctrl_OR_Cmd = IS_MAC ? 'Cmd' : 'Ctrl';
export const Control_OR_Command = IS_MAC ? 'Control' : 'Command';

// Drop modifiers
export const openEditor = `Ctrl`;
export const concatInputs = `Alt`;
export const concatAndOpenEditor = `Alt+Ctrl`;

// Editor shortcuts
export const submit = `${Ctrl_OR_Meta}+Enter`;
export const cancel = `${Ctrl_OR_Meta}+Escape`;
export const toggleHelp = `/`;

export const zoomIn = `${Ctrl_OR_Meta}++`;
export const zoomOut = `${Ctrl_OR_Meta}+-`;
export const zoomTo100p = `${Ctrl_OR_Meta}+1`;
export const zoomToFit = `${Ctrl_OR_Meta}+0`;
export const centerView = `c`;
export const holdToPan = `Shift`;

export const seekForward = 'ArrowRight';
export const seekBackward = 'ArrowLeft';
export const seekTo10p = '1';
export const seekTo20p = '2';
export const seekTo30p = '3';
export const seekTo40p = '4';
export const seekTo50p = '5';
export const seekTo60p = '6';
export const seekTo70p = '7';
export const seekTo80p = '8';
export const seekTo90p = '9';

export const seekFrameModifier = 'Alt';
export const seekMoreModifier = 'Shift';
export const seekMediumModifier = Ctrl_OR_Meta;
export const seekBigModifier = `${Ctrl_OR_Meta}+Shift`;

export const seekToStart = 'Home';
export const seekToEnd = 'End';
export const seekToPrevCutPoint = 'PageUp';
export const seekToNextCutPoint = 'PageDown';

export const playToggle = ' ';

export const volumeUp = '+';
export const volumeDown = '-';
export const zoomTimelineIn = `Shift++`;
export const zoomTimelineOut = `Shift+-`;

export const crop = 'x';
export const useLastCrop = 'Shift+X';
export const cropDetect = `${Ctrl_OR_Meta}+x`;
export const cutStart = 'ArrowUp';
export const cutEnd = 'ArrowDown';
export const cutStartTiny = 'Shift+ArrowUp';
export const cutEndTiny = 'Shift+ArrowDown';
export const cutDelete = 'Delete';
export const cutDeleteAll = 'Shift+Delete';
export const cutSplit = 's';

// Helpers

export function shortcutToAccelerator(shortcut: string) {
	return shortcut.replaceAll('Arrow', '');
}

/** Converts shortcut into a string user's can understand. */
export const humanShortcut = (modifiers: string) =>
	(IS_MAC ? modifiers.replaceAll('Meta', 'Cmd') : modifiers).replaceAll('Arrow', '');

/**
 * Checks if shortcut is used by text editing or controlling interactive elements.
 */
export const isEditingShortcut = (() => {
	// prettier-ignore
	const editingShortcuts = new Set([
		'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown',
		'Enter', 'Backspace', 'Delete', 'Home', 'End',
		`${Ctrl_OR_Meta}+a`, `${Ctrl_OR_Meta}+c`, `${Ctrl_OR_Meta}+v`, `${Ctrl_OR_Meta}+x`,
		`${Ctrl_OR_Meta}+z`, `${Ctrl_OR_Meta}+Shift+z`
	]);

	return (id: string) => id.length === 1 || editingShortcuts.has(id);
})();
