import { test } from 'node:test';
import assert from 'node:assert/strict';
import { commitFiles, connect, deleteArticle, initialize, inspect, loadArticle, loadStatus, migrate, repository, saveArticle } from '../admin/github.mjs';
import { deploySite } from '../admin/deploy.mjs';
import { articleTemplate, base64, decodeBase64, formatPost, homeTemplate, imageAsset, parsePost, render } from '../admin/site.mjs';

const repo = { owner: { login: 'owner' }, path: '/repos/owner/owner.github.io', full_name: 'owner/owner.github.io', branch: 'main', token: 'test' };

function mockFetch(t, handler) {
    t.mock.method(globalThis, 'fetch', async (url, options) => {
        const { status = 200, body } = handler(new URL(url).pathname, options);
        return Response.json(body ?? {}, { status });
    });
}

test('reports an empty repository and propagates permission failures', async t => {
    let status = 409;
    mockFetch(t, () => ({ status }));
    assert.equal((await loadStatus(repo)).state, 'empty');
    status = 403;
    await assert.rejects(inspect(repo), { status: 403 });
});

test('a README alone triggers the existing repository prompt', async t => {
    mockFetch(t, path => {
        if (path.includes('/git/ref/')) return { body: { object: { sha: 'head' } } };
        if (path.includes('/git/commits/')) return { body: { tree: { sha: 'tree' } } };
        return { body: { tree: [{ path: 'README.md' }] } };
    });
    assert.deepEqual(await inspect(repo), { state: 'existing', head: 'head', paths: ['README.md'] });
});

test('migration preserves the existing homepage and uses the inspected head', async t => {
    mockFetch(t, (path, options) => {
        if (path === '/graphql') {
            const { variables: { input } } = JSON.parse(options.body);
            assert.equal(input.branch.branchName, 'main');
            assert.equal(input.expectedHeadOid, 'head');
            assert.deepEqual(input.fileChanges.additions.map(file => file.path),
                ['.site-config.json', 'templates/index.html', 'templates/article.html', 'templates/blog.css', 'templates/site-home.js', 'templates/article-header.html', 'templates/article-footer.html', 'templates/article-layout.js']);
            const files = Object.fromEntries(input.fileChanges.additions.map(({ path, contents }) => [path, decodeBase64(contents)]));
            assert.match(files['templates/index.html'], /<title><\/title>/);
            assert.match(files['templates/index.html'], /<h1 id="site-title"><\/h1>/);
            assert.equal(JSON.parse(files['.site-config.json']).siteTitle, '我的 & 博客');
            assert.match(files['templates/article-header.html'], /href="\/blog\.html">首页/);
            return { body: { data: { createCommitOnBranch: { commit: { oid: 'next' } } } } };
        }
        if (path.includes('/git/ref/')) return { body: { object: { sha: 'next' } } };
        if (path.includes('/git/commits/')) return { body: { tree: { sha: 'tree' } } };
        if (path.includes('/git/trees/')) {
            return { body: { tree: ['blog.html', 'blog.css', '.site-config.json', 'article-header.html'].map(path => ({ path })) } };
        }
        const content = '{"version":1,"home":"blog.html"}';
        return { body: { type: 'file', encoding: 'base64', content: base64(content) } };
    });
    const status = { state: 'existing', head: 'head', paths: ['index.html', 'CNAME'] };
    assert.equal((await migrate(repo, status, 'head', '我的 & 博客')).state, 'ready');
    await assert.rejects(migrate(repo, status, 'earlier', '我的博客'), { status: 409 });
    await assert.rejects(migrate(repo, { ...status, paths: ['templates'] }, 'head', '我的博客'), { status: 409 });
});

test('binds the token to its user and rejects a repository owned by another user', async t => {
    let ownerId = 2;
    mockFetch(t, (path, options) => {
        assert.equal(options.headers.Authorization, 'Bearer test');
        if (path === '/user') return { body: { login: 'owner', id: 1 } };
        assert.equal(path, repo.path);
        return { body: { owner: { id: ownerId }, id: 10, permissions: { push: true }, default_branch: 'main' } };
    });
    const session = await connect('test');
    await assert.rejects(repository(session), { status: 403 });
    ownerId = 1;
    assert.equal((await repository(session)).branch, 'main');
    assert.equal(session.repoId, 10);
});

