import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname as pathDirname } from 'path';
import { fileURLToPath } from 'url';
import { build } from 'esbuild';
import { globSync } from 'glob';
import pkg from '../package.json' with { type: 'json' };

const __filename = fileURLToPath(import.meta.url);
const __dirname = pathDirname(__filename);

const ASSET_PATH = join(__dirname, '../src/assets');
const DIST_PATH = join(__dirname, '../dist/');

const green = '\x1b[32m';
const red = '\x1b[31m';
const reset = '\x1b[0m';

const success = `${green}✔${reset}`;
const failure = `${red}✗${reset}`;

const version = pkg.version;

async function processHtmlPages() {
    const indexFiles = globSync('**/index.html', { cwd: ASSET_PATH });
    const result = {};

    for (const relativeIndexPath of indexFiles) {
        const dir = pathDirname(relativeIndexPath);
        const base = (file) => join(ASSET_PATH, dir, file);

        let finalHtml = readFileSync(base('index.html'), 'utf8')
            .replaceAll('__VERSION__', version);

        if (dir !== 'error') {
            const styleCode = readFileSync(base('style.css'), 'utf8');
            const scriptCode = readFileSync(base('script.js'), 'utf8');
            finalHtml = finalHtml
                .replaceAll('__STYLE__', `<style>${styleCode}</style>`)
                .replaceAll('__SCRIPT__', scriptCode);
        }

        // 關鍵修改：使用 esbuild 支援的 raw 字串，避免 Unicode 轉義
        result[dir] = finalHtml;
    }

    console.log(`${success} Assets bundled successfully!`);
    return result;
}

async function buildWorker() {
    const htmls = await processHtmlPages();
    const faviconBuffer = readFileSync('./src/assets/favicon.ico');
    const faviconBase64 = faviconBuffer.toString('base64');

    const code = await build({
        entryPoints: [join(__dirname, '../src/worker.ts')],
        bundle: true,
        format: 'esm',
        write: false,
        external: ['cloudflare:sockets'],
        platform: 'browser',
        target: 'esnext',
        loader: { '.ts': 'ts' },
        define: {
            __PANEL_HTML_CONTENT__: JSON.stringify(htmls['panel'] ?? ''),
            __LOGIN_HTML_CONTENT__: JSON.stringify(htmls['login'] ?? ''),
            __ERROR_HTML_CONTENT__: JSON.stringify(htmls['error'] ?? ''),
            __SECRETS_HTML_CONTENT__: JSON.stringify(htmls['secrets'] ?? ''),
            __ICON__: JSON.stringify(faviconBase64),
            __VERSION__: JSON.stringify(version)
        },
        // 防止 Unicode 轉義
        charset: 'utf8'
    });

    console.log(`${success} Worker built successfully!`);

    const finalCode = code.outputFiles[0].text;
    const buildTimestamp = new Date().toISOString();
    const worker = `// Build: ${buildTimestamp}\n// @ts-nocheck\n${finalCode}`;

    mkdirSync(DIST_PATH, { recursive: true });
    writeFileSync('./dist/worker.js', worker, 'utf8');

    console.log(`${success} Done!`);
}

buildWorker().catch(err => {
    console.error(`${failure} Build failed:`, err);
    process.exit(1);
});
