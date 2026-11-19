import { file, github, inspect, listArticles, siteOrigin } from './github.mjs';
import { article, fail, homeScriptPath, layoutPaths, listing, siteConfigPath } from './site.mjs';

const outputBranch = 'gh-pages';
const outputRef = 'refs/heads/' + outputBranch;
const outputAssets = ['blog.css', homeScriptPath, ...layoutPaths];

function publishedPath(path, home) {
    if (path.startsWith('templates/')) {
        const name = path.slice('templates/'.length);
        return outputAssets.includes(name) ? name : null;
    }
    if (path.startsWith('public/')) {
        const name = path.slice('public/'.length);
        return name.split('/').some(part => part.startsWith('.')) ? null : name;
    }
    if (path.startsWith('admin/') || path.startsWith('assets/') ||
        ['CNAME', siteConfigPath, 'GPU.md', 'favicon.png', 'favicon.ico'].includes(path) ||
        /^[^/]+\.pdf$/i.test(path) || (home === 'blog.html' && path === 'index.html')) return path;
    return null;
}

export async function buildSite(repo, { head, tree, home, contentTree }) {
    const snapshot = await github(repo.token, `${repo.path}/git/trees/${tree}?recursive=1`);
    if (snapshot.truncated) throw fail(409, '仓库文件列表不完整，无法生成站点');
    const files = new Map();
    function add(entry) {
        if (files.has(entry.path)) throw fail(409, '发布路径冲突：' + entry.path);
        files.set(entry.path, { mode: '100644', type: 'blob', ...entry });
    }
    for (const entry of snapshot.tree) {
        if (entry.type !== 'blob' || !['100644', '100755'].includes(entry.mode)) continue;
        const path = publishedPath(entry.path, home);
        if (path) add({ path, sha: entry.sha });
    }
    for (const path of outputAssets) {
        if (!files.has(path)) throw fail(409, '缺少发布模板文件：templates/' + path);
    }

    const [homeTemplate, postTemplate, posts] = await Promise.all([
        file(repo, 'templates/index.html', head),
        file(repo, 'templates/article.html', head),
        listArticles(repo, { head, contentTree })
    ]);
    if (!homeTemplate.includes('{{post-list}}') || !postTemplate.includes('{{post-title}}') ||
        !postTemplate.includes('{{post-content}}')) throw fail(409, '首页或文章模板缺少占位符');

    add({ path: home, content: listing(posts, homeTemplate) });
    if (home === 'blog.html' && !files.has('index.html')) {
        add({ path: 'index.html', content: '<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=/blog.html"><a href="/blog.html">首页</a>\n' });
    }
    add({ path: '.nojekyll', content: '' });
    for (const post of posts) {
        add({ path: `posts/${post.slug}.html`, content: article(post.title, post.body, home, postTemplate) });
    }
    return [...files.values()];
}

export async function deploySite(repo, expectedSource) {
    if (repo.branch === outputBranch) throw fail(409, '请将默认分支设为源码分支');
    const source = await inspect(repo);
    if (source.state !== 'ready') throw fail(409, '请先初始化站点');
    if (expectedSource && source.head !== expectedSource) {
        throw fail(409, '源码分支已有更新，请用最新版本重新发布站点');
    }
    let previous;
    try {
        previous = (await github(repo.token, `${repo.path}/git/ref/heads/${outputBranch}`)).object.sha;
    } catch (error) {
        if (error.status !== 404) throw error;
    }
    const entries = await buildSite(repo, source);
    const request = (path, body, method = 'POST') => github(repo.token, repo.path + path, {
        method, body: JSON.stringify(body)
    });
    const tree = await request('/git/trees', { tree: entries });
    const commit = await request('/git/commits', {
        message: `Deploy ${repo.branch} ${source.head}`,
        tree: tree.sha,
        parents: previous ? [previous] : []
    });
    const latest = await github(repo.token, `${repo.path}/git/ref/heads/${encodeURIComponent(repo.branch)}`);
    if (latest.object.sha !== source.head) throw fail(409, '构建期间源码分支已有更新，请重新发布站点');
    if (previous) {
        await request('/git/refs/heads/' + outputBranch, { sha: commit.sha, force: false }, 'PATCH');
    } else {
        await request('/git/refs', { ref: outputRef, sha: commit.sha });
    }
    return {
        url: commit.html_url,
        site: await siteOrigin(repo, source.head),
        home: source.home === 'index.html' ? '/' : '/' + source.home,
        created: !previous
    };
}
