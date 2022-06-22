import {h, render, ComponentChild, Fragment} from 'preact';
import {eem} from 'lib/utils';
import {Icon} from 'components/Icon';
import {Pre} from 'components/Pre';

export function openDialog({
	title,
	modal = false,
	align = 'center',
	content,
	onClose,
}: {
	title: string;
	modal?: boolean;
	align?: 'center' | 'top' | 'bottom';
	content: ComponentChild;
	onClose?: () => void;
}) {
	const dialog = document.createElement('dialog') as any; // Missing HTMLDialogElement types

	dialog.className = `Dialog -${align}`;

	// Can't use click, because when someone tries dragging the header, it
	// triggers click event on the DIALOG element even though it didn't
	// originate there... life is suffering.
	dialog.addEventListener('pointerup', (event: MouseEvent) => {
		if (event.target === dialog) close();
	});

	function close() {
		dialog.close();
		dialog.remove();
		render(null, dialog);
		onClose?.();
	}

	render(
		<Fragment>
			<header>
				<div class="title">{title}</div>
				<button class="close" onClick={close}>
					<Icon name="x" />
				</button>
			</header>
			{content}
		</Fragment>,
		dialog
	);

	document.body.appendChild(dialog);

	setTimeout(() => (modal ? dialog.showModal() : dialog.show()), 16);
}

export function DialogErrorContent({message, error}: {message: string; error: any}) {
	return (
		<div className="DialogErrorContent">
			<div className="message">{message}</div>
			<Pre>{eem(error)}</Pre>
		</div>
	);
}
