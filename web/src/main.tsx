import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import './themes/index';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <h1>Ember</h1>
  </StrictMode>,
);
