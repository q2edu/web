# Chiikawa 伙伴大挑战

可部署到 Vercel 的移动端活动小游戏：20 秒寻找星星饼干、必须完成的朋友邀请任务、15 秒乌萨奇连点跳跃。指定 YouTube 音乐整段循环，目标音量 100%。

后台支持开房、自动生成房间 QR 码、总排行榜、房间排行榜、实时成绩更新和 CSV 导出。

## 先在本地试玩

```powershell
npm install
npm run dev
```

打开终端显示的网址。没有配置 Supabase 时，项目自动进入本地演示模式：

1. 首页默认进入“本地预览房”。
2. 点击首页底部“老师实时后台”。
3. 点击“进入本地演示后台”。
4. 可以开房、生成 QR、复制房间链接并查看排行榜。
5. 本地演示数据只保存在当前浏览器中。

## 最简单的 Supabase 设置

只需要一个 Supabase 项目、一次 SQL、一个老师账号、三项配置值。

### 1. 建立数据库

1. 登录 Supabase 并建立一个免费项目。
2. 打开 **SQL Editor → New query**。
3. 复制 [supabase/schema.sql](supabase/schema.sql) 的全部内容并运行一次。

这会自动建立房间表、成绩表、权限规则与 Realtime 配置。

### 2. 建立老师账号

1. 打开 **Authentication → Users → Add user**。
2. 建立老师邮箱和密码，并开启自动确认。
3. 回到 SQL Editor，运行 `schema.sql` 最底部的老师权限语句；只需把示例邮箱改成刚建立的邮箱。
4. 老师重新登录后即可使用后台。

建议在 **Authentication → Sign In / Providers** 关闭公开注册，只保留管理员建立的老师账号。

### 3. 复制三项配置

在 **Project Settings → API** 复制：

- Project URL
- Publishable key（前端可用）
- Secret key（保密，绝对不要放到前端或提交 Git）

将 `.env.example` 复制为 `.env.local`，填写以下四行；其中 Project URL 会使用两次：

```dotenv
VITE_SUPABASE_URL=https://你的项目.supabase.co
VITE_SUPABASE_PUBLISHABLE_KEY=你的-publishable-key
SUPABASE_URL=https://你的项目.supabase.co
SUPABASE_SECRET_KEY=你的-secret-key
```

重新运行 `npm run dev`，本地网站便会连接真实 Supabase。

## Vercel 发布

确认本地版本无误后：

1. 将项目推送到 GitHub，并在 Vercel 导入。
2. Framework 选择 **Vite**。
3. 在 Vercel 项目 **Settings → Environment Variables** 填入上面四个变量。
4. Build Command 使用 `npm run build`，Output Directory 使用 `dist`。
5. 部署后由老师开房；QR 会自动使用正式 Vercel 域名。

## 数据保护设计

- 学生只能通过 `POST /api/submissions` 写入成绩，不能直接读取数据库。
- Serverless API 会验证房间状态、分数、电话及资料同意状态。
- Secret key 只存在于 Vercel 服务端；旧项目的 `service_role` 也兼容。
- 只有带 `teacher` 权限的账号能读取成绩、朋友电话和排行榜。
- 网络异常时，成绩进入浏览器补传队列；恢复网络后自动重试。
- `attempt_id` 是唯一值，重复提交只会更新同一笔记录。
- 正式收集未成年人联系方式前，请确认当地隐私与家长授权要求。

图片素材位于 [public/assets](public/assets)。本页为非官方活动体验，与原作及版权方无隶属关系。
