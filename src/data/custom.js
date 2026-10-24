/* 自定义角色：数据层
 *   · 从现有角色的技能/被动里自由搭配（可以重复选，例如三个无下限）
 *   · 存在浏览器本地（localStorage），可以建多个、改、删
 *   · 存好后注册进 SH.CHARACTERS，其余所有系统（对局 / UI / AI）不用改
 */
(function () {
  var SH = (window.SH = window.SH || {});
  var KEY = 'shinjuku.custom.v2';
  var MAX = 12;

  /* 基础角色（不含自定义），自定义只能从这里取材，避免自我嵌套 */
  var BASE_IDS = Object.keys(SH.CHARACTERS);

  /* 自定义角色的配色（按顺序分配，各不相同） */
  var PALETTE = [
    { main: '#475569', light: '#F1F5F9', mid: '#94A3B8', dark: '#1E293B', glow: 'rgba(71,85,105,0.42)' },
    { main: '#0EA5E9', light: '#E0F2FE', mid: '#7DD3FC', dark: '#075985', glow: 'rgba(14,165,233,0.42)' },
    { main: '#10B981', light: '#D1FAE5', mid: '#6EE7B7', dark: '#065F46', glow: 'rgba(16,185,129,0.42)' },
    { main: '#F59E0B', light: '#FEF3C7', mid: '#FCD34D', dark: '#92400E', glow: 'rgba(245,158,11,0.42)' },
    { main: '#EF4444', light: '#FEE2E2', mid: '#FCA5A5', dark: '#991B1B', glow: 'rgba(239,68,68,0.42)' },
    { main: '#8B5CF6', light: '#EDE9FE', mid: '#C4B5FD', dark: '#5B21B6', glow: 'rgba(139,92,246,0.42)' },
    { main: '#EC4899', light: '#FCE7F3', mid: '#F9A8D4', dark: '#9D174D', glow: 'rgba(236,72,153,0.42)' },
    { main: '#14B8A6', light: '#CCFBF1', mid: '#5EEAD4', dark: '#115E59', glow: 'rgba(20,184,166,0.42)' }
  ];

  function load() {
    try {
      var raw = window.localStorage.getItem(KEY);
      if (!raw) return [];
      var a = JSON.parse(raw);
      return Object.prototype.toString.call(a) === '[object Array]' ? a : [];
    } catch (e) { return []; }
  }

  function store(list) {
    try { window.localStorage.setItem(KEY, JSON.stringify(list)); return true; }
    catch (e) { return false; }
  }

  function uid() {
    return 'custom_' + Math.random().toString(36).slice(2, 7) + Date.now().toString(36).slice(-3);
  }

  function findSkill(skillId) {
    for (var i = 0; i < BASE_IDS.length; i++) {
      var ch = SH.CHARACTERS[BASE_IDS[i]];
      if (!ch || !ch.skills) continue;
      for (var k = 0; k < ch.skills.length; k++) {
        if (ch.skills[k].id === skillId) return { char: ch, skill: ch.skills[k] };
      }
    }
    return null;
  }

  function findPassive(passiveId) {
    for (var i = 0; i < BASE_IDS.length; i++) {
      var ch = SH.CHARACTERS[BASE_IDS[i]];
      if (ch && ch.passive && ch.passive.id === passiveId) return ch.passive;
    }
    return null;
  }

  var Custom = {
    MAX: MAX,
    PALETTE: PALETTE,

    all: function () { return load(); },

    get: function (id) {
      var l = load();
      for (var i = 0; i < l.length; i++) if (l[i].id === id) return l[i];
      return null;
    },

    /* 新建或更新，返回存好的定义 */
    save: function (def) {
      var l = load();
      if (!def.id) def.id = uid();
      var hit = -1;
      for (var i = 0; i < l.length; i++) if (l[i].id === def.id) hit = i;
      if (hit >= 0) l[hit] = def;
      else {
        if (l.length >= MAX) return null;
        l.push(def);
      }
      store(l);
      Custom.register();
      return def;
    },

    remove: function (id) {
      var l = load().filter(function (d) { return d.id !== id; });
      store(l);
      Custom.register();
    },

    /* 可选素材（给编辑器用的下拉列表） */
    skillOptions: function () {
      var out = [];
      for (var i = 0; i < BASE_IDS.length; i++) {
        var ch = SH.CHARACTERS[BASE_IDS[i]];
        if (!ch || !ch.skills) continue;
        for (var k = 0; k < ch.skills.length; k++) {
          out.push({
            id: ch.skills[k].id,
            label: ch.name + ' · ' + ch.skills[k].name,
            note: (ch.skills[k].slot === 3 || ch.skills[k].ultimate) ? '大招' : (ch.skills[k].cdType === 'charge' ? '充能' : 'CD ' + ch.skills[k].cd + 's')
          });
        }
      }
      return out;
    },

    passiveOptions: function () {
      var out = [];
      for (var i = 0; i < BASE_IDS.length; i++) {
        var ch = SH.CHARACTERS[BASE_IDS[i]];
        if (ch && ch.passive) out.push({ id: ch.passive.id, label: ch.name + ' · ' + ch.passive.name });
      }
      return out;
    },

    /* 把一条定义编译成标准角色对象 */
    buildChar: function (def, index) {
      if (!def) return null;
      var skills = [];
      for (var i = 0; i < (def.skills || []).length && i < 3; i++) {
        var found = findSkill(def.skills[i]);
        if (!found) continue;
        var sk = JSON.parse(JSON.stringify(found.skill));   // 深拷贝：改槽位不会污染原角色
        sk.slot = i + 1;
        skills.push(sk);
      }

      /* 被动也可以留空：至多 1 个，不是必须有 */
      var pas = def.passive ? findPassive(def.passive) : null;
      var hp = Math.max(100, Math.min(5000, Math.round(def.hp || 1000)));
      var color = PALETTE[(index === undefined ? 0 : index) % PALETTE.length];

      return {
        id: def.id,
        series: 'custom',            // 非咒术回战 → 打出【暴击】（不回血不清 CD）
        name: def.name || '自定义角色',
        shortName: (def.name || '自定义').slice(0, 6),
        title: '自定义',
        hp: hp,
        radius: 48,
        voiceDir: '自定义',
        color: color,
        custom: true,
        passive: pas ? JSON.parse(JSON.stringify(pas)) : null,
        skills: skills
      };
    },

    /* 把所有自定义角色注册进 SH.CHARACTERS（先清掉旧的） */
    register: function () {
      Object.keys(SH.CHARACTERS).forEach(function (k) {
        if (k.indexOf('custom_') === 0) delete SH.CHARACTERS[k];
      });
      var l = load();
      for (var i = 0; i < l.length; i++) {
        var ch = Custom.buildChar(l[i], i);
        if (ch) SH.CHARACTERS[ch.id] = ch;
      }
      return Object.keys(SH.CHARACTERS);
    },

    /* 供 UI 判断 */
    isCustomId: function (id) { return String(id).indexOf('custom_') === 0; }
  };

  SH.Custom = Custom;
})();
