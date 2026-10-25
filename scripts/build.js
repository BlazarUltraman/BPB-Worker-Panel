import { readFileSync } from 'fs';
import { join, dirname as pathDirname } from 'path';
import { fileURLToPath } from 'url';
import { globSync } from 'glob';
import pkg from '../package.json' with { type: 'json' };

const __filename = fileURLToPath(import.meta.url);
const __dirname = pathDirname(__filename);

const ASSET_PATH = join(__dirname, '../src/assets');

const green = '\x1b[32m';
const red = '\x1b[31m';
const reset = '\x1b[0m';

const success = `${green}✔${reset}`;
const failure = `${red}✗${reset}`;

async function processHtmlPages() {
    const indexFiles = globSync('**/index.html', { cwd: ASSET_PATH });
    const result = {};

    for (const relativeIndexPath of indexFiles) {
        const dir = pathDirname(relativeIndexPath);
        const base = (file) => join(ASSET_PATH, dir, file);

        const indexHtml = readFileSync(base('index.html'), 'utf8');
        let html = indexHtml.replaceAll('__VERSION__', pkg.version);

        if (dir !== 'error') {
            const css = readFileSync(base('style.css'), 'utf8');
            const script = readFileSync(base('script.js'), 'utf8');

            html = html
                .replace('/* CSS_PLACEHOLDER */', css)
                .replace('/* JS_PLACEHOLDER */', script);
        }

        result[dir] = html;
    }

    console.log(`${success} Assets processed successfully!`);
    return result;
}

async function buildWorker() {
    const htmls = await processHtmlPages();
    const faviconBase64 = readFileSync(join(ASSET_PATH, 'favicon.ico')).toString('base64');

    const embededContents = {
        PANEL_HTML_CONTENT: htmls['panel'],
        LOGIN_HTML_CONTENT: htmls['login'],
        ERROR_HTML_CONTENT: htmls['error'],
        PROXY_IP_HTML_CONTENT: htmls['proxy-ip'],
        ICON_CONTENT: faviconBase64
    };

    console.log(`${success} Done!`);
    return embededContents;
}

buildWorker().catch(err => {
    console.error(`${failure} Build failed:`, err);
    process.exit(1);
});
