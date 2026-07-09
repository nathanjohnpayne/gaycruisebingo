import { defineConfig } from 'vite';

// Vitest "functions" layer. The specs under tests/functions/ import
// functions/src, whose modules resolve resend / firebase-admin /
// firebase-functions from functions/node_modules (declared only in
// functions/package.json). `npm run test:functions` installs those deps first,
// so this config is deliberately NOT part of the root `npm test` include —
// keeping the root run self-contained on root deps for clean CI.
//
// The specs themselves inject every SDK dependency (pure logic + DI), so no
// live Resend/Firestore/Auth is touched; a node environment is enough.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/functions/**/*.test.ts'],
  },
});
