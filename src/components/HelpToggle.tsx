import {h, RenderableProps} from 'preact';
import {useState} from 'preact/hooks';
import {Button} from 'components/Button';
import {useShortcuts} from 'lib/hooks';
import * as shortcuts from 'config/shortcuts';
import {Scrollable} from 'components/Scrollable';

export function HelpToggle({children}: RenderableProps<{}>) {
	const [showHelp, setShowHelp] = useState(false);

	useShortcuts((id) => {
		switch (id) {
			case shortcuts.toggleHelp:
				setShowHelp(!showHelp);
				return true;
		}
	});

	return (
		<div class="HelpToggle">
			<div
				class={`content TextContent${showHelp ? ' -expanded' : ''}`}
				onWheel={(event) => event.stopPropagation()}
			>
				<Scrollable>
					{generalHelp}
					{children}
				</Scrollable>
			</div>
			<Button
				class="toggle"
				semitransparent={!showHelp}
				tooltip="Toggle help"
				onClick={() => setShowHelp(!showHelp)}
			>
				?
			</Button>
		</div>
	);
}

export const generalHelp = [
	<h3>General</h3>,
	<table>
		<tr>
			<td>
				<kbd>{shortcuts.submit}</kbd>
			</td>
			<td>submit encode</td>
		</tr>
		<tr>
			<td>
				<kbd>{shortcuts.cancel}</kbd>
			</td>
			<td>cancel encode</td>
		</tr>
		<tr>
			<td>
				<kbd>{shortcuts.toggleHelp}</kbd>
			</td>
			<td>toggle help</td>
		</tr>
	</table>,
];
