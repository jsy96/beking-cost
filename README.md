# 成本核算与利润统计系统 - 云端部署版

支持手机访问，免费托管在 Vercel 上。

## 一键部署到 Vercel

### 方法1：通过 Vercel 网站（推荐）

1. 访问 [vercel.com](https://vercel.com) 并登录（支持 GitHub/GitLab 账号）

2. 点击 **「New Project」**

3. 选择 **「Import Git Repository」** 或直接上传项目文件夹

4. 点击 **「Deploy」** 按钮，等待部署完成

5. 部署成功后会获得一个类似这样的网址：
   ```
   https://你的项目名.vercel.app
   ```

### 方法2：通过 Vercel CLI

```bash
# 安装 Vercel CLI
npm i -g vercel

# 登录
vercel login

# 部署
vercel
```

---

## 使用说明

1. **打开网址**：使用部署后的网址，例如 `https://你的项目名.vercel.app`

2. **配置飞书API**：
   - 点击右上角「配置」按钮
   - 填入 App ID、App Secret、Sheet Token
   - 保存后即可使用

3. **手机访问**：直接在手机浏览器打开网址即可

---

## 文件说明

| 文件 | 作用 |
|------|------|
| `index.html` | 主页面 |
| `app.js` | 前端逻辑 |
| `style.css` | 样式文件 |
| `api/index.js` | 云函数（代理飞书API） |
| `vercel.json` | Vercel 配置 |
| `package.json` | 项目配置 |

---

## 常见问题

**Q: 部署后访问提示错误？**
A: 检查 Vercel 部署日志，确认 api/index.js 是否正确部署

**Q: 如何修改域名？**
A: 在 Vercel 项目设置中可以绑定自定义域名

**Q: 数据安全吗？**
A: 所有数据存储在你的飞书多维表格中，系统只是通过API读写

---

## 本地运行（可选）

如果需要在本地测试：

```bash
npm install
npm start
```

然后访问 `http://localhost:3000`
