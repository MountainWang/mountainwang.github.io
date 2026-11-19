import { articleLayout, articleTemplate, base64, bootstrap, bootstrapText, decodeBase64, fail, formatPost, homeScript, homeScriptPath, homeTemplate, parsePost, siteConfigPath, stylesheet, validSlug } from './site.mjs';

export async function github(token, path, options = {}) {
    const response = await fetch(`https://api.github.com${path}`, {
        ...options,
        cache: 'no-store',
        redirect: 'error',
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json' }
    });
    if (response.status === 401) throw fail(401, 'GitHub 令牌无效或已过期');
    if (response.status === 403) throw fail(403, 'GitHub 拒绝了请求，请检查令牌权限');
    if (!response.ok) throw fail(response.status, 'GitHub 请求失败，请检查权限或稍后重试');
    return response.json();
}

export async function connect(token) {
    const user = await github(token, '/user');
    return { token, userId: user.id, login: user.login };
}

export async function repository(session) {
    const path = '/repos/' + encodeURIComponent(session.login) + '/' + encodeURIComponent(session.login + '.github.io');
    let repo;
    try {
        repo = await github(session.token, path);
    } catch (error) {
        if (error.status === 404) throw fail(404, '请创建自己的 GitHub Pages 仓库，并将该仓库加入令牌授权范围');
        throw error;
    }
    if (repo.owner.id !== session.userId || (session.repoId && session.repoId !== repo.id)) {
        throw fail(403, '当前账号没有此仓库的管理权限');
    }
    if (repo.permissions?.push === false || repo.archived || repo.disabled || repo.default_branch === 'gh-pages') {
        throw fail(403, '当前账号没有仓库写入权限');
    }
    session.repoId = repo.id;
    return { ...repo, path, token: session.token, branch: repo.default_branch };
}

export async function file(repo, path, ref) {
    const result = await github(repo.token, `${repo.path}/contents/${path}?ref=${encodeURIComponent(ref)}`);
    if (result.type !== 'file' || result.encoding !== 'base64') throw fail(409, '仓库文件格式不受支持');
    return decodeBase64(result.content);
}

export async function inspect(repo) {
    let ref;
    try {
        ref = await github(repo.token, `${repo.path}/git/ref/heads/${encodeURIComponent(repo.branch)}`);
    } catch (error) {
        if (error.status === 409) return { state: 'empty', head: null, paths: [] };
        throw error;
    }
    const head = ref.object.sha;
    const commit = await github(repo.token, `${repo.path}/git/commits/${head}`);
    const tree = await github(repo.token, `${repo.path}/git/trees/${commit.tree.sha}`);
    const paths = tree.tree.map(entry => entry.path);
    if (tree.truncated) throw fail(409, '仓库文件列表不完整');
    if (!paths.length) return { state: 'empty', head, paths };
    if (paths.length === 1 && paths[0] === bootstrap && commit.parents.length === 0 &&
        commit.message === 'Bootstrap Pages editor' && await file(repo, bootstrap, head) === bootstrapText) {
        return { state: 'empty', head, paths };
    }
    if (paths.includes(siteConfigPath)) {
        try {
            const config = JSON.parse(await file(repo, siteConfigPath, head));
            const home = config.home ?? 'index.html';
            const content = tree.tree.find(entry => entry.path === 'content');
            if (config.version === 1 && ['index.html', 'blog.html'].includes(home) &&
                (!content || content.type === 'tree')) {
                return { state: 'ready', head, home, paths, tree: commit.tree.sha, contentTree: content?.sha };
            }
        } catch (error) {
            if (!(error instanceof SyntaxError)) throw error;
        }
        return { state: 'repair', head, paths };
    }
    return { state: 'existing', head, paths };
}

export async function commitFiles(repo, head, files, message, deletions = []) {
    const query = `mutation($input: CreateCommitOnBranchInput!) {
        createCommitOnBranch(input: $input) { commit { oid url } }
    }`;
    const result = await github(repo.token, '/graphql', {
        method: 'POST',
        body: JSON.stringify({ query, variables: { input: {
            branch: { repositoryNameWithOwner: repo.full_name, branchName: repo.branch },
            expectedHeadOid: head,
            message: { headline: message },
            fileChanges: {
                additions: Object.entries(files).map(([path, contents]) => ({ path, contents })),
                deletions: deletions.map(path => ({ path }))
            }
        } } })
    });
    if (!result.data?.createCommitOnBranch?.commit) throw fail(409, '提交未完成，请检查分支保护和分支是否已更新');
    return result.data.createCommitOnBranch.commit;
}

const validSiteTitle = value => typeof value === 'string' && value.trim().length > 0 && value.trim().length <= 100;
const defaultSiteTitle = repo => repo.full_name.split('/')[0];

function initialFiles(home, siteTitle) {
    const templates = {
        'index.html': homeTemplate(),
        'article.html': articleTemplate(home),
        'blog.css': stylesheet,
        [homeScriptPath]: homeScript,
        ...articleLayout(home)
    };
    const files = {
        [siteConfigPath]: JSON.stringify({ version: 1, home, siteTitle }) + '\n',
        ...Object.fromEntries(Object.entries(templates).map(([path, text]) => [`templates/${path}`, text]))
    };
    return Object.fromEntries(Object.entries(files).map(([path, content]) => [path, base64(content)]));
}

