import { connect, loadArticle, loadStatus, saveArticle, repository as getRepository } from './github.mjs';
import { deploySite } from './deploy.mjs';
import { imageAsset, render } from './site.mjs';

const byId = id => document.getElementById(id);
const source = byId('source');
const slug = byId('slug');
const title = byId('title');
const status = byId('status');
const operation = byId('operation');
const articles = byId('articles');
const imageInput = byId('images');
const imageMessage = byId('image-message');
const assets = new Map();
let session;
let repository;
let dirty = false;
let editing = false;
let busy = false;

async function perform(action, { message = '', errorTarget = status } = {}) {
    if (busy) return;
    busy = true;
    operation.textContent = message;
    const controls = Array.from(document.querySelectorAll('button, input, select, textarea'));
    const previouslyDisabled = controls.filter(control => control.disabled);
    controls.forEach(control => { control.disabled = true; });
    try {
        await action();
    } catch (error) {
        errorTarget.textContent = error.message;
    } finally {
        controls.filter(control => !previouslyDisabled.includes(control)).forEach(control => { control.disabled = false; });
        operation.textContent = '';
        busy = false;
    }
}

function showRepository(result) {
    repository = result;
    status.textContent = result.repo;
    byId('retry').hidden = true;
    byId('editor').hidden = result.state !== 'ready';
    byId('setup').hidden = result.state === 'ready';
    if (result.state === 'ready') {
        articles.replaceChildren(new Option(result.posts.length ? '选择文章' : '暂无已发布文章', ''),
            ...result.posts.map(post => new Option(post.title, post.slug)));
        preview();
        return;
    }
    byId('paths').replaceChildren(...result.paths.map(path => {
        const entry = document.createElement('li');
        entry.textContent = path;
        return entry;
    }));
    const empty = result.state === 'empty';
    const canMigrate = result.state === 'existing' && !result.conflicts.length;
    byId('setup-title').textContent = empty ? '初始化博客' : '仓库已有内容';
    byId('initialize').hidden = !(empty || canMigrate);
    byId('site-title').value = result.suggestedTitle;
    byId('migrate').textContent = empty ? '初始化博客' : '确认新增博客文件';
    byId('setup-message').textContent = empty
        ? '填写站点标题后，将在源码分支创建站点配置和模板。'
        : canMigrate
            ? '将在现有网站旁新增这些文件：' + result.migrationFiles.join('、') + '。现有首页与域名文件会保留。'
            : '初始化信息需要检查。请先处理文件冲突或配置版本，再重新登录。' + (result.conflicts?.join('、') || '');
}

byId('login').onsubmit = event => {
    event.preventDefault();
    perform(async () => {
        const input = byId('token');
        const value = input.value.trim();
        input.value = '';
        if (!/^github_pat_[A-Za-z0-9_]+$/.test(value)) {
            throw new Error('请输入仅授权目标仓库的 fine-grained personal access token');
        }
        session = await connect(value);
        byId('login').hidden = true;
        byId('logout').hidden = false;
        byId('retry').hidden = false;
        showRepository(await loadStatus(await getRepository(session)));
    }, { message: '正在验证令牌并加载仓库…' });
};

byId('logout').onclick = () => perform(async () => {
    if (dirty && !confirm('退出会丢失未提交的修改。继续退出？')) return;
    dirty = false;
    session = null;
    location.reload();
});

byId('retry').onclick = () => perform(async () => {
    showRepository(await loadStatus(await getRepository(session)));
}, { message: '正在检查仓库…' });

byId('initialize').onsubmit = event => {
    event.preventDefault();
    perform(async () => {
        const { head, state } = repository;
        const title = byId('site-title').value;
        showRepository(await loadStatus(await getRepository(session), { head, state, title }));
    }, { message: '正在初始化博客…' });
};

function preview() {
    const template = document.createElement('template');
    template.innerHTML = render(source.value);
    for (const image of template.content.querySelectorAll('img')) {
        const asset = assets.get(image.getAttribute('src'));
        if (asset) image.src = asset.url;
    }
    const base = new URL('/posts/', repository.site).href;
    byId('preview').srcdoc = `<!doctype html><html lang="zh-CN"><meta charset="utf-8">
        <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: data:; style-src 'unsafe-inline'">
        <base href="${base}">
        <style>
            body{margin:0;padding:1.25rem;color:#1d2939;font:1rem/1.7 system-ui,sans-serif;overflow-wrap:anywhere}
            h1,h2,h3{line-height:1.3}body>:first-child{margin-top:0}img{max-width:100%;height:auto}
            a{color:#2356a9}pre{overflow:auto;padding:.8rem;background:#f0f3f7;border-radius:.4rem}
            blockquote{margin-inline:0;padding-inline-start:1rem;border-inline-start:3px solid #c4d5ed;color:#526179}
            table{border-collapse:collapse}td,th{padding:.3rem .6rem;border:1px solid #d9e0ea}
            .empty{color:#526179}
        </style>
        ${template.innerHTML || '<p class="empty">输入 Markdown 后在这里预览。</p>'}</html>`;
}

let previewTimer;
function schedulePreview() {
    dirty = true;
    clearTimeout(previewTimer);
    previewTimer = setTimeout(preview, 300);
}
source.addEventListener('input', schedulePreview);
const formats = {
    heading: ['## ', '', '标题'],
    bold: ['**', '**', '粗体'],
    italic: ['*', '*', '斜体'],
    code: ['`', '`', '代码']
};

