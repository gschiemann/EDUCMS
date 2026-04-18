const fs = require('fs');
const cp = require('child_process');

try {
  cp.execSync('npx tsc --noEmit -p apps/web/tsconfig.json', { encoding: 'utf8' });
} catch (e) {
  const output = e.stdout + '\n' + e.stderr;
  const lines = output.split('\n');
  const fileLinesToFix = new Set();
  
  for (const line of lines) {
    // apps/web/src/components/widgets/WidgetRenderer.tsx(91,82): error TS2322...
    const match = line.match(/WidgetRenderer\.tsx\((\d+),/);
    if (match) {
      fileLinesToFix.add(parseInt(match[1], 10));
    }
  }

  let content = fs.readFileSync('apps/web/src/components/widgets/WidgetRenderer.tsx', 'utf8');
  let cLines = content.split('\n');
  
  for (const lineNum of fileLinesToFix) {
    if (lineNum > 0 && lineNum <= cLines.length) {
      cLines[lineNum - 1] = cLines[lineNum - 1].replace(/ compact=\{compact\}/g, '');
    }
  }

  fs.writeFileSync('apps/web/src/components/widgets/WidgetRenderer.tsx', cLines.join('\n'));
  console.log('Fixed lines:', Array.from(fileLinesToFix));
}