export async function initialize(repo, status, siteTitle) {
    if (!validSiteTitle(siteTitle)) throw fail(400, '请填写 1 到 100 字的站点标题');
    if (status.state !== 'empty') throw fail(409, '仓库已更新，请重新检查');
    if (!status.head) {
        await github(repo.token, `${repo.path}/contents/${bootstrap}`, {
            method: 'PUT', body: JSON.stringify({ message: 'Bootstrap Pages editor', content: base64(bootstrapText) })
        });
        status = await inspect(repo);
    }
    if (status.state !== 'empty' || !status.head) return status;
    await commitFiles(repo, status.head, initialFiles('index.html', siteTitle.trim()),
        'Initialize Pages editor', status.paths.includes(bootstrap) ? [bootstrap] : []);
    return inspect(repo);
}

const migrationFiles = [siteConfigPath, 'templates/'];
const reservedPaths = [siteConfigPath, 'templates'];

export async function migrate(repo, status, expectedHead, siteTitle) {
    if (!validSiteTitle(siteTitle)) throw fail(400, '请填写 1 到 100 字的站点标题');
    if (status.state !== 'existing' || status.head !== expectedHead ||
        status.paths.some(path => reservedPaths.includes(path))) {
        throw fail(409, '仓库已更新或有路径冲突，请检查提示页');
    }
    await commitFiles(repo, status.head, initialFiles('blog.html', siteTitle.trim()),
        'Initialize Pages editor alongside existing site');
    return inspect(repo);
}

export async function saveArticle(repo, body) {
    const { slug, title, source, head, editing, images = [] } = body;
    if (!validSlug(slug) || typeof title !== 'string' || !title.trim() || title.length > 160 ||
        typeof source !== 'string' || source.length > 250_000 || typeof editing !== 'boolean' || !Array.isArray(images) || images.length > 20) {
        throw fail(400, '请检查标题、文章标识、正文和图片数量');
    }
    const status = await inspect(repo);
    if (status.state !== 'ready' || status.head !== head) throw fail(409, '分支已更新，请保留草稿并重新打开文章');
    let existing;
    try {
        existing = parsePost(await file(repo, `content/${slug}.md`, head), slug);
    } catch (error) {
        if (error.status !== 404) throw error;
    }
    if (Boolean(existing) !== editing) {
        throw fail(409, '文章标识已存在或文章已移除，请重新选择文章');
    }
    const files = {};
    const post = { slug, title: title.trim(), publishedAt: existing?.publishedAt ?? new Date().toISOString() };
    let imageSize = 0;
    for (const asset of images) {
        imageSize += asset.contents.length;
        files[asset.path] = asset.contents;
    }
    if (imageSize > 20 * 1024 * 1024) throw fail(413, '图片总大小过大，请减少图片后重试');
    files[`content/${slug}.md`] = base64(formatPost(post, source));
    const commit = await commitFiles(repo, head, files, 'Publish ' + slug);
    return { ...commit, post };
}

export async function siteOrigin(repo, head) {
    try {
        if (!head) return 'https://' + repo.owner.login + '.github.io';
        const domain = (await file(repo, 'CNAME', head)).trim();
        if (/^(?:[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.)+[a-z]{2,}$/i.test(domain)) return 'https://' + domain;
    } catch {
        // Publishing has already succeeded. The standard Pages hostname still provides a link.
    }
    return 'https://' + repo.owner.login + '.github.io';
}

export async function loadStatus(repo, setup) {
    let status = await inspect(repo);
    if (setup) {
        if (status.head !== setup.head || status.state !== setup.state) throw fail(409, '仓库已更新，请重新检查');
        status = status.state === 'empty'
            ? await initialize(repo, status, setup.title)
            : await migrate(repo, status, setup.head, setup.title);
    }
    const articles = status.state === 'ready' ? await listArticles(repo, status) : [];
    return {
        ...status, posts: articles.map(({ slug, title, publishedAt }) => ({ slug, title, publishedAt })),
        repo: repo.full_name, suggestedTitle: defaultSiteTitle(repo), site: await siteOrigin(repo, status.head),
        migrationFiles,
        conflicts: status.paths?.filter(path => reservedPaths.includes(path))
    };
}

export async function loadArticle(repo, slug, head) {
    if (!validSlug(slug)) throw fail(400, '文章标识无效');
    const status = await inspect(repo);
    if (status.state !== 'ready' || status.head !== head) throw fail(409, '分支已更新，请重新载入文章列表');
    return parsePost(await file(repo, `content/${slug}.md`, head), slug).body;
}

export async function listArticles(repo, { head, contentTree }) {
    if (!contentTree) return [];
    const directory = await github(repo.token, `${repo.path}/git/trees/${contentTree}`);
    if (directory.truncated) throw fail(409, '文章文件列表不完整');
    const articles = [];
    for (const { path, type, mode } of directory.tree) {
        const slug = path.endsWith('.md') && path.slice(0, -3);
        if (type === 'blob' && ['100644', '100755'].includes(mode) && validSlug(slug)) {
            const markdown = await file(repo, `content/${path}`, head);
            articles.push(parsePost(markdown, slug));
        }
    }
    return articles.sort((a, b) => b.publishedAt.localeCompare(a.publishedAt) || a.slug.localeCompare(b.slug));
}
