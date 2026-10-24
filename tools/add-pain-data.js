/* 一次性：往 characters.js 里插入佩恩【天道】 */
'use strict';
const fs = require('fs');
const p = 'src/data/characters.js';
let src = fs.readFileSync(p, 'utf8');

if (src.includes("id: 'pain'")) { console.log('已存在'); process.exit(0); }

/* 插在 naruto 之前（保持角色顺序合理） */
const anchor = src.indexOf("    naruto: {");
if (anchor < 0) { console.log('MISS anchor'); process.exit(1); }
/* 往前找到 naruto 上面那段注释的开头 */
let cut = src.lastIndexOf('    /* =', anchor);
if (cut < 0) cut = anchor;

const pain = `    /* ============================================================
     * 佩恩【天道】 —— 1000 HP
     * 定位：控场 + 爆发。三招都是"引力和斥力"，把人吸过来再弹出去
     * 非咒术回战角色 → 打出的是【暴击】（不回血不清 CD）
     * ========================================================== */
    pain: {
      id: 'pain',
      series: 'naruto',       // 非咒术回战：只能打出【暴击】
      name: '佩恩【天道】',
      shortName: '佩恩',
      title: '轮回眼',
      hp: 1000,
      radius: 48,
      voiceDir: '佩恩',
      color: {
        main: '#7C3AED',
        light: '#EDE9FE',
        mid: '#A78BFA',
        dark: '#4C1D95',
        glow: 'rgba(124,58,237,0.45)'
      },

      /* ---------- 被动：轮回眼（占位，用户没指定，可以随时换） ---------- */
      passive: {
        id: 'rinnegan',
        name: '轮回眼',
        desc: [
          '轮回眼能看穿查克拉的流动：',
          '',
          '· 每 2.5 秒恢复 1% 最大生命。',
          '',
          '· （这个被动是我补的占位 —— 你原话里没提被动，想换随时说）'
        ].join('\\n'),
        interval: 2.5,
        healMaxHpPct: 0.01,
        healMissingPct: 0,
        _voiceKey: '轮回眼'
      },

      skills: [
        {
          id: 'pain1',
          slot: 1,                 // → Q
          name: '万象天引',
          short: '万象天引',
          voiceKey: '万象天引',
          cdType: 'cooldown',
          cd: 7.0,
          vfx: { zoom: 1.05, timeScale: 0.78, slow: 0.22 },
          desc: [
            '【CD 7 秒】在身前创造一个小型引力奇点。',
            '',
            '· 把范围内的【所有敌人】和【所有飞行物】强行吸向奇点，吸力极大。',
            '· 持续 1.2 秒，每 0.15 秒结算一次，共 8 段，单段 9 点（合计 72）。',
            '· 敌人被吸住时很难跑掉，可以用来把对手拖进你的节奏。',
            '· 属于【直伤】——无下限免疫不了。'
          ].join('\\n'),
          pull: {
            ahead: 150,           // 奇点在身前的距离
            radius: 200,          // 吸引半径
            duration: 1.2,
            interval: 0.15,
            damage: 9,
            accelBall: 2600,      // 对敌人的吸力
            accelProj: 2000,      // 对飞行物的吸力
            falloff: 0.5
          }
        },

        {
          id: 'pain2',
          slot: 2,                 // → W
          name: '神罗天征',
          short: '神罗天征',
          voiceKey: '神罗天征',
          cdType: 'charge',
          charges: 2,
          chargeTime: 8.0,
          /* 长按 0.2 秒 → 超·神罗天征 */
          hold: { threshold: 0.2 },
          vfx: { zoom: 1.04, timeScale: 0.80, slow: 0.10 },
          desc: [
            '【2 充能点 · 每 8 秒回充 1 点】',
            '',
            '· 短按（0.2 秒内松手）：立刻以自身为圆心弹开一圈，',
            '  免疫除直伤外的所有伤害 0.2 秒，把敌人和飞行物全部弹飞（弹力极大），',
            '  单段伤害较低（25 点）。充能额外 +5 秒。',
            '· 长按（按住 0.2 秒）：在 0.2 秒那一刻立刻放出【超·神罗天征】——',
            '  免疫除直伤外的所有伤害 1.0 秒，对以自身为圆心的巨大范围持续多段伤害',
            '  （半径 330，共 5 段，单段 26，合计 130）。充能额外 +10 秒。',
            '',
            '· 弹开属于【直伤】，无下限免疫不了；免疫只挡弹幕。'
          ].join('\\n'),
          repel: {
            short: { radius: 210, damage: 25, knockback: 1500, immunity: 0.2, cdAdd: 5 },
            big: { radius: 330, duration: 1.0, interval: 0.2, damage: 26, knockback: 900, immunity: 1.0, cdAdd: 10 }
          }
        },

        {
          id: 'pain3',
          slot: 3,                 // → E
          name: '地爆天星',
          short: '地爆天星',
          voiceKey: '地爆天星',
          cdType: 'cooldown',
          cd: 40,
          ultimate: true,
          vfx: { zoom: 1.15, timeScale: 0.25, slow: 1.10, big: true, roman: 'Chibaku Tensei' },
          desc: [
            '【大招 · CD 40 秒】开局带 15~20 秒随机初始 CD。',
            '',
            '· 向身前丢出一颗黑色球体，球体【越飞越慢】直到几乎停住。',
            '· 球体持续吸引【全场】的飞行物与敌人，吸力极大（半径 420）。',
            '· 同时从场地四周的墙壁不断剥离岩石（飞行物），岩石也会被吸向球体，',
            '  撞到敌人造成少量伤害（6 点）。',
            '· 持续 5 秒；技能结束后球体与所有岩石一起消失。'
          ].join('\\n'),
          core: {
            speed: 620,
            drag: 2.2,            // 速度衰减（越飞越慢）
            life: 5.0,
            r: 46,
            radius: 420,          // 吸引半径
            accelBall: 2200,
            accelProj: 2600,
            falloff: 0.45,
            rockEvery: 0.22,      // 每 0.22 秒从墙上剥一块岩石
            rockDamage: 6,
            rockR: 15,
            rockSpeed: 260
          }
        }
      ]
    },

`;
src = src.substring(0, cut) + pain + src.substring(cut);
fs.writeFileSync(p, src);
console.log('佩恩已插入');
