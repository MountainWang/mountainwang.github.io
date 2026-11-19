# mountainwang.github.io

MountainWang 的 GitHub Pages 博客和纯前端 Markdown 编辑器。编辑器支持实时预览、图片上传和直接提交到 GitHub。发布时从源码分支构建静态站点并更新 `gh-pages`。

## 页面入口

- `/` 显示本仓库的博客列表（`index.html`）。
- `/admin/` 是文章编辑器，由 GitHub Pages 托管。它直接通过 GitHub API 读写仓库。

## 源码和发布分支

- `master` 存放 Markdown（`content/`）、原始图片（`assets/`）、站点配置、模板（`templates/`）和编辑器代码。
- `gh-pages` 存放可部署的首页、文章 HTML、样式、图片和本站的 `/admin/`。每次构建使用一个明确的源码提交，并将该提交 SHA 写入产物提交说明。

编辑器从浏览器直接调用 GitHub API。点击「提交并发布」后，先保存文章源码，再从这个版本构建整站。产物提交失败时，文章仍保存在源码分支。点击「重新发布站点」可用最新源码重试，也可在修改模板后单独部署。

打开已发布文章后，可点击「删除文章」删除原稿和 `assets/images/<文章标识>/` 下的图片。可以连续删除多篇，再点击一次「重新发布站点」，将删除同步到线上。

文章列表直接读取 `content/<文章标识>.md`。文件名决定文章标识，文件头提供标题与首次发布时间，正文从文件头之后开始。

```markdown
---
title: "文章标题"
publishedAt: "2026-11-19T14:55:23.000Z"
---

正文
```

站点标题改在 `.site-config.json`。首页模板是 `templates/index.html`，文章模板是 `templates/article.html`，共用页眉页脚在 `templates/article-header.html` 和 `templates/article-footer.html`。更改后重新发布即可生效。额外需要发布的静态文件可放在 `public/`，该目录里的文件会复制到站点根目录。简历请在源码分支更新 `public/resume.pdf` 和 `public/简历.pdf`，重新发布后仍可通过 `/resume.pdf` 和 `/简历.pdf` 访问。

## 首次发布

1. 在 GitHub 创建细粒度个人访问令牌。资源所有者选自己的账号，仓库访问范围只选 `用户名.github.io`，仓库权限设置为 **Contents: Read and write**。 [GitHub 令牌文档](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)
2. 打开 `/admin/`，输入令牌并连接仓库。空仓库先填写站点标题并初始化。已初始化的仓库直接进入编辑。
3. 点击「重新发布站点」，从现有源码创建 `gh-pages`。确认产物包含首页、文章、图片和编辑器后，在 **Settings → Pages** 选择 **Deploy from a branch → gh-pages → /(root)**。之后的发布会更新同一个分支。

## 本地检查

从源码分支根目录运行 `python3 -m http.server 8000 --bind 127.0.0.1`，访问 `http://127.0.0.1:8000/admin/` 可打开本地编辑器。用 Node.js 22 或更新版本运行 `node --test tests/admin.test.mjs`。

## 致谢

本项目的灵感来源于 isnowfy 开发并开源的 Simple，沿用其在浏览器中编辑 Markdown 并发布到 GitHub Pages 的思路。现有编辑器和发布流程已重写，使用 GitHub 细粒度令牌、独立 Markdown 源文件和 `gh-pages` 产物分支。感谢原作者。 [原项目 isnowfy/simple](https://github.com/isnowfy/simple) · [作者 isnowfy](https://github.com/isnowfy)

感谢 OpenAI Codex 协助重写编辑器和发布流程，并完善测试与文档。
