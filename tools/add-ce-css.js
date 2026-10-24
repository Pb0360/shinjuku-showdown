/* 自定义角色编辑器样式（米白简约风） */
'use strict';
const fs = require('fs');
const p = 'src/style.css';
let s = fs.readFileSync(p, 'utf8');
if (s.includes('.ce-mask')) { console.log('已存在'); process.exit(0); }
const css = `
/* ============ 自定义角色编辑器 ============ */
.pick-custom { border-style: dashed !important; color: var(--ink-2) !important; }

.ce-mask {
  position: fixed; inset: 0; z-index: 90;
  background: rgba(43,43,43,.34);
  display: none; align-items: center; justify-content: center;
  padding: 24px; -webkit-backdrop-filter: blur(2px); backdrop-filter: blur(2px);
}
.ce-mask.on { display: flex; }

.ce-panel {
  width: min(880px, 100%); max-height: 100%;
  background: var(--paper); border: var(--line); border-radius: 14px;
  box-shadow: 0 18px 60px rgba(43,43,43,.22);
  display: flex; flex-direction: column; overflow: hidden;
}
.ce-head {
  display: flex; align-items: center; justify-content: space-between;
  padding: 14px 18px; border-bottom: var(--line);
}
.ce-title { font-size: 17px; font-weight: 800; letter-spacing: .5px; }
.ce-x {
  border: var(--line); background: var(--paper); border-radius: 8px;
  width: 30px; height: 30px; cursor: pointer; font-size: 14px; color: var(--ink-2);
}
.ce-x:hover { background: var(--paper-2); }

.ce-body { overflow: auto; padding: 16px 18px 20px; }
.ce-sub {
  font-size: 12px; font-weight: 700; color: var(--ink-2);
  letter-spacing: .6px; margin: 14px 0 8px;
}
.ce-sub:first-child { margin-top: 0; }

.ce-row { display: flex; align-items: center; gap: 10px; margin-bottom: 8px; }
.ce-lb { width: 44px; font-size: 13px; font-weight: 700; color: var(--ink-2); flex: none; }
.ce-input, .ce-select {
  border: var(--line); background: var(--paper); border-radius: 8px;
  padding: 7px 10px; font-size: 13px; color: var(--ink);
  font-family: inherit; min-width: 0;
}
.ce-input { width: 170px; }
.ce-select { flex: 1; }
.ce-input:focus, .ce-select:focus { outline: 2px solid var(--ink); outline-offset: -1px; }
.ce-hint { font-size: 11.5px; color: var(--ink-2); line-height: 1.6; }

.ce-actions { display: flex; gap: 8px; margin-top: 14px; }
.ce-btn {
  border: var(--line); background: var(--paper); color: var(--ink);
  border-radius: 9px; padding: 8px 14px; font-size: 13px; font-weight: 700;
  cursor: pointer; font-family: inherit;
}
.ce-btn:hover { background: var(--paper-2); }
.ce-btn-main { background: var(--ink); color: var(--paper); border-color: var(--ink); }
.ce-btn-main:hover { background: #000; }
.ce-btn-sm { padding: 5px 10px; font-size: 12px; }
.ce-btn-danger { color: #B4232A; border-color: rgba(180,35,42,.35); }
.ce-btn-danger:hover { background: rgba(180,35,42,.07); }

.ce-listwrap { margin-top: 6px; }
.ce-list { display: flex; flex-direction: column; gap: 8px; }
.ce-empty { font-size: 12.5px; color: var(--ink-2); padding: 10px 0; }
.ce-item {
  display: flex; align-items: center; gap: 8px;
  border: var(--line); border-radius: 10px; padding: 9px 11px; background: var(--paper-2);
}
.ce-iteminfo { flex: 1; min-width: 0; }
.ce-itemname { font-size: 13.5px; font-weight: 800; }
.ce-itemmeta {
  font-size: 11.5px; color: var(--ink-2); margin-top: 2px;
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}

html.touch .ce-input { width: 130px; }
html.touch .ce-btn { padding: 9px 13px; }
`;
fs.writeFileSync(p, s + css);
console.log('编辑器样式已加');
