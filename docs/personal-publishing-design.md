# 个人 GitHub Pages 编辑与发布设计

## 目标与现状

将从 `isnowfy/simple` fork 的编辑工具改为按账号隔离的编辑器。每位登录者可以编辑、上传图片并发布到自己名下的 `<用户名>/<用户名>.github.io`。MountainWang 的文章、生成页和图片都保存在 `MountainWang/mountainwang.github.io`。

发布分支的 `index.html` 展示文章列表，`/admin/` 提供 Markdown 编辑、实时预览和发布。旧版 Simple 将 Markdown 嵌入 HTML 注释，供迁移时提取。

## 令牌与仓库权限

公开站和编辑器由 GitHub Pages 托管。用户在 `/admin/` 输入仅授权自身 Pages 仓库、具有 `Contents: Read and write` 权限的 fine-grained PAT。浏览器只在内存中保留令牌，直接请求 GitHub API。编辑器使用同源脚本，文章预览放在隔离的 iframe 内。

编辑器通过 GitHub API 查询令牌所属用户，根据登录名找到个人 Pages 仓库，验证仓库所有者的数字 ID，并在当前会话绑定仓库 ID。提交只使用该仓库的默认分支，GitHub API 验证令牌权限。站点使用分支发布。

[GitHub 令牌文档](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/managing-your-personal-access-tokens)

## 登录后的仓库判断

| 状态 | 行为 |
| --- | --- |
| 已初始化 | 检查版本化的 `.site-config.json` ，再直接进入编辑器。 |
| 未初始化，目标仓库为空 | 填写站点标题后，自动写入首页模板、样式、共用文章页眉页脚和站点配置。成功后进入编辑器。只有 GitHub 明确确认仓库无提交，或目标分支的目录树确实为空，才走此流程。 |
| 未初始化，目标仓库已有内容 | 先显示提示页，列出检测到的文件和可用的迁移方式。即使只有 README 也走提示页。用户可以退出，或明确确认迁移方案后继续。 |
| 仓库不存在、权限不足或状态读取失败 | 提示创建仓库、检查令牌权限，或重试。暂停一切写入。 |

旧版 HTML 注释是迁移线索。提示页说明拟新增的文件。首版使用 `/blog.html` 作为新增的列表，保留原首页、`CNAME`、静态资产和文章 URL，遇到路径冲突时等待人工迁移。对初始化标记缺失、损坏或版本不支持的仓库，给出对应提示。MountainWang 仓库已完成初始化，其文章列表写入 `index.html`。

空仓库初始化要使用支持首次提交的路径。Git Data API 无法为真正无提交的仓库创建引用，因此可先通过 Contents API 创建一份引导文件，随后在一条提交中补齐模板与初始化标记。初始化过程中检测到其他写入时，重新判断仓库状态。重试时仅在能够确认上一次引导提交且期间未发生其他写入的情况下续跑。

[GitHub Git References API](https://docs.github.com/en/rest/git/refs#create-a-reference) · [GitHub Contents API](https://docs.github.com/en/rest/repos/contents#create-or-update-file-contents)

## 文件与图片

| 路径示例 | 用途 |
| --- | --- |
| `content/hello.md` | Markdown 原稿，文件头记录 `title` 和 `publishedAt` |
| `posts/hello.html` | 从 Markdown 及文章模板生成的静态页面 |
| `assets/images/hello/<hash>.png` | 随文章保存的图片 |

编辑器支持选择和拖入 PNG、JPEG、WebP、GIF。选图时提示填写替代文字，插入 `![图片说明](../assets/images/hello/<hash>.png)`。Markdown 和 HTML 各位于各自分支的一级目录，同一个相对路径可直接使用。提交前通过浏览器本地图片数据 预览新图；重开文章时加载已提交的图片。浏览器按文件内容验证格式，初始限制每张 5 MiB，限制提交的图片总大小，并用内容哈希生成文件名。首版保留已有图片供旧版本和其他引用使用。

## 保存与发布

1. 打开文章时，从源码分支读取 Markdown 并记录分支头。编辑中的文字和图片留在会话中。
2. 「提交并发布」用 GitHub GraphQL 的 `createCommitOnBranch` 将 Markdown、原始图片保存到源码分支，使用 `expectedHeadOid` 防止覆盖并发改动。
3. 从同一个源码 SHA 读取模板和 `content/` 下的 Markdown 文件，生成完整站点树。图片、编辑器和其他静态文件使用源树里的 Git blob。输出分支为 `gh-pages`，第一次构建创建分支，以后以非强制方式更新。发布提交中记录源码 SHA。
4. 若源码保存成功而产物提交失败，显示源码提交链接和错误。「重新发布站点」从最新源码 SHA 构建，无需再次保存文章。
5. Pages 以 `gh-pages` 根目录为发布来源，分支中包含 `.nojekyll` 和公开站点配置。迁移时先生成并检查产物，再切换 Pages 来源。

[GitHub Git Trees API](https://docs.github.com/en/rest/git/trees) · [GitHub Pages 发布来源](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)

## 迁移和验收

- 切换前检查已发布页面是否含旧 Markdown 注释。有的话提取成独立原稿，保留现有 URL，并比对渲染结果。已有站点的首页暂时保留。切换旧入口前先核对用途。
- 验证无效令牌会提示错误，编辑器仅选中令牌所属账号的 Pages 仓库。分别验证三种仓库状态的跳转，以及读取失败时无写入。验证刷新或退出后需要重新输入令牌。验证本人能打开旧文、新建文章、预览图片并发布，且源码提交和产物提交各自包含正确的文件。
- 验证并发修改和发布失败时可继续编辑。上线后打开文章和图片链接，抽查原有简历及自定义域名。
- 每个仓库的编辑与发布权限归其所有者。公开仓库中的 Markdown 与图片可被访客读取，私密草稿应留在本地或独立私有存储，直到决定发布。
