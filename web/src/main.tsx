import './shared/ui/global.css';
import { bootstrap } from './app/bootstrap';

const container = document.getElementById('root');
if (!container) throw new Error('Elemento #root ausente no index.html.');
void bootstrap(container);
