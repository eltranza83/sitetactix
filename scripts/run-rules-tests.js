import { spawn } from 'node:child_process';
import path from 'node:path';

// Cross-platform helper: ensure Java 21 is reachable in environments where PATH wasn't reloaded
if (process.platform === 'win32') {
  const javaHome = process.env.JAVA_HOME || 'C:\\Program Files\\Eclipse Adoptium\\jdk-21.0.12.101-hotspot';
  const javaBin = path.join(javaHome, 'bin');
  if (!process.env.PATH.includes(javaBin)) {
    process.env.PATH = `${javaBin};${process.env.PATH}`;
  }
}

const cmd = 'npx firebase emulators:exec --only firestore "node --test test/firestoreRules.test.js"';

const child = spawn(cmd, { stdio: 'inherit', shell: true, env: process.env });

child.on('exit', (code) => {
  process.exit(code ?? 1);
});