test('a rejected branch update surfaces a conflict', async t => {
    mockFetch(t, () => ({ body: { errors: [{ message: 'expected head mismatch' }] } }));
    await assert.rejects(commitFiles(repo, 'old', { 'posts/post.html': base64('html') }, 'Publish'), { status: 409 });
});

test('renders markdown images, escapes raw HTML, and checks image type', async () => {
    assert.match(render('![描述](../assets/images/p/a.png)'), /<img src="\.\.\/assets\/images\/p\/a\.png" alt="描述">/);
    assert.doesNotMatch(render('<script>alert(1)</script>'), /<script>/);
    const png = new File([Buffer.from('89504e470d0a1a0a', 'hex')], 'picture.png');
    const asset = await imageAsset('test', png);
    assert.match(asset.path, /^assets\/images\/test\/[a-f0-9]{64}\.png$/);
    assert.match(asset.url, /^data:image\/png;base64,/);
    await assert.rejects(imageAsset('test', new File(['<svg/>'], 'picture.png')), { status: 400 });
});

test('bootstraps an empty repository and completes initialization', async t => {
    let head = 'missing';
    mockFetch(t, (path, options) => {
        if (options.method === 'PUT') {
            assert.equal(path, repo.path + '/contents/.pages-editor-bootstrap');
            head = 'bootstrap';
            return { status: 201 };
        }
        if (path.includes('/git/ref/')) return { body: { object: { sha: head } } };
        if (path.includes('/git/commits/')) {
            return { body: { tree: { sha: head }, message: 'Bootstrap Pages editor', parents: [] } };
        }
        if (path.includes('/git/trees/')) {
            const paths = head === 'bootstrap' ? ['.pages-editor-bootstrap'] : ['index.html', 'blog.css', '.site-config.json'];
            return { body: { tree: paths.map(path => ({ path })) } };
        }
        if (path === '/graphql') {
            const { variables: { input } } = JSON.parse(options.body);
            assert.equal(input.expectedHeadOid, 'bootstrap');
            assert.deepEqual(input.fileChanges.deletions, [{ path: '.pages-editor-bootstrap' }]);
            const home = input.fileChanges.additions.find(file => file.path === 'templates/index.html');
            assert.match(decodeBase64(home.contents), /src="\/site-home\.js"/);
            const config = input.fileChanges.additions.find(file => file.path === '.site-config.json');
            assert.equal(JSON.parse(decodeBase64(config.contents)).siteTitle, '新博客');
            head = 'initialized';
            return { body: { data: { createCommitOnBranch: { commit: { oid: head } } } } };
        }
        const content = {
            '.site-config.json': '{"version":1}',
            '.pages-editor-bootstrap': 'pages-editor bootstrap v1\n'
        }[path.split('/').at(-1)];
        return { body: { type: 'file', encoding: 'base64', content: base64(content) } };
    });
    assert.equal((await initialize(repo, { state: 'empty', head: null, paths: [] }, '新博客')).state, 'ready');
});

test('saves only source files and preserves the original publication date', async t => {
    let originalPost;
    const source = '你好 ![图](../assets/images/test/image.png)';
    mockFetch(t, (path, options) => {
        if (path === '/graphql') {
            const { variables: { input } } = JSON.parse(options.body);
            assert.equal(input.expectedHeadOid, 'base');
            const files = Object.fromEntries(input.fileChanges.additions.map(({ path, contents }) => [path, contents]));
            assert.deepEqual(Object.keys(files).sort(), ['assets/images/test/image.png', 'content/test.md']);
            const post = parsePost(decodeBase64(files['content/test.md']), 'test');
            assert.equal(post.body, source);
            assert.ok(Number.isFinite(Date.parse(post.publishedAt)));
            if (originalPost) assert.equal(post.publishedAt, originalPost.publishedAt);
            return { body: { data: { createCommitOnBranch: { commit: { oid: 'next', url: 'https://github.com/example' } } } } };
        }
        if (path.includes('/git/ref/')) return { body: { object: { sha: 'base' } } };
        if (path.includes('/git/commits/')) return { body: { tree: { sha: 'tree' } } };
        if (path.includes('/git/trees/')) {
            return { body: { tree: ['.site-config.json', 'templates'].map(path => ({ path })) } };
        }
        if (path.endsWith('/test.md') && !originalPost) return { status: 404 };
        const value = path.endsWith('/test.md')
            ? formatPost(originalPost, source)
            : '{"version":1,"home":"index.html","siteTitle":"已保存的标题"}';
        return { body: { type: 'file', encoding: 'base64', content: base64(value) } };
    });
    const draft = {
        slug: 'test', title: '标题', source, head: 'base', editing: false,
        images: [{ path: 'assets/images/test/image.png', contents: 'aW1hZ2U=' }]
    };
    originalPost = (await saveArticle(repo, draft)).post;
    const edited = await saveArticle(repo, { ...draft, title: '修改后的标题', editing: true });
    assert.equal(edited.post.title, '修改后的标题');
    assert.equal(edited.post.publishedAt, originalPost.publishedAt);
});

