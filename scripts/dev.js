import { spawn } from 'node:child_process';

// A small runner rather than `a & b` with `trap`, because that shell syntax does not work on Windows.
const children = ['backend', 'frontend'].map((workspace) =>
  spawn(`npm run dev -w ${workspace}`, { stdio: 'inherit', shell: true }),
);

function stopAll() {
  for (const child of children) child.kill();
}

for (const child of children) child.on('exit', stopAll);
process.on('SIGINT', stopAll);
process.on('SIGTERM', stopAll);
