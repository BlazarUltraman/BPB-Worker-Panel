import { readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, dirname as pathDirname } from 'path';
import { fileURLToPath } from 'url';
import { build } from 'esbuild';
import { globSync } from 'glob';
import { minify as jsMinify } from 'terser';
import { minify as htmlMinify } from 'html-minifier';
import JSZip from "jszip";
import pkg from '../package.json' with { type: 'json' };
import { gzipSync } from 'zlib';

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

        const indexHtml = readFileSync(base('index.html'), 'utf8');
        let finalHtml = indexHtml.replaceAll('__VERSION__', version);

        if (dir !== 'error') {
            const styleCode = readFileSync(base('style.css'), 'utf8');
            const scriptCode = readFileSync(base('script.js'), 'utf8');
            const finalScriptCode = await jsMinify(scriptCode);
            finalHtml = finalHtml
                .replaceAll('__STYLE__', `<style>${styleCode}</style>`)
                .replaceAll('__SCRIPT__', finalScriptCode.code);
        }

        const minifiedHtml = htmlMinify(finalHtml, {
            collapseWhitespace: true,
            removeAttributeQuotes: true,
            minifyCSS: true
        });

        const compressed = gzipSync(minifiedHtml);
        const htmlBase64 = compressed.toString('base64');
        result[dir] = JSON.stringify(htmlBase64);
    }

    console.log(`${success} Assets bundled successfully!`);
    return result;
}

async function buildWorker() {
    const htmls = await processHtmlPages();
    const faviconBuffer = readFileSync('./src/assets/favicon.ico');
    const faviconBase64 = faviconBuffer.toString('base64');

    // 使用esbuild构建TypeScript代码
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

    // 压缩JavaScript代码
    const minified = await jsMinify(code.outputFiles[0].text, {
        module: true,
        output: {
            comments: false
        },
        compress: {
            dead_code: false,
            unused: false
        }
    });

    console.log(`${success} Worker minified successfully!`);

    // 添加构建时间戳
    const buildTimestamp = new Date().toISOString();
    const buildInfo = `// Build: ${buildTimestamp}\n`;
    const worker = `${buildInfo}// @ts-nocheck\n${minified.code}`;
    
    // 确保输出目录存在
    mkdirSync(DIST_PATH, { recursive: true });
    
    // 写入worker.js文件
    writeFileSync('./dist/worker.js', worker, 'utf8');

    // 创建ZIP压缩包（可选）
    const zip = new JSZip();
    zip.file('_worker.js', worker);
    zip.generateAsync({
        type: 'nodebuffer',
        compression: 'DEFLATE'
    }).then(nodebuffer => writeFileSync('./dist/worker.zip', nodebuffer));

    console.log(`${success} Build completed!`);
}

buildWorker().catch(err => {
    console.error(`${failure} Build failed:`, err);
    process.exit(1);
});
