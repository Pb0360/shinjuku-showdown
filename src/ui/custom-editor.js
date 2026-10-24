/* 自定义角色编辑器（界面层）
 *   · 名字 / 血量（默认 1000，可改）/ 3 个技能槽（从现有技能任选，可重复）/ 1 个被动
 *   · 存在浏览器本地，可建多个、可改、可删
 */
(function () {
  var SH = (window.SH = window.SH || {});

  function el(tag, cls, text) {
    var d = document.createElement(tag);
    if (cls) d.className = cls;
    if (text !== undefined && text !== null) d.textContent = text;
    return d;
  }

  function esc(s) {
    return String(s === undefined || s === null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  var Editor = {
    root: null,
    editingId: null,

    open: function (editId) {
      if (!this.root) this.build();
      this.root.classList.add('on');
      this.editingId = editId || null;
      this.fillForm(editId ? SH.Custom.get(editId) : null);
      this.renderList();
    },

    close: function () {
      if (this.root) this.root.classList.remove('on');
    },

    isOpen: function () { return !!this.root && this.root.classList.contains('on'); },

    build: function () {
      var self = this;
      var root = el('div', 'ce-mask');
      root.id = 'customEditor';

      var panel = el('div', 'ce-panel');

      /* 头部 */
      var head = el('div', 'ce-head');
      head.appendChild(el('div', 'ce-title', '自定义角色'));
      var closeBtn = el('button', 'ce-x', '✕');
      closeBtn.addEventListener('click', function () { self.close(); });
      head.appendChild(closeBtn);
      panel.appendChild(head);

      var body = el('div', 'ce-body');

      /* ---- 表单 ---- */
      var form = el('div', 'ce-form');
      form.appendChild(el('div', 'ce-sub', '角色设定'));

      var rowName = el('div', 'ce-row');
      rowName.appendChild(el('label', 'ce-lb', '名字'));
      var nameInput = el('input', 'ce-input');
      nameInput.type = 'text';
      nameInput.maxLength = 12;
      nameInput.placeholder = '例如：我的主角';
      rowName.appendChild(nameInput);
      form.appendChild(rowName);

      var rowHp = el('div', 'ce-row');
      rowHp.appendChild(el('label', 'ce-lb', '血量'));
      var hpInput = el('input', 'ce-input');
      hpInput.type = 'number';
      hpInput.min = '100';
      hpInput.max = '5000';
      hpInput.step = '50';
      hpInput.value = '1000';
      rowHp.appendChild(hpInput);
      rowHp.appendChild(el('span', 'ce-hint', '默认 1000，可改（100 ~ 5000）'));
      form.appendChild(rowHp);

      form.appendChild(el('div', 'ce-sub', '技能（三个槽位，可以从任何角色里挑，允许重复）'));
      var skillSels = [];
      var opts = SH.Custom.skillOptions();
      for (var i = 0; i < 3; i++) {
        var r = el('div', 'ce-row');
        r.appendChild(el('label', 'ce-lb', ['Q', 'W', 'E'][i]));
        var sel = el('select', 'ce-select');
        var empty = el('option', null, '— 不使用 —');
        empty.value = '';
        sel.appendChild(empty);
        for (var k = 0; k < opts.length; k++) {
          var o = el('option', null, opts[k].label + '（' + opts[k].note + '）');
          o.value = opts[k].id;
          sel.appendChild(o);
        }
        r.appendChild(sel);
        skillSels.push(sel);
        form.appendChild(r);
      }

      form.appendChild(el('div', 'ce-sub', '被动（选一个）'));
      var rowPas = el('div', 'ce-row');
      rowPas.appendChild(el('label', 'ce-lb', '被动'));
      var pasSel = el('select', 'ce-select');
      var nonePas = el('option', null, '— 不使用被动 —');
      nonePas.value = '';
      pasSel.appendChild(nonePas);
      var pops = SH.Custom.passiveOptions();
      for (var p = 0; p < pops.length; p++) {
        var po = el('option', null, pops[p].label);
        po.value = pops[p].id;
        pasSel.appendChild(po);
      }
      rowPas.appendChild(pasSel);
      form.appendChild(rowPas);

      form.appendChild(el('div', 'ce-hint',
        '说明：自定义角色按【非咒术回战】处理 —— 打出的是暴击（不回血、不清 CD）。'));

      var actions = el('div', 'ce-actions');
      var saveBtn = el('button', 'ce-btn ce-btn-main', '保存');
      var newBtn = el('button', 'ce-btn', '清空重填');
      saveBtn.addEventListener('click', function () {
        self.saveFrom(nameInput, hpInput, skillSels, pasSel);
      });
      newBtn.addEventListener('click', function () { self.fillForm(null); });
      actions.appendChild(saveBtn);
      actions.appendChild(newBtn);
      form.appendChild(actions);

      body.appendChild(form);

      /* ---- 已保存列表 ---- */
      var listWrap = el('div', 'ce-listwrap');
      listWrap.appendChild(el('div', 'ce-sub', '已保存的自定义角色'));
      var list = el('div', 'ce-list');
      list.id = 'customList';
      listWrap.appendChild(list);
      body.appendChild(listWrap);

      panel.appendChild(body);
      root.appendChild(panel);
      document.body.appendChild(root);
      this.root = root;

      /* 表单引用 */
      this.nameInput = nameInput;
      this.hpInput = hpInput;
      this.skillSels = skillSels;
      this.pasSel = pasSel;
      this.list = list;

      root.addEventListener('click', function (e) {
        if (e.target === root) self.close();
      });
    },

    fillForm: function (def) {
      this.editingId = def ? def.id : null;
      this.nameInput.value = def ? def.name : '';
      this.hpInput.value = def ? def.hp : 1000;
      var ids = def ? (def.skills || []) : [];
      for (var i = 0; i < 3; i++) this.skillSels[i].value = ids[i] || '';
      var pops = SH.Custom.passiveOptions();
      this.pasSel.value = (def && def.passive) ? def.passive : '';
    },

    saveFrom: function (nameInput, hpInput, skillSels, pasSel) {
      var name = (nameInput.value || '').trim();
      if (!name) { nameInput.focus(); alert('请先给角色起个名字'); return; }
      /* 技能至多 3 个，可以一个都不选 */
      var skills = [];
      for (var i = 0; i < skillSels.length; i++) if (skillSels[i].value) skills.push(skillSels[i].value);
      var def = {
        id: this.editingId || undefined,
        name: name,
        hp: parseInt(hpInput.value, 10) || 1000,
        skills: skills,
        passive: pasSel.value
      };
      var saved = SH.Custom.save(def);
      if (!saved) { alert('最多只能存 ' + SH.Custom.MAX + ' 个自定义角色'); return; }
      this.fillForm(saved);
      this.renderList();
      this.refreshSelect();
    },

    renderList: function () {
      var self = this;
      var list = this.list;
      list.innerHTML = '';
      var all = SH.Custom.all();
      if (!all.length) {
        list.appendChild(el('div', 'ce-empty', '还没有自定义角色。填好上面的表单，点「保存」就行。'));
        return;
      }
      all.forEach(function (def) {
        var row = el('div', 'ce-item');
        var info = el('div', 'ce-iteminfo');
        info.appendChild(el('div', 'ce-itemname', def.name));
        var ch = SH.CHARACTERS[def.id];
        var names = [];
        if (ch) for (var i = 0; i < ch.skills.length; i++) names.push(ch.skills[i].name);
        info.appendChild(el('div', 'ce-itemmeta',
          (def.hp) + ' HP · ' + names.join(' / ') + ' · ' + ((ch && ch.passive) ? ch.passive.name : '无被动')));
        row.appendChild(info);

        var useBtn = el('button', 'ce-btn ce-btn-sm', '让玩家使用');
        useBtn.addEventListener('click', function () {
          if (SH.UI && SH.UI.setPick) SH.UI.setPick(0, def.id);
          self.close();
        });
        row.appendChild(useBtn);

        var editBtn = el('button', 'ce-btn ce-btn-sm', '编辑');
        editBtn.addEventListener('click', function () { self.fillForm(def); });
        row.appendChild(editBtn);

        var delBtn = el('button', 'ce-btn ce-btn-sm ce-btn-danger', '删除');
        delBtn.addEventListener('click', function () {
          if (!confirm('删除自定义角色「' + def.name + '」？')) return;
          SH.Custom.remove(def.id);
          if (self.editingId === def.id) self.fillForm(null);
          self.renderList();
          self.refreshSelect();
        });
        row.appendChild(delBtn);

        list.appendChild(row);
      });
    },

    /* 存/删之后重建选人界面，并保留原来的选择 */
    refreshSelect: function () {
      if (!SH.UI || !SH.UI.buildSelect) return;
      var keep = (SH.UI.picks || []).slice();
      SH.UI.buildSelect();
      for (var i = 0; i < keep.length; i++) {
        if (keep[i] && SH.CHARACTERS[keep[i]] && SH.UI.setPick) SH.UI.setPick(i, keep[i]);
      }
    }
  };

  SH.CustomEditor = Editor;
})();
