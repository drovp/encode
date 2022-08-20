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

export const zoomTo100p = `${Ctrl_OR_Meta}+1`;
export const zoomToFit = `${Ctrl_OR_Meta}+0`;
export const holdToPan = `Shift`;

export const seekForward = 'ArrowRight';
export const seekBackward = 'ArrowLeft';

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
export const cutStart = 'ArrowUp';
export const cutEnd = 'ArrowDown';
export const cutDelete = 'Delete';
export const cutDeleteAll = 'Shift+Delete';

// Helpers

export function shortcutToAccelerator(shortcut: string) {
	return shortcut.replaceAll('Arrow', '');
}

/** Converts shortcut into a string user's can understand. */
export const humanShortcut = (modifiers: string) => (IS_MAC ? modifiers.replaceAll('Meta', 'Cmd') : modifiers);
