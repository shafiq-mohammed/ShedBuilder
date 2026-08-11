import './style.css';
import { App } from './app';

const app = new App();
app.mount(document.getElementById('app')!);

// dev convenience
(window as any).shedApp = app;
