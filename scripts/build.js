import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname as pathDirname } from 'path';
import { fileURLToPath } from 'url';
import { build } from 'esbuild';
import { globSync } from 'glob';
import JSZip from "jszip";
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

        let indexHtml = readFileSync(base('index.html'), 'utf8');
        let finalHtml = indexHtml.replaceAll('__VERSION__', version);

        if (dir !== 'error') {
            const styleCode = readFileSync(base('style.css'), 'utf8');
            const scriptCode = readFileSync(base('script.js'), 'utf8');

            // 直接原样嵌入，不压缩、不混淆
            finalHtml = finalHtml
                .replaceAll('__STYLE__', `<style>${styleCode}</style>`)
                .replaceAll('__SCRIPT__', scriptCode);
        }

        // 直接存储原始 HTML 字符串（JSON 转义保证合法）
        result[dir] = JSON.stringify(finalHtml);
        console.log(`  ${dir} → raw HTML string`);
    }

    console.log(`${success} Assets processed.`);
    return result;
}

async function buildWorker() {
    const htmls = await processHtmlPages();

    // favicon 保留 base64（因为它是二进制图片数据）
    const faviconBuffer = readFileSync('./src/assets/favicon.ico');
    const faviconBase64 = faviconBuffer.toString('base64');

    // esbuild 打包
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
            __PANEL_HTML_CONTENT__: htmls['panel'] ?? '""',
            __LOGIN_HTML_CONTENT__: htmls['login'] ?? '""',
            __ERROR_HTML_CONTENT__: htmls['error'] ?? '""',
            __SECRETS_HTML_CONTENT__: htmls['secrets'] ?? '""',
            __ICON__: JSON.stringify(faviconBase64),
            __VERSION__: JSON.stringify(version)
        }
    });

    console.log(`${success} Worker built successfully!`);

    // 直接使用 esbuild 的输出，不做任何后续处理
    const finalCode = code.outputFiles[0].text;

    const buildTimestamp = new Date().toISOString();
    const worker = `// Build: ${buildTimestamp}\n// @ts-nocheck\n${finalCode}`;

    mkdirSync(DIST_PATH, { recursive: true });
    writeFileSync('./dist/worker.js', worker, 'utf8');

    // 生成 zip（同样不压缩内容）
    const zip = new JSZip();
    zip.file('_worker.js', worker);
    zip.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE'   // zip 内部压缩可以保留，为了减小传输体积，但代码本身未压缩
    }).then(nodebuffer => writeFileSync('./dist/worker.zip', nodebuffer));

    console.log(`${success} Done!`);
}

buildWorker().catch(err => {
    console.error(`${failure} Build failed:`, err);
    process.exit(1);
});