byId('format').addEventListener('click', event => {
    const format = formats[event.target.closest('button')?.dataset.format];
    if (!format) return;
    const [before, after, placeholder] = format;
    const { selectionStart: start, selectionEnd: end } = source;
    const selected = source.value.slice(start, end) || placeholder;
    const needsNewline = format === formats.heading && start > 0 && source.value[start - 1] !== '\n';
    const opener = needsNewline ? '\n' + before : before;
    const replacement = opener + selected + after;
    if (source.value.length - (end - start) + replacement.length > source.maxLength) return;
    source.setRangeText(replacement, start, end);
    source.focus();
    source.setSelectionRange(start + opener.length, start + opener.length + selected.length);
    schedulePreview();
});

title.addEventListener('input', () => { dirty = true; });
slug.addEventListener('input', () => {
    dirty = true;
    imageMessage.textContent = '';
});

function clearImages() {
    assets.clear();
    imageMessage.textContent = '';
}

byId('new').onclick = () => perform(async () => {
    if (dirty && !confirm('放弃未提交的修改？')) return;
    const result = await loadStatus(await getRepository(session));
    showRepository(result);
    clearImages();
    source.value = title.value = slug.value = '';
    slug.readOnly = false;
    editing = false;
    byId('result').replaceChildren();
    dirty = false;
    preview();
}, { message: '正在刷新文章列表…' });

articles.onchange = () => perform(async () => {
    const selected = articles.value;
    articles.value = slug.readOnly ? slug.value : '';
    if (!selected || (dirty && !confirm('放弃未提交的修改？'))) return;
    const post = repository.posts.find(item => item.slug === selected);
    const markdown = await loadArticle(await getRepository(session), selected, repository.head);
    clearImages();
    articles.value = slug.value = selected;
    slug.readOnly = true;
    title.value = post.title;
    editing = true;
    byId('result').replaceChildren();
    source.value = markdown;
    dirty = false;
    preview();
}, { message: '正在加载文章…' });

async function addImages(files) {
    for (const file of files) {
        const asset = await imageAsset(slug.value, file);
        const alt = prompt('图片替代文字', file.name);
        if (alt === null) continue;
        const path = '../' + asset.path;
        assets.set(path, asset);
        slug.readOnly = true;
        source.setRangeText('![' + alt.replace(/[\[\]\\]/g, '\\$&').replace(/[\r\n]/g, ' ') + '](' + path + ')', source.selectionStart, source.selectionEnd, 'end');
        dirty = true;
    }
    preview();
}

function canAddImages() {
    if (busy) return false;
    if (slug.value && slug.checkValidity()) {
        imageMessage.textContent = '';
        return true;
    }
    imageMessage.textContent = slug.value
        ? '请先填写有效的文章标识，例如 my-first-post。'
        : '请先填写文章标识，再添加图片。';
    slug.focus();
    return false;
}

imageInput.addEventListener('click', event => {
    if (!canAddImages()) event.preventDefault();
});
imageInput.addEventListener('change', () => {
    const files = Array.from(imageInput.files);
    imageInput.value = '';
    if (files.length && canAddImages()) perform(() => addImages(files), { errorTarget: imageMessage });
});
source.ondragover = event => event.preventDefault();
source.ondrop = event => {
    if (!event.dataTransfer.files.length) return;
    event.preventDefault();
    if (!canAddImages()) return;
    const files = Array.from(event.dataTransfer.files);
    perform(() => addImages(files), { errorTarget: imageMessage });
};

function link(text, href) {
    const anchor = document.createElement('a');
    anchor.href = href;
    anchor.textContent = text;
    anchor.target = '_blank';
    anchor.rel = 'noopener noreferrer';
    return anchor;
}

function showDeployment(deployment, articleSlug) {
    const destination = articleSlug ? `/posts/${articleSlug}.html` : deployment.home;
    const message = deployment.created
        ? '已创建 gh-pages。请在 Settings → Pages 选择从 gh-pages 根目录发布。'
        : '已更新 gh-pages，等待 GitHub Pages 部署。';
    byId('result').append(message + ' ', link('查看产物提交', deployment.url),
        ' · ', link(articleSlug ? '打开文章' : '打开站点', new URL(destination, deployment.site).href));
}

byId('rebuild').onclick = () => perform(async () => {
    byId('result').replaceChildren();
    showDeployment(await deploySite(await getRepository(session)));
}, { message: '正在构建整站并更新 gh-pages…', errorTarget: byId('result') });

byId('publish').onsubmit = event => {
    event.preventDefault();
    perform(async () => {
        const images = [];
        for (const [path, asset] of assets) {
            if (source.value.includes(path)) images.push(asset);
        }
        const repo = await getRepository(session);
        const commit = await saveArticle(repo, {
            slug: slug.value, title: title.value, source: source.value, head: repository.head, editing, images
        });
        dirty = false;
        slug.readOnly = true;
        byId('result').replaceChildren('源码已保存。', link('查看源码提交', commit.url), ' · ');
        editing = true;
        repository.head = commit.oid;
        repository.posts = [commit.post,
            ...repository.posts.filter(post => post.slug !== slug.value)]
            .sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.slug.localeCompare(b.slug));
        showRepository(repository);
        articles.value = slug.value;
        operation.textContent = '源码已保存，正在构建整站并更新 gh-pages…';
        try {
            showDeployment(await deploySite(repo, commit.oid), slug.value);
        } catch (error) {
            byId('result').append('站点发布失败。' + error.message + ' 可点击「重新发布站点」重试。');
        }
    }, { message: '正在保存文章源码…', errorTarget: byId('result') });
};

window.addEventListener('beforeunload', event => {
    if (dirty) event.preventDefault();
});
