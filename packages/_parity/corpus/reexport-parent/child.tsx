import { UiButton } from './barrel';

export const Fancy = UiButton.extend().styles({ display: 'flex' }).asElement('button');
export const B = () => <Fancy size="lg" />;
