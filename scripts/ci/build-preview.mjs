import { spawn } from 'node:child_process';

// Public UX preview uses prototype data only, never private proof credentials.
const child = spawn(process.platform === 'win32' ? 'pnpm.cmd' : 'pnpm', ['build:pwa'], {
  stdio: 'inherit',
  env: {
    ...process.env,
    KARMA_BASE_PATH: '/karma/',
    KARMA_PREVIEW_BUILD: '1',
    VITE_SUPABASE_URL: '',
    VITE_SUPABASE_ANON_KEY: '',
    VITE_DEMO_BRANCH_ID: '',
    VITE_DEMO_DEVICE_ID: '',
  },
});
child.on('error', () => { process.exitCode = 1; });
child.on('exit', (code) => { process.exitCode = code ?? 1; });