test('deletes the article and only its own images in one guarded source commit', async t => {
    let writes = 0;
    mockFetch(t, (path, options) => {
        if (path === '/graphql') {
            writes++;
            const { variables: { input } } = JSON.parse(options.body);
            assert.equal(input.branch.branchName, 'main');
            assert.equal(input.expectedHeadOid, 'base');
            assert.deepEqual(input.fileChanges, {
                additions: [],
                deletions: [
                    { path: 'content/test.md' },
                    { path: 'assets/images/test/one.png' },
                    { path: 'assets/images/test/gallery/two.jpg' }
                ]
            });
            return { body: { data: { createCommitOnBranch: { commit: { oid: 'next' } } } } };
        }
        if (path.includes('/git/ref/')) return { body: { object: { sha: 'base' } } };
        if (path.includes('/git/commits/')) return { body: { tree: { sha: 'tree' } } };
        if (path.includes('/git/trees/')) {
            return { body: { tree: [
                '.site-config.json', 'content/test.md', 'content/test-other.md',
                'assets/images/test/one.png', 'assets/images/test/gallery/two.jpg',
                'assets/images/test-other/one.png', 'public/resume.pdf'
            ].map(path => ({ path, type: 'blob' })) } };
        }
        assert.ok(path.endsWith('/.site-config.json'));
        return { body: { type: 'file', encoding: 'base64', content: base64('{"version":1,"home":"index.html"}') } };
    });
    await assert.rejects(deleteArticle(repo, '../test', 'base'), { status: 400 });
    await assert.rejects(deleteArticle(repo, 'test', 'stale'), { status: 409 });
    await assert.rejects(deleteArticle(repo, 'missing', 'base'), { status: 404 });
    assert.equal(writes, 0);
    assert.equal((await deleteArticle(repo, 'test', 'base')).oid, 'next');
    assert.equal(writes, 1);
});

