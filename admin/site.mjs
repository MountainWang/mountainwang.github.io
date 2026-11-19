import './vendor/markdown-it.mjs';

const markdown = globalThis.markdownit({ html: false });
const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const siteConfigPath = '.site-config.json';
export const bootstrap = '.pages-editor-bootstrap';
export const bootstrapText = 'pages-editor bootstrap v1\n';
export const base64 = value => encodeBytes(new TextEncoder().encode(value));
export const validSlug = value => typeof value === 'string' && value.length <= 80 && slugPattern.test(value);
export const fail = (status, message) => Object.assign(new Error(message), { status });

export function formatPost({ title, publishedAt }, body) {
    return `---\ntitle: ${JSON.stringify(title)}\npublishedAt: ${JSON.stringify(publishedAt)}\n---\n\n${body}`;
}

export function parsePost(source, slug) {
    const match = source.match(/^\uFEFF?---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)(?:\r?\n)?/);
    const fields = new Map();
    if (match) {
        for (const line of match[1].split(/\r?\n/)) {
            const field = line.match(/^(title|publishedAt):[ \t]*(.*)$/);
            if (!field) continue;
            let value = field[2].trim();
            if (value.startsWith('"')) {
                try {
                    value = JSON.parse(value);
                } catch {
                    throw fail(400, `content/${slug}.md 的 ${field[1]} 格式无效`);
                }
            } else if (value.startsWith("'") && value.endsWith("'")) {
                value = value.slice(1, -1).replaceAll("''", "'");
            }
            if (fields.has(field[1])) throw fail(400, `content/${slug}.md 有重复的 ${field[1]}`);
            fields.set(field[1], value);
        }
    }
    const title = fields.get('title');
    const timestamp = Date.parse(fields.get('publishedAt'));
    if (!match || typeof title !== 'string' || !title.trim() || !Number.isFinite(timestamp)) {
        throw fail(400, `请在 content/${slug}.md 的文件头填写 title 和有效的 publishedAt`);
    }
    return { slug, title, publishedAt: new Date(timestamp).toISOString(), body: source.slice(match[0].length) };
}

export function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, c => ({'&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;'}[c]));
}

export function render(source) {
    return markdown.render(source.replace(/^~~~~\{([\w-]+)\}[ \t]*$/gm, '~~~~$1'));
}

function page(title, body, script = '') {
    return `<!doctype html>
<html lang="zh-CN">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${escapeHtml(title)}</title>
    <link rel="stylesheet" href="/blog.css">
${script ? `    <script src="${script}" defer></script>\n` : ''}</head>
<body>
    <main class="site">${body}</main>
</body>
</html>
`;
}

const homeUrl = home => home === 'blog.html' ? '/blog.html' : '/';
const articleNavigation = home => `<nav aria-label="站点导航"><a href="${homeUrl(home)}">首页</a></nav>`;

export const layoutPaths = ['article-header.html', 'article-footer.html', 'article-layout.js'];

export function articleLayout(home) {
    return {
        'article-header.html': articleNavigation(home) + '\n',
        'article-footer.html': '<!-- 在这里添加所有文章共用的页脚。 -->\n',
        'article-layout.js': `for (const section of document.querySelectorAll('[data-article-fragment]')) {
    fetch(section.dataset.articleFragment)
        .then(response => response.ok ? response.text() : null)
        .then(html => { if (html !== null) section.innerHTML = html.trim(); })
        .catch(() => {});
}
`
    };
}

export function articleTemplate(home) {
    return page('{{post-title}}', `
        <header class="site-nav" data-article-fragment="/article-header.html">
            ${articleNavigation(home)}
        </header>
        <article class="article">
            <h1>{{post-title}}</h1>
            <div class="prose">{{post-content}}</div>
        </article>
        <footer class="article-footer" data-article-fragment="/article-footer.html"></footer>
        <script src="/article-layout.js" defer></script>
    `);
}

export function article(title, source, home, template = articleTemplate(home)) {
    const values = { 'post-title': escapeHtml(title), 'post-content': render(source) };
    return template.replace(/{{(post-title|post-content)}}/g, (_, part) => values[part]);
}

export function homeTemplate() {
    return page('', `
        <header class="site-header">
            <h1 id="site-title"></h1>
        </header>
        {{post-list}}
    `, '/' + homeScriptPath);
}

export function listing(posts, template = homeTemplate()) {
    const links = posts.map(post => {
        const date = new Date(post.publishedAt);
        const iso = Number.isFinite(date.getTime()) ? date.toISOString() : '';
        const time = iso ? `<time datetime="${iso}"></time>` : '';
        return `<li><a href="/posts/${post.slug}.html">${escapeHtml(post.title)}</a>${time}</li>`;
    }).join('');
    const content = links ? `<ul class="posts">${links}</ul>` : '<p class="empty">暂无已发布文章。</p>';
    return template.replaceAll('{{post-list}}', () => content);
}

