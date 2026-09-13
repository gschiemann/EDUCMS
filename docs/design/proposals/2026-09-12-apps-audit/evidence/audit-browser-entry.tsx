import React from 'react';
import { createRoot } from 'react-dom/client';
import { AppConfigForm } from './apps/web/src/components/apps/AppConfigForm';
import { getApp } from './apps/web/src/components/apps/app-registry';
const id = new URLSearchParams(location.search).get('app') || 'web-url';
createRoot(document.getElementById('root')!).render(<AppConfigForm app={getApp(id)!} onBack={() => {}} onDone={() => {}} />);