test('builds a complete Pages tree and creates or advances the output branch', async t => {
    const sourceHead = '12345678abcdef0123456789abcdef0123456789';
    let previous;
    let moved = false;
    let changed = false;
    let sourceReads = 0;
    const sourcePaths = [
        '.site-config.json', 'templates', 'templates/blog.css', 'templates/site-home.js',
        'templates/article-header.html', 'templates/article-footer.html', 'templates/article-layout.js',
        'admin/index.html', 'assets/images/test/image.png', 'content/test.md', 'public/resume.pdf', 'public/简历.pdf', 'public/说明.html'
    ];
    const contents = {
        '.site-config.json': '{"version":1,"home":"index.html","siteTitle":"本站"}',
        'templates/index.html': homeTemplate(),
        'templates/article.html': articleTemplate('index.html'),
        'content/test.md': formatPost({ title: '原标题', publishedAt: '2026-11-19T14:55:23.000Z' }, '你好 ![图](../assets/images/test/image.png)'),
        'admin/index.html': '<!doctype html><html><body><main>Editor</main></body></html>',
        'public/说明.html': '<!doctype html><html><body><main>说明</main></body></html>',
        'CNAME': 'example.org'
    };
    mockFetch(t, (path, options) => {
        const { method } = options;
        if (path.endsWith('/git/ref/heads/main')) {
            sourceReads++;
            return { body: { object: { sha: changed && sourceReads === 2 ? 'new-source' : sourceHead } } };
        }
        if (path.endsWith('/git/ref/heads/gh-pages')) {
            return previous ? { body: { object: { sha: previous } } } : { status: 404 };
        }
        if (path.endsWith('/git/commits/' + sourceHead)) return { body: { tree: { sha: 'tree' } } };
        if (path.endsWith('/git/trees/tree')) {
            return { body: { tree: [
                { path: 'content', type: 'tree', sha: 'content-tree' },
                ...sourcePaths.map(path => ({ path, type: 'blob', mode: '100644', sha: path + '-sha' }))
            ] } };
        }
        if (path.endsWith('/git/trees/content-tree')) {
            return { body: { tree: [
                { path: 'test.md', type: 'blob', mode: '100644' },
                { path: 'image.png', type: 'blob', mode: '100644' }
            ] } };
        }
        if (path.endsWith('/git/trees')) {
            const { tree } = JSON.parse(options.body);
            const files = Object.fromEntries(tree.map(item => [item.path, item]));
            assert.match(files['index.html'].content, /2026-11-19T14:55:23.000Z/);
            assert.match(files['posts/test.html'].content, /<h1>原标题<\/h1>/);
            assert.doesNotMatch(files['posts/test.html'].content, /publishedAt:/);
            assert.equal(files['assets/images/test/image.png'].sha, 'assets/images/test/image.png-sha');
            for (const path of ['index.html', 'posts/test.html', 'admin/index.html', '说明.html']) {
                assert.match(files[path].content, /<footer class="site-version">版本 <code>12345678<\/code><\/footer>\s*<\/body>/);
                assert.ok(!files[path].content.includes(sourceHead));
            }
            assert.equal(files['article-footer.html'].sha, 'templates/article-footer.html-sha');
            assert.equal(files['resume.pdf'].sha, 'public/resume.pdf-sha');
            assert.equal(files['简历.pdf'].sha, 'public/简历.pdf-sha');
            assert.equal(files['public/resume.pdf'], undefined);
            assert.equal(files['public/简历.pdf'], undefined);
            assert.equal(files['.nojekyll'].content, '');
            assert.equal(files['content/test.md'], undefined);
            assert.equal(files['templates/blog.css'], undefined);
            assert.equal(files['main.json'], undefined);
            return { body: { sha: 'output-tree' } };
        }
        if (path.endsWith('/git/commits')) {
            const commit = JSON.parse(options.body);
            assert.deepEqual(commit.parents, previous ? [previous] : []);
            assert.equal(commit.message, 'Deploy main ' + sourceHead);
            return { body: { sha: 'output-commit', html_url: 'https://github.com/example' } };
        }
        if (path.includes('/git/refs')) {
            assert.deepEqual(JSON.parse(options.body), previous
                ? { sha: 'output-commit', force: false }
                : { ref: 'refs/heads/gh-pages', sha: 'output-commit' });
            assert.equal(method, previous ? 'PATCH' : 'POST');
            moved = true;
            return { body: {} };
        }
        const key = decodeURIComponent(path.split('/contents/')[1] ?? '');
        if (Object.hasOwn(contents, key)) return { body: { type: 'file', encoding: 'base64', content: base64(contents[key]) } };
        throw new Error('Unexpected request: ' + path);
    });
    const { posts } = await loadStatus(repo);
    assert.deepEqual(posts, [{ slug: 'test', title: '原标题', publishedAt: '2026-11-19T14:55:23.000Z' }]);
    assert.equal(await loadArticle(repo, 'test', sourceHead), '你好 ![图](../assets/images/test/image.png)');
    assert.equal((await deploySite(repo)).created, true);
    assert.equal(moved, true);
    previous = 'last-deploy';
    moved = false;
    assert.equal((await deploySite(repo, sourceHead)).site, 'https://example.org');
    assert.equal(moved, true);
    moved = false;
    changed = true;
    sourceReads = 0;
    await assert.rejects(deploySite(repo), { status: 409 });
    assert.equal(moved, false);
});
