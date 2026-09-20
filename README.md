# 皇室战争 单机 Web 版

基于 HTML5 Canvas 的皇室战争玩法还原,纯前端实现,零依赖零构建,浏览器打开即玩。

- **在线玩**:https://larria.github.io/clashOnWEB/
- **产品规格**:docs/PRODUCT.md(玩法/卡牌/界面)
- **开发规范**:docs/DEV.md(架构/扩展指南/文档维护规则)
- **行动日志**:docs/LOG.md(历史变更记录)

## 快速开始

```bash
cd clash && python3 -m http.server 8000
# 访问 http://localhost:8000(ES Modules 需 http 协议,file:// 不可用)
```

## 技术栈

纯 HTML + CSS + JavaScript(ES Modules),Canvas 2D 渲染,GitHub Pages 部署。
