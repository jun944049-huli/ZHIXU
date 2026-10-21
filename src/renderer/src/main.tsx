import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import '../../../prototype/styles.css';

const scripts = [
  'data.js', 'storage.js', 'shared.js', 'views-core.js', 'views-chat.js',
  'views-project.js', 'views-output.js', 'modals.js', 'operations.js', 'app.js'
];

function Workbench() {
  const [error, setError] = useState('');
  useEffect(() => {
    // Keep the approved workbench while its views are migrated individually.
    void (async () => {
      for (const file of scripts) {
        await new Promise<void>((resolve, reject) => {
          const script = document.createElement('script');
          script.src = new URL(file, document.baseURI).href;
          script.onload = () => resolve();
          script.onerror = () => reject(new Error(`无法加载 ${file}`));
          document.body.append(script);
        });
      }
    })().catch(cause => setError(String(cause)));
  }, []);

  return <>
    {error && <p role="alert">{error}</p>}
    <div className="app">
      <div id="sidebar-root" style={{ display: 'contents' }} />
      <div className="main">
        <div id="topbar-root" style={{ display: 'contents' }} />
        <main className="view" id="view" />
      </div>
    </div>
    <div id="modal-root" />
    <div id="toast-root" />
  </>;
}

createRoot(document.getElementById('root')!).render(<Workbench />);
