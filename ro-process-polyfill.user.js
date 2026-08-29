// ==UserScript==
// @name         仙境传说 · muMu 模拟器 process 补丁（V2.6.10 配套）
// @namespace    dsh.ro-plugin
// @version      1.0.0
// @description  修复 muMu 模拟器 Edge 中 Online_mn.js 的 nw.js 检测 ReferenceError（process.versions.node 未定义）。
//               仅注入 node 字段，勿加 platform/env 等其他字段（会触发站点 WebGL 分支误判）。
//               配合 muMu 渲染模式= Vulkan 使用；真机 Edge 无需此脚本。
// @author       DSH
// @match        https://post.lastro.cn/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
  "use strict";
  // 仅在 muMu/异常环境中目标缺失时注入，最小 polyfill：process.versions.node
  try {
    if (typeof window.process === "undefined") {
      Object.defineProperty(window, "process", {
        value: { versions: { node: "0.0.0" } },
        configurable: true,
        writable: false
      });
    }
  } catch (e) {}
})();