export const homeScriptPath = 'site-home.js';
export const homeScript = `const publishedTime = new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short'
});

for (const time of document.querySelectorAll('time[datetime]')) {
    const date = new Date(time.dateTime);
    if (Number.isFinite(date.getTime())) time.textContent = publishedTime.format(date);
}

async function loadSiteTitle() {
    let title = '博客';
    try {
        const response = await fetch('/.site-config.json', { cache: 'no-cache' });
        if (response.ok) {
            const config = await response.json();
            if (typeof config.siteTitle === 'string' && config.siteTitle.trim()) title = config.siteTitle.trim();
        }
    } catch {}
    document.title = title;
    document.getElementById('site-title').textContent = title;
}

loadSiteTitle();
`;

export const stylesheet = `:root {
    color-scheme: light dark;
    font: 1rem/1.7 system-ui, sans-serif;
    --surface: #f6f8fb;
    --ink: #16243a;
    --muted: #516179;
    --accent: #2356a9;
    --border: #d7e0ed;
}

* { box-sizing: border-box; }
body { margin: 0; background: var(--surface); color: var(--ink); }
.site { width: min(46rem, 100% - 2.5rem); margin: auto; padding-block: clamp(2.5rem, 9vw, 7rem); }
h1 { margin: 0; font-size: clamp(2.4rem, 7vw, 4.4rem); line-height: 1.1; font-weight: 750; letter-spacing: -.035em; overflow-wrap: anywhere; }
a { color: var(--accent); text-underline-offset: .2em; }
a:focus-visible { outline: 2px solid var(--accent); outline-offset: .25rem; }
.site-header { padding-bottom: 1.5rem; border-bottom: 1px solid var(--border); }
.posts { margin: 0; padding: 0; list-style: none; }
.posts li { display: flex; align-items: baseline; flex-wrap: wrap; justify-content: space-between; gap: .2rem 1rem; padding-block: 1.1rem; border-bottom: 1px solid var(--border); }
.posts a { color: var(--ink); font-size: 1.2rem; font-weight: 600; text-decoration: none; overflow-wrap: anywhere; }
.posts time { color: var(--muted); font-size: .9rem; font-variant-numeric: tabular-nums; }
.posts a:hover { color: var(--accent); text-decoration: underline; }
.empty { margin-top: 1.25rem; color: var(--muted); }
.site-nav { margin-bottom: 2rem; }
.article-footer:not(:empty) { margin-top: 2rem; color: var(--muted); }
.article h1 { margin-bottom: 1.5rem; }
.prose { overflow-wrap: anywhere; }
.prose :is(h2, h3, h4) { margin: 2rem 0 .6rem; line-height: 1.25; }
img { max-width: 100%; height: auto; border-radius: .4rem; }
pre { overflow: auto; padding: 1rem; border: 1px solid var(--border); border-radius: .5rem; }
blockquote { margin-inline: 0; padding-inline-start: 1rem; border-inline-start: 3px solid var(--border); color: var(--muted); }
table { display: block; max-width: 100%; overflow-x: auto; border-collapse: collapse; }
th, td { padding: .4rem .7rem; border: 1px solid var(--border); }

@media (prefers-color-scheme: dark) {
    :root { --surface: #121c2b; --ink: #ecf1f8; --muted: #aab9ce; --accent: #9abfff; --border: #364862; }
}
`;

function encodeBytes(bytes) {
    const chunks = [];
    for (let i = 0; i < bytes.length; i += 8192) {
        chunks.push(String.fromCharCode(...bytes.subarray(i, i + 8192)));
    }
    return btoa(chunks.join(''));
}

export const decodeBase64 = value => new TextDecoder().decode(Uint8Array.from(atob(value), char => char.charCodeAt(0)));

export async function imageAsset(slug, file) {
    if (file.size > 5 * 1024 * 1024) throw fail(400, '单张图片最多 5 MiB');
    const bytes = new Uint8Array(await file.arrayBuffer());
    const hex = data => Array.from(data, byte => byte.toString(16).padStart(2, '0')).join('');
    const header = new TextDecoder().decode(bytes.subarray(0, 12));
    let ext;
    if (hex(bytes.subarray(0, 8)) === '89504e470d0a1a0a') ext = 'png';
    if (hex(bytes.subarray(0, 3)) === 'ffd8ff') ext = 'jpg';
    if (header.startsWith('GIF87a') || header.startsWith('GIF89a')) ext = 'gif';
    if (header.startsWith('RIFF') && header.slice(8) === 'WEBP') ext = 'webp';
    if (!ext) throw fail(400, '图片格式须为 PNG、JPEG、GIF 或 WebP');
    const hash = hex(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)));
    const contents = encodeBytes(bytes);
    const type = ext === 'jpg' ? 'jpeg' : ext;
    return { path: `assets/images/${slug}/${hash}.${ext}`, contents, url: `data:image/${type};base64,${contents}` };
}
