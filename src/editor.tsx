import {h, render} from 'preact';
import {promises as FSP} from 'fs';
import * as Path from 'path';
import {getPayload, resolve} from '@drovp/utils/modal-window';
import {eem, uid, isCropValid} from 'lib/utils';
import {makeNavigationTypeSpy} from 'lib/navigationTypeSpy';
import {PreparatorPayload} from './';
import {App} from 'components/App';
import {Spinner} from 'components/Spinner';
import {Vacant} from 'components/Vacant';

makeNavigationTypeSpy(document.documentElement);

const container = document.getElementById('app-container')!;

window.addEventListener('keydown', (event) => {
	switch (event.key) {
		// Reload window
		case 'F5':
			window.location.reload();
			break;

		// Reload styles
		case 'F6':
			for (const link of document.querySelectorAll<HTMLLinkElement>('link[rel=stylesheet]')) {
				link.href = link.href.replace(/\?\w+$/, '') + `?${uid()}`;
			}
			break;

		// Toggle theme
		case 'F8':
			const currentTheme = document.documentElement.dataset.theme;
			document.documentElement.dataset.theme = currentTheme === 'dark' ? 'light' : 'dark';
			event.preventDefault();
			break;
	}
});

render(<Spinner />, container);

getPayload<PreparatorPayload>()
	.then((payload) => {
		// Respect app settings
		document.documentElement.style.setProperty('--font-size', `${payload.settings?.fontSize || 13}px`);

		const theme = payload.settings?.theme || 'os';
		if (theme === 'os') {
			const darkModeMediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
			document.documentElement.dataset.theme = darkModeMediaQuery.matches ? 'dark' : 'light';
			darkModeMediaQuery.addEventListener('change', (event) => {
				document.documentElement.dataset.theme = event.matches ? 'dark' : 'light';
			});
		} else {
			document.documentElement.dataset.theme = theme;
		}

		const compact = payload.settings?.compact;
		if (compact) document.documentElement.dataset.uimode = 'compact';

		const editorDataPath = Path.join(payload.dataPath, 'editor_data.json');

		async function loadEditorData(): Promise<EditorData> {
			const initData: EditorData = {};
			try {
				const json = await FSP.readFile(editorDataPath, {encoding: 'utf-8'});
				const data = JSON.parse(json);
				return {...initData, previousCrop: isCropValid(data.previousCrop) ? data.previousCrop : undefined};
			} catch {
				return initData;
			}
		}

		async function saveEditorData(data: EditorData) {
			try {
				await FSP.writeFile(editorDataPath, JSON.stringify(data));
			} catch {}
		}

		loadEditorData().then((editorData) => {
			// Render the app
			render(
				<App
					preparatorPayload={payload}
					editorData={editorData}
					onSubmit={async (payload) => {
						await saveEditorData({previousCrop: payload.edits?.crop});
						resolve(payload);
					}}
					onCancel={async () => window.close()}
				/>,
				container
			);
		});
	})
	.catch((error) => {
		console.error(error);
		render(<Vacant variant="danger" title="Error:" details={eem(error)} />, container);
	});
