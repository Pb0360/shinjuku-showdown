/* ==========================================================================
 * 新宿对决 —— 数值总表（唯一数值来源）
 * --------------------------------------------------------------------------
 * 想调整平衡：只改这个文件，不需要动任何代码。
 * 改完刷新浏览器即可生效（Electron 版重启程序生效）。
 *
 * 目录：
 *   1) SH.CONFIG       全局规则参数（场地、碰撞、黑闪、AI…）
 *   2) SH.CHARACTERS   角色：血量、半径、配色、3 技能 + 1 被动
 *
 * 伤害类型（整套平衡的骨架）：
 *   'barrage' 弹幕 —— 技能飞行物 / 持续伤害 / 领域斩击，可被「无下限术式」免疫
 *   'direct'  直伤 —— 球体碰撞 / 黑闪 / 无量空处 / 被「领域展延」强化过的命中，免疫不了
 *
 * 尺度说明：场地逻辑边长 720，球半径 46/50。
 *   「球球碰撞次数」大致正比于 速度 ×(两球半径之和) ÷ 场地面积，
 *   想让碰撞更频繁（黑闪更容易出现）就调大 ball.startSpeed 或调小 arena.size。
 * ========================================================================== */
(function () {
  var SH = (window.SH = window.SH || {});
  SH.VERSION = '0.1.0';
  /* ======================================================================
   * 1) 全局规则
   * ==================================================================== */
  SH.CONFIG = {
    /* 场地：逻辑坐标 size×size 的正方形，渲染时等比缩放到屏幕 */
    arena: {
      size: 720,           // 逻辑边长
      wallRestitution: 1.0 // 墙反弹能量保留（1 = 完全弹性，不衰减）
    },
    /* 球体运动 */
    ball: {
      startSpeed: 400,    // 开局初速（单位/秒）
      minSpeed: 300,      // 速度下限保护（低于此值会被拉回，避免球卡死在角落）
      maxSpeed: 900,      // 速度上限
      spawnPadding: 110,  // 出生点离墙最小距离
      spawnMinGap: 260    // 两个球出生时的最小间距
    },
    /* 球与球碰撞 */
    collision: {
      damage: 8,          // 每次碰撞互相造成的伤害（直伤）
      pairCooldown: 0.5,  // 同一对球多久内不重复结算伤害（防止贴脸连击）
      restitution: 1.0    // 球球碰撞弹性（等质量完全弹性 = 交换法向速度分量）
    },
    /* 加时赛：对局拖过 suddenDeath.start 秒后，全场伤害开始递增。
     * 这是为了兜住"双方都杀不死对方"的对局（例如鸣人分身铺开后对手打不到本体），
     * 70 秒以内的正常对局完全不受影响。 */
    suddenDeath: {
      start: 70,      // 从第 70 秒开始
      ramp: 25,       // 每过 25 秒，伤害倍率 +1
      maxMul: 5       // 倍率上限
    },
    /* 黑闪 —— 概率是"每次球球碰撞、每个角色各判一次"：
     *   一局平均约 15 次碰撞、双方各判一次，2.5% 的概率下每局期望 0.75 次
     *   → 大约一半的对局会出现黑闪。
     *   黑闪 = 181 点直伤 + 自己回满血 + 技能 CD 全清，会明显影响胜负。
 */
    blackFlash: {
      chance: 0.025,      // 每次碰撞、每个角色独立判定 2.5%
      exponent: 2.5,      // 伤害 = 原伤害 ^ 2.5  （8 ^ 2.5 ≈ 181）
      debugMultiplier: 1, // 调试倍率：1 = 真实概率（2.5%）
      zoom: 1.18,         // 黑闪镜头放大
      slowMo: 0.7         // 黑闪时间暂缓持续（秒）
    },
    /* 大招（领域展开）开局的初始冷却：随机取区间内的值，
     * 避免双方开局就互放大招，也让中段有"大招即将转好"的紧张感 */
    ultimateInitialCd: { min: 15, max: 20 },
    /* 出手手感 */
    castGlobalLock: 0.18,   // 两次释放之间的最小间隔（秒）；调小可让「2 充能连续释放」更顺
    aimLead: 0.5,           // 自动瞄准预判比例：0 = 瞄准当前位置，1 = 完全预判提前量
    projectilesPerSide: 120, // 单侧飞行物数量上限（安全阀；地爆天星会一次刷很多岩石）
    countdown: 3,           // 开局倒计时秒数
    /* 系统 AI（固定一档难度，只影响释放时机，不改任何数值） */
    ai: {
      thinkInterval: 0.15, // 决策间隔（秒）
      aimNoise: 0.04,      // 瞄准噪声（弧度），让它偶尔打偏，别像机器
      readyGate: 0.85,     // 技能就绪后每次决策有 85% 概率真的放出来
      reactWindow: 0.32,   // 无下限术式：预测到多少秒内会挨打就开免疫
      reactMissMargin: 24  // 预测落点离球心多近才算「会挨打」
    },
    /* 血量低于该比例时 HUD 血条变红闪烁 */
    lowHpRatio: 0.3,
    /* 特效总开关与强度（1 = 标准） */
    vfx: {
      enabled: true,
      screenZoom: true,
      slowMotion: true,
      shake: 1.0,
      damageNumbers: true
    },
    /* 音频音量（0~1），游戏内设置面板也会覆盖这里 */
    audio: {
      /* 自备背景音乐：把自己的音乐文件放进 src/assets/audio/bgm/，
       * 文件名去掉后缀就是这里填的名字（支持 mp3 / ogg / wav / m4a）。
       * 找不到文件会自动回退到内置的合成 BGM，不会报错。 */
      userBgm: 'RainieLove',
      sfxVolume: 0.75,
      voiceVolume: 0.9,
      bgmVolume: 0.28
    }
  };
  /* ======================================================================
   * 2) 角色
   * ==================================================================== */
  SH.CHARACTERS = {
    /* ============================================================
     * 五条悟 —— 500 HP
     * 定位：靠充能型技能高频骚扰 + 无下限免疫换取生存
     * ============================================================ */
    gojo: {
            series: 'jjk',          // 咒术回战：可打黑闪
id: 'gojo',
      name: '五条悟',
      shortName: '五条',   // 画在球上的名字（球面很短，只用两个字）
      title: '最强的咒术师',
      hp: 1000,
      radius: 46,
      voiceDir: '五条悟', // 语音文件夹名：assets/audio/voice/五条悟/
      color: {
        main: '#3B82F6',
        light: '#EAF4FF',
        mid: '#93C5FD',
        dark: '#1D4ED8',
        glow: 'rgba(59,130,246,0.45)'
      },
      /* ---------- 被动：反转术式 ---------- */
      passive: {
        id: 'reverse_curse',
        name: '反转术式',
        desc: [
          '每 2.5 秒恢复自身最大生命的 1%（10 点）。',
          '',
          '若这 2.5 秒内【未受到任何伤害】，额外恢复已失去生命的 2%。',
        ].join('\n'),
        interval: 2.5,          // 结算间隔（秒）
        healMissingPct: 0.02,   // 无伤额外回复：已失去生命的 2%
        _voiceKey: '反转术式'
      },
      /* ---------- 技能 ---------- */
      skills: [
        {
          id: 'gojo1',
          slot: 1,
          name: '术式顺转·苍 / 术式反转·赫 / 虚式·茈',
          short: '苍 / 赫',
          voiceKey: '苍',          // 默认语音键（实际按放出的招式取 blue/red/purple 的 voiceKey）
          cdType: 'charge',
          charges: 2,              // 2 充能点
          chargeTime: 3.0,         // 每点充能 3.0 秒（转好一圈才会补满一点）
          vfx: { zoom: 1.04, timeScale: 0.72, slow: 0.21 },  // 暂缓强度/时长都取原来的 ~70%
          desc: [
            '无下限的两种方向：顺转吸引，反转排斥；两力相撞即是虚式。',
            '',
            '【2 充能点】每点 3.0 秒回充；有 2 点时可连续释放。',
            '每次释放随机放出「苍」或「赫」（各 50%）。',
            '',
            '◆ 苍（蓝）· 半径 58 · 速度 150 · 存在 5 秒',
            '  缓慢移动的【漩涡】状能量球。它以自己为圆心张开一个【圆形引力场】：',
            '  半径 230 内的飞行物与敌方球都会被持续拉向圆心（越靠近圆心吸力越强）。',
            '  接触敌人每 0.16 秒造成 6 点弹幕伤害（多段）。撞墙会反弹。',
            '',
            '◆ 赫（暗红）· 半径 12 · 速度 700 · 单段',
            '  极小的直线高速飞行物，命中敌人或墙壁立即爆炸：',
            '  直击 30 点 + 爆炸半径 100（中心 32，边缘衰减到 12）。',
            '',
            '◆ 茈（紫）· 虚式 —— 赫 在飞行中撞到场上的 苍 时，在苍的位置合成茈。',
            '  【原地不动，不会飞出去】：半径从 81 逐渐膨胀到 120，存在 1.8 秒，',
            '  接触敌人每 0.12 秒造成 21 点弹幕伤害，最后炸开（半径 195，中心 99 → 边缘 35）。',
            '  茈 没有独立 CD，完全由组合触发。',
          ].join('\n'),
          modes: [
            { key: 'blue', weight: 1, voiceKey: '苍', title: '术式顺转·苍' },
            { key: 'red', weight: 1, voiceKey: '赫', title: '术式反转·赫' }
          ],
          blue: {
            r: 58, speed: 150, life: 5.0, bounceOnWall: true,
            attract: {
              radius: 330,       // 对球的引力半径（以苍的圆心为中心的圆形力场）
              accelProj: 760,    // 对其它飞行物
              accelBall: 2400,   // 对敌方球
              radiusRed: 420,    // 对「赫」的引力半径
              accelRed: 3200,    // 对「赫」的吸力
              falloff: 0.6       // 引力衰减指数：越小 = 整个范围内吸力越均匀（0.6 比线性 1.0 强得多）
            },
            fusionGrab: 58,      // 赫 被"抓住"合成茈的额外半径（避免赫先撞上敌人）
            hit: { amount: 6, type: 'barrage', interval: 0.16 }
          },
          red: {
            r: 12, speed: 700, life: 3.0, bounceOnWall: false,
            onWall: 'explode', onHit: 'explode',
            hit: { amount: 30, type: 'barrage' },
            explode: { radius: 100, center: 32, edge: 12, type: 'barrage' }
          },
          purple: {
            r: 81, growTo: 120, growTime: 0.5, speed: 0, life: 1.8, bounceOnWall: false,
            voiceKey: '茈', title: '虚式·茈',
            vfx: { zoom: 1.11, timeScale: 0.55, slow: 0.56, big: true, roman: 'Hollow Technique: Purple' },
            hit: { amount: 21, type: 'barrage', interval: 0.12 },
            explode: { radius: 195, center: 99, edge: 35, type: 'barrage' }
          }
        },
        {
          id: 'gojo2',
          slot: 2,
          name: '无下限术式',
          short: '无下限',
          voiceKey: '无下限',
          cdType: 'charge',
          charges: 3,              // 3 充能点
          chargeTime: 5.0,         // 每点 5.0 秒
          vfx: { zoom: 1.03, timeScale: 0.75, slow: 0.18 },  // 原来的 ~70%
          desc: [
            '【3 充能点】每点 5.0 秒回充。',
            '',
            '· 释放后 0.2 秒内免疫所有【弹幕伤害】。',
            '· 免疫期间碰到敌方飞行物会把它反弹回去',
            '  （速度反向 ×1.6，伤害取其 50%，归属变成自己）。',
            '· 如果这 0.2 秒内真的挡下了至少 1 次本会命中的弹幕伤害：',
            '  特效加大，免疫时间延长到 0.5 秒。',
            '· 免疫【弹幕】，以及球体碰撞、黑闪这类接触伤害。',
          '· 挡不住【无量空处】这类技能直伤。',
          ].join('\n'),
          immunity: {
            base: 0.2,        // 基础免疫时长
            extended: 0.5,    // 成功挡下后的延长时长
            reflect: true,    // 免疫期间反弹敌方飞行物
            reflectSpeedMul: 1.6,
            reflectDamageMul: 0.5
          }
        },
        {
          id: 'gojo3',
          slot: 3,
          name: '领域展开·无量空处',
          short: '无量空处',
          voiceKey: '无量空处',
          cdType: 'cooldown',
          cd: 40,                  // 大招 CD 40 秒，开局即可用
          ultimate: true,
          vfx: { zoom: 1.15, timeScale: 0.25, slow: 1.1, big: true, roman: 'Domain Expansion: Unlimited Void' },
          desc: [
            '【大招 · CD 40 秒】开局带 15~20 秒随机初始 CD。',
            '展开领域，向敌方灌输无限信息：',
            '对敌方造成 5 段 × 24 点 = 120 点【直伤】，1 秒内打完（每段间隔 0.2 秒）。',
            '同时【定身】对手 1 秒：无法移动、无法释放任何技能。',
            '',
            '· 被定身时对手的技能 CD 照常恢复，但按不出任何技能。',
          ].join('\n'),
          field: {
            kind: 'gojo3',
            castTime: 1.0,   // 领域持续 = 伤害打完的时间
            ticks: 5,
            interval: 0.2,
            damage: 24,
            bind: 1.0,       // 定身时长（秒）
            type: 'direct'
          }
        }
      ]
    },
    /* ============================================================
     * 宿傩 —— 600 HP
     * 定位：高血量 + 高频斩击压迫 + 领域展延穿透无下限
     * ========================================================== */
    sukuna: {
            series: 'jjk',          // 咒术回战：可打黑闪
id: 'sukuna',
      name: '宿傩',
      shortName: '宿傩',
      title: '诅咒之王',
      hp: 1200,
      radius: 50,
      voiceDir: '宿傩',
      color: {
        main: '#8B1A1A',
        light: '#F7E9DF',
        mid: '#C2705C',
        dark: '#4A0D0D',
        glow: 'rgba(139,26,26,0.45)'
      },
      /* ---------- 被动：领域展延 ---------- */
      passive: {
        id: 'domain_amplification',
        name: '领域展延',
        desc: [
          '把领域的必中效果压进斩击里。',
          '',
          '宿傩的每次攻击结算时，有 25% 概率【变成直伤】——',
          '当前所有技能的冷却 / 充能进度 +0.1 秒。',
        ].join('\n'),
        directChance: 0.25,     // 25% 概率变直伤
        cdPush: 0.1,           // 命中后推 CD 的秒数
        applyToCollision: false,
        _voiceKey: '领域展延'
      },
      /* ---------- 技能 ---------- */
      skills: [
        {
          id: 'sukuna1',
          slot: 1,
          name: '解 / 捌',
          short: '解 / 捌',
          voiceKey: '解',
          cdType: 'cooldown',
          cd: 2.2,                 // 解 的 CD
          cdGrid: 8.0,             // 捌 的 CD
          vfx: { zoom: 1.03, timeScale: 0.79, slow: 0.15 },  // 原来的 ~70%
          desc: [
            '按与敌人的距离自动切换招式：',
            '',
            '◆ 解 · CD 2.2 秒',
            '  向敌人方向挥出一字型斩击（长 300、宽 44、速度 1800），',
            '  单段 20 点弹幕伤害，出刀极快、CD 很短。',
            '',
            '◆ 捌 · CD 8.0 秒',
            '  在敌人位置展开【井字】网格斩击（3×3 格，每格边长 64），',
            '  每格 32 点弹幕伤害，同一目标最多结算 4 格 = 【128 点】。',
          ].join('\n'),
          nearRange: 160,          // 距离小于此值 → 捌
          slash: {
            halfLen: 150,          // 斩击线半长（总长 300）
            width: 44,             // 斩击线厚度
            speed: 1800,
            life: 1.0,
            onWall: 'disappear',
            hit: { amount: 20, type: 'barrage' }
          },
          grid: {
            cells: 3,              // 3×3
            cell: 64,              // 每格边长（比之前小一圈）
            cellPad: 24,           // 判定外扩（保证贴边格也能结算）
            life: 0.3,             // 井字存在时间（伤害有 maxHits 上限，拉长只为看得清）
            hit: { amount: 32, type: 'barrage' },
            maxHits: 4,            // 单次最多结算 4 格
            cornerAligned: true    // 让瞄准点落在十字交点上 → 稳定命中 4 格
          }
        },
        {
          id: 'sukuna2',
          slot: 2,
          name: '灶·开',
          short: '灶·开',
          voiceKey: '灶开',
          cdType: 'cooldown',
          cd: 9,
          vfx: { zoom: 1.05, timeScale: 0.69, slow: 0.25 },  // 原来的 ~70%
          desc: [
            '【CD 9 秒】',
            '凝聚一张火焰弓，向敌人方向射出【火焰箭】（飞行物 · 速度 780 · 半径 16）。',
            '命中：直击 45 点弹幕伤害，随后【灼烧】每秒 8 点、持续 4 秒（共 32 点）。',
            '',
            '· 箭撞到墙就消散，不会留下火场。',
            '· 重复命中会刷新灼烧时间。',
          ].join('\n'),
          arrow: {
            r: 16, speed: 780, life: 2.5,
            onWall: 'disappear', onHit: 'disappear',
            hit: { amount: 45, type: 'barrage' },
            burn: { dps: 8, duration: 4, type: 'barrage' }
          }
        },
        {
          id: 'sukuna3',
          slot: 3,
          name: '领域展开·伏魔御厨子',
          short: '伏魔御厨子',
          voiceKey: '伏魔御厨子',
          cdType: 'cooldown',
          cd: 35,                  // 大招 CD 35 秒
          ultimate: true,
          vfx: { zoom: 1.15, timeScale: 0.25, slow: 1.1, big: true, roman: 'Domain Expansion: Malevolent Shrine' },
          desc: [
            '无需封闭的结界：以自身为神龛，圈内万物皆为祭品。',
            '',
            '【大招 · CD 35 秒】开局即可使用，持续 5 秒。',
            '展开半径 288 的斩击领域（以释放瞬间宿傩的位置为中心，之后不再移动）：',
            '5 秒内每 0.1 秒对范围内的敌人自动释放一次',
            '相当于「解」原数值 20% 的斩击（24 × 20% = 4.8 点）。',
            '',
            '· 圈内每 0.1 秒判定一次；8 秒全中的理论伤害是 288 点。',
          ].join('\n'),
          field: {
            kind: 'sukuna3',
            radius: 288,           // 领域半径（240 × 1.2）
            duration: 7,           // 持续秒数
            interval: 0.1,         // 每 0.1 秒一次
            damageRatio: 0.15,     // 取「解」基础伤害的 20%
            refSkill: 'sukuna1',
            refAmount: 'slash.hit.amount',
            type: 'barrage'
          }
        }
      ]
    },
    /* ============================================================
     * 虎杖悠仁 —— 800 HP
     * 定位：近身缠斗 + 靠"必定黑闪"翻盘
     * 只有两个技能（一技能 Q / 三技能 E，没有二技能）
     * ========================================================== */
    yuji: {
            series: 'jjk',          // 咒术回战：可打黑闪
id: 'yuji',
      name: '虎杖悠仁',
      shortName: '虎杖',
      title: '西中之虎',
      hp: 800,
      radius: 48,
      speedMul: 1.3,           // 被动：移动速度 +30%
      voiceDir: '虎杖悠仁',
      color: {
        main: '#E4477A',
        light: '#FFE3EC',
        mid: '#F090B0',
        dark: '#7A1030',
        glow: 'rgba(228,71,122,0.45)'
      },
      /* ---------- 被动：西中之虎 ---------- */
      passive: {
        id: 'tiger_of_west',
        name: '西中之虎',
        desc: [
          '身体素质怪物级别：',
          '',
          '· 移动速度 +30%',
          '· 黑闪概率 +1%（2.5% → 3.5%）',
        ].join('\n'),
        /* 碰撞伤害加成已移除（原本 +1，实测太强） */
        collisionDamageBonus: 0,
        speedMul: 1.3,
        blackFlashBonus: 0.01,
        _voiceKey: '西中之虎'
      },
      /* ---------- 技能（只有 1 和 3） ---------- */
      skills: [
        {
          id: 'yuji1',
          slot: 1,                 // → Q
          name: '迳庭拳',
          short: '迳庭拳',
          voiceKey: '迳庭拳',
          cdType: 'cooldown',
          cd: 0.5,                 // 0.5 秒 CD
          vfx: { zoom: 1.04, timeScale: 0.78, slow: 0.12 },
          desc: [
            '咒力滞后于拳头的一击：对【附近】的敌人瞬间结算 2 次碰撞伤害',
            '',
            '（每次 = 自己的碰撞伤害 8 点，所以是 8 × 2 = 16 点），再附加 6 点直伤，',
            '合计 22 点。',
            '并把对手【弹开】。',
            '',
            '· 触发距离 200（以球体边缘算）。',
            '· 如果身上带着「黑闪」状态，这一拳会直接打出黑闪。',
          ].join('\n'),
          punch: {
            range: 200,            // 触发距离
            hits: 2,               // 结算 2 次碰撞伤害
            bonus: 6,              // 额外附加的直伤（第三下，固定 6 点）
            knockback: 950,        // 把对手推开的速度增量（比常规最高速 900 还大，等于直接轰飞）
            type: 'direct'
          }
        },
        {
          id: 'yuji2',
          slot: 2,                 // → W
          name: '黑闪',
          short: '黑闪',
          voiceKey: '黑闪',
          cdType: 'cooldown',
          cd: 60,                  // 唯一的第二个技能，也是他的大招
          ultimate: true,
          vfx: { zoom: 1.13, timeScale: 0.30, slow: 0.90, big: true, roman: 'Black Flash' },
          desc: [
            '【二技能 · CD 60 秒 · 大招】开局带 15~20 秒随机初始 CD。按键 W。',
            '进入「黑闪」状态：【下一次攻击必定打出黑闪】。',
            '',
            '· 黑闪 = 本次伤害变成原来的 2.5 次方（碰撞 8 → 8^2.5 ≈ 181 点直伤），',
            '  并且自己【血量回满】、【技能 CD 全部恢复】。',
            '· 状态会一直留着，直到你打出下一次攻击为止（不会过期）。',
          ].join('\n'),
          buff: {
            guaranteedBlackFlash: 1   // 给多少次"必定黑闪"
          }
        }
      ]
    },
    /* ============================================================
     * 变大球 —— 1000 HP
     * 到 70 秒前一直在变大：每秒 +10 半径、受伤减免 +1%
     * （技能未指定，暂时只有被动）
     * ========================================================== */
    bigball: {
      id: 'bigball',
      series: 'custom',
      name: '变大球',
      shortName: '变大球',
      title: '不断膨胀',
      hp: 1000,
      radius: 46,
      color: {
        main: '#7C3AED',
        light: '#EDE9FE',
        mid: '#A78BFA',
        dark: '#4C1D95',
        glow: 'rgba(124,58,237,0.4)'
      },
      passive: {
        id: 'grow',
        name: '变大',
        desc: [
          '· 开局到第 40 秒为止，持续变大：',
          '  半径 +7.1/秒（上限 330），受伤减免 +1.75%/秒（上限 70%）。',
          '· 第 40 秒时半径到上限 330、减免到上限 70%，之后停止增长。',
          '· 免疫【暴击】与【黑闪】的伤害。'
        ].join('\n'),
        grow: { radiusPerSec: 7.1, drPerSec: 0.0175, until: 40, maxRadius: 330, maxDr: 0.7 },
        immuneCrit: true        // 不吃暴击 / 黑闪
      },
      skills: []
    },

    /* ============================================================
     * 吸血球 —— 800 HP
     * 被动「吸血」：造成伤害的 80% 转为自身治疗
     * 一技能「蝠群」：变蝙蝠原地盘旋攻击，同时无敌 3 秒
     * ========================================================== */
    vampire: {
      id: 'vampire',
      series: 'custom',
      name: '吸血球',
      shortName: '吸血球',
      title: '血之眷属',
      hp: 800,
      radius: 46,
      color: {
        main: '#BE123C',
        light: '#FFE4E6',
        mid: '#FB7185',
        dark: '#881337',
        glow: 'rgba(190,18,60,0.4)'
      },
      passive: {
        id: 'lifesteal',
        name: '吸血',
        desc: [
          '· 自己造成的伤害，会有 80% 转化为自身的治疗。'
        ].join('\n'),
        lifesteal: 0.8
      },
      skills: [
        {
          id: 'vampire1',
          slot: 1,
          name: '蝠群',
          short: '蝠群',
          voiceKey: '蝠群',
          cdType: 'cooldown',
          cd: 12,
          vfx: { zoom: 1.08, timeScale: 0.6, slow: 0.3 },
          desc: [
            '· 化作蝠群【原地盘旋】，持续 3 秒，期间完全无敌。',
            '· 盘旋期间每 0.4 秒，对周围（半径 300）的敌人造成 8 点直伤。',
            '· 盘旋结束后恢复移动。'
          ].join('\n'),
          bat: { duration: 3.0, radius: 300, tickEvery: 0.4, damage: 8 }
        }
      ]
    },

    /* ============================================================
     * 波风水门 —— 1000 HP
     * 定位：全图机动。靠"飞雷神苦无"布点，然后瞬移过去打人
     * 非咒术回战角色 → 打出的是【暴击】
     * ========================================================== */
    minato: {
      id: 'minato',
      series: 'naruto',
      name: '波风水门',
      shortName: '水门',
      title: '金色闪光',
      hp: 1000,
      radius: 46,
      voiceDir: '水门',
      color: {
        main: '#F59E0B',
        light: '#FEF3C7',
        mid: '#FCD34D',
        dark: '#B45309',
        glow: 'rgba(245,158,11,0.45)'
      },
      passive: {
        id: 'golden_flash',
        name: '金色闪光',
        desc: [
          '木叶的黄色闪光。',
          '',
          '· 开局在出生点自带一枚飞雷神苦无。',
          '· 螺旋丸命中对手后，恢复自身 25 点生命。'
        ].join('\n'),
        startKunai: 1,
        rasenganHeal: 25,      // 螺旋丸命中对手后回血
        _voiceKey: '金色闪光'
      },
      skills: [
        {
          id: 'minato1',
          slot: 1,
          name: '忍爱之剑',
          short: '忍爱之剑',
          voiceKey: '忍爱之剑',
          cdType: 'cooldown',
          chargeTime: 4.5,          // 飞雷神标记的充能：5 → 4.5 秒
          cd: 5,                     // 取消充能点，改成 5 秒 CD
          hold: { threshold: 0.2 },  // 短按毁更早的苦无 / 长按毁更新的
          vfx: { zoom: 1.02, timeScale: 1, slow: 0 },     // 金色闪光不慢镜
          desc: [
            '· 朝【敌人方向】射出一枚飞雷神苦无。',
            '· 苦无飞行速度持续衰减，撞墙会反弹。',
            '· 命中敌人：15 点直伤 → 立刻与苦无交换位置 → 追加一次 20 点横斩。',
            '· 速度过低时苦无停下，变成留在场上的标记（不再是飞行物）。',
            '· 场上最多存在 2 枚；满 2 枚时：短按摧毁更早的，长按摧毁更新的。'
          ].join('\n'),
          kunai: {
            speed: 1500, decay: 1.25, stopSpeed: 130, r: 11,
            hit: 15, slash: 20, max: 2, life: 6.0
          }
        },
        {
          id: 'minato2',
          slot: 2,
          name: '飞雷神',
          short: '飞雷神',
          voiceKey: '飞雷神',
          cdType: 'charge',
          charges: 2,
          chargeTime: 5.0,
          castCd: 3,
          hold: { threshold: 0.2 },
          vfx: { zoom: 1.03, timeScale: 1, slow: 0 },     // 金色闪光不慢镜
          desc: [
            '· 短按：瞬移到【最新】的苦无处；长按：瞬移到【更早】的苦无处。',
            '· 落地后若附近有敌人，追加一次 15 × 2 的螺旋丸。',
            '· 飞雷神后 1 秒内可再按一次发动【飞雷神二段】：',
            '  瞬移到【另一枚】苦无处，并追加 25 × 2 的螺旋丸（不消耗充能）。'
          ].join('\n'),
          hiraishin: { rasengan: 15, stage2Rasengan: 25, hits: 2, stage2Hits: 2, range: 200, stage2: 1.0, freeStage2: true }
        },
        {
          id: 'minato3',
          slot: 3,
          name: '螺旋闪光超轮舞吼叁式',
          short: '螺旋闪光',
          voiceKey: '螺旋闪光超轮舞吼叁式',
          cdType: 'cooldown',
          cd: 35,
          ultimate: true,
          vfx: { zoom: 1.15, timeScale: 1, slow: 0, big: true, roman: 'Hiraishin' },   // 取消暂缓
          desc: [
            '· 朝敌人方向扇形依次丢出 5 枚苦无（仅大招用，不占场上 2 枚上限）。',
            '· 之后按【离自己最远优先】的顺序瞬移过去，每两枚之间拖出一条斩击（每段 25 点）。',
          '· 结束后还会依次瞬移到场上【最新与更早】的两枚标记，各再斩一次。',
            '· 大招结束后，这些苦无消失。'
          ].join('\n'),
          dance: { count: 5, spread: 0.5, speed: 1700, speedJitter: 700, decay: 0.7, delay: 1.0, interval: 0.22, slash: 25, slashR: 150, trailLife: 0.3 }
        }
      ]
    },
    /* ============================================================
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
        main: '#EA580C',        // 天道配色：橙
        light: '#FFEDD5',
        mid: '#FB923C',
        dark: '#9A3412',
        glow: 'rgba(234,88,12,0.45)'
      },
      /* ---------- 被动：轮回眼（占位，用户没指定，可以随时换） ---------- */
      passive: {
        id: 'rinnegan',
        name: '黑棒',
        desc: [
          '轮回眼制造的黑棒，能扰乱对手的查克拉。',
          '',
          '· 每次碰撞，在碰撞点留下一枚黑棒（短黑线，最多 5 枚）。',
          '· 用万象天引吸住敌人时：销毁全部黑棒，每枚造成 20 点直伤，',
          '  并把敌人定身（秒数 = 黑棒数，1~5 秒）。',
          '· 每摧毁一根黑棒，万象天引 CD +1 秒。',
        ].join('\n'),
        /* 黑棒：碰撞留棒，万象天引吸住敌人时销毁全部黑棒 + 伤害 + 定身 */
        blackRod: { max: 5, damageEach: 20 },
        cdPerRod: 1,                            // 每摧毁一根黑棒，万象天引 CD +1 秒
        _voiceKey: '黑棒'
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
            '· 【吸一下】：释放瞬间把范围内（330）的所有敌人和飞行物【瞬移到奇点中心】。',
            '· 之后 1 秒内每 0.125 秒结算一次，共 8 段，单段 8 点（合计 64）。',
          ].join('\n'),
          pull: {
            ahead: 150,           // 奇点在身前的距离
            radius: 230,
            duration: 1.0,
            interval: 0.125,
            damage: 8,
            /* 【吸一下】：释放瞬间给一次强拉力（速度增量），不是持续吸 */
            spread: 34,           // 瞬吸到中心后，多颗球散开的半径
            /* 之后的持续弱吸力 */
            accelBall: 620,
            accelProj: 760,
            holdFalloff: 0.9
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
            '· 短按（0.2 秒内松手）：立刻以自身为圆心弹开一圈（弹力极大，2400），',
            '  免疫除直伤外的所有伤害 0.2 秒，把敌人与飞行物弹飞，单段 40 点。',
            '  放完进入 5 秒释放冷却（和充能点恢复互相独立）。',
            '· 长按（按住 0.2 秒）：在 0.2 秒那一刻立刻放出【超·神罗天征】——',
            '  本体在原地不动，免疫除直伤外的所有伤害 1.0 秒，',
            '  对以自身为圆心的巨大范围持续多段伤害（半径 264，共 5 段，单段 26，合计 130）。',
            '  放完进入 10 秒释放冷却。',
          ].join('\n'),
          repel: {
            short: { radius: 192, ringScale: 4, damage: 40, knockback: 2400, immunity: 0.2, castCd: 5 },   // 圈 = 角色半径 ×4（= 直径的 2 倍）
            big: { radius: 264, duration: 1.0, interval: 0.2, damage: 26, knockback: 900, immunity: 1.0, castCd: 10 }
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
            '六道之力凝为核心，将大地尽数吸上天空。',
            '',
            '【大招 · CD 40 秒】开局带 15~20 秒随机初始 CD。',
            '',
            '· 向身前丢出一颗黑色球体，球体【越飞越慢】直到几乎停住。',
            '· 球体持续吸引【全场】的飞行物与敌人，吸力极大（半径 420）。',
            '· 同时从墙上不断剥离岩石，岩石被吸向球体：',
            '  · 碰到敌人不会消失，持续挤压（每 0.25 秒 2 点）',
            '· 被吸到球心附近（105 范围）的敌人会被强引力钉在球心。',
            '· 持续 5 秒；技能结束后球体与岩石一起崩散消失。',
          ].join('\n'),
          core: {
            speed: 620,
            drag: 2.2,            // 速度衰减（越飞越慢）
            life: 5.0,
            r: 20,                // 黑球更小
            radius: 420,          // 吸引半径
            accelBall: 2400,
            accelProj: 2800,
            falloff: 0.45,
            sealRadius: 105,      // 被吸进这个范围的敌人会被【封印】在球心
            rockEvery: 0.065,     // 每 0.065 秒剥一块（换算成每 tick 剥 2 块，新石头不断飞进来）
            maxRocks: 40,         // 同时存在的岩石上限（球最终多大完全由它决定）
            rockDamage: 0,         // 撞击本身不结算，挤压走 crushDamage
            crushDamage: 2,        // 每次挤压伤害
            crushInterval: 0.25,   // 挤压间隔
            rockBlastRadius: 46,   // 岩石消失时的小爆炸半径
            rockBlastDamage: 2,    // 小爆炸伤害
            rockR: 19,
            rockSpeed: 300
          }
        }
      ]
    },
    /* ============================================================
     * 漩涡鸣人 —— 1000 HP
     * 定位：分身铺场 + 靠分身搓丸子爆发
     * 影分身会把 1000 点血量上限重新平分（1 个 = 500/500，2 个 = 333/333/334）
     * ========================================================== */
    naruto: {
            series: 'naruto',       // 非咒术回战：只能打出【暴击】
id: 'naruto',
      name: '漩涡鸣人',
      shortName: '鸣人',
      title: '吊车尾的忍者',
      hp: 1000,
      radius: 48,
      voiceDir: '漩涡鸣人',
      color: {
        main: '#F59E0B',
        light: '#FEF3C7',
        mid: '#FBBF24',
        dark: '#B45309',
        glow: 'rgba(245,158,11,0.45)'
      },
      /* ---------- 被动：漩涡血脉 ---------- */
      passive: {
        id: 'uzumaki_blood',
        name: '漩涡血脉',
        desc: [
          '漩涡一族的怪物体质：',
          '',
          '· 基础碰撞伤害 +1（8 → 9）。',
          '· 每 2 秒恢复 100 点血。',
          '· 如果是【分身】，改为每 2 秒恢复 20 点。',
          '· 分身的血量上限是按比例分走本体的，所以分身很脆、但一直在回血。',
          '· 分身死亡时，它那份血量上限会全部还给本体，并把上限的 10% 变成治疗。',
        ].join('\n'),
        healInterval: 2.0,
        collisionDamageBonus: 1, // 基础碰撞伤害 +1（8 → 9）
        healAmount: 100,        // 脱战（2 秒内没挨打）时的回血量
        healAmountCombat: 40,   // 战斗中（刚挨过打）只回这么多 —— 否则回血比对手输出还快，永远打不死
        healAmountClone: 20,
        _voiceKey: '漩涡血脉'
      },
      skills: [
        {
          id: 'naruto1',
          slot: 1,                 // → Q
          name: '影分身之术',
          short: '影分身',
          voiceKey: '影分身之术',
          cdType: 'cooldown',
          cd: 5.0,
          vfx: { zoom: 1.03, timeScale: 0.80, slow: 0.12 },
          clone: { hpEach: 100, max: 9 },   // 每个分身固定 100 血，最多 9 个
          desc: [
            '【CD 5 秒】分出一个比本体略小的影分身。',
            '',
            '· 每个分身固定 100 点血，剩下的全在本体身上：',
            '  1 个分身 = 分身 100 / 本体 900；9 个分身 = 每个 100 / 本体 100。',
            '· 最多同时存在 9 个分身。',
            '· 分身【不会】放技能，只会自己弹；它享受被动回血（每 2 秒 20）。',
            '· 分身【打不出黑闪】。',
            '· 分身死亡时：它的血量上限全部还给本体，并把上限的 10% 作为治疗给本体。',
            '· 分身撞到对手同样造成 8 点碰撞伤害。',
          ].join('\n')
        },
        {
          id: 'naruto2',
          slot: 2,                 // → W
          name: '色诱术',
          short: '色诱术',
          voiceKey: '色诱术',
          cdType: 'cooldown',
          cd: 20,
          vfx: { zoom: 1.05, timeScale: 0.72, slow: 0.22 },
          desc: [
            '变身术的另一种用法。',
            '',
            '【CD 20 秒】本体与场上所有分身进入 5 秒「色诱术」状态。',
            '',
            '· 期间受到的【除直伤以外】的所有攻击，都改为【恢复等量的血量】。',
            '  但球体碰撞、黑闪、无量空处这类【直伤】照样掉血。',
            '· 【代价】：状态期间你自己打出的伤害【全部无效】。',
          ].join('\n'),
          allure: { duration: 5.0 }
        },
        {
          id: 'naruto3',
          slot: 3,                 // → E
          name: '螺旋丸',
          short: '螺旋丸',
          voiceKey: '螺旋丸',
          cdType: 'cooldown',
          cd: 35,
          ultimate: true,
          vfx: { zoom: 1.15, timeScale: 0.25, slow: 1.10, big: true, roman: 'Rasengan' },
          desc: [
            '【大招 · CD 35 秒】开局带 15~20 秒随机初始 CD。',
            '',
            '· 需要场上【至少有 1 个分身】才能放。',
            '· 本体与最近的一个分身搓出【一颗】螺旋丸，带着它冲向对手。',
            '· 伤害 = 40 × X，其中 X = 1 + 场上分身数：',
            '  1 个分身 → 40 × 2 = 80；3 个分身 → 40 × 4 = 160；9 个分身 → 40 × 10 = 400。',
            '· 只有这一颗丸子，其他分身不参与搓丸子。',
            '丸子会追踪对手。',
          ].join('\n'),
          rasengan: {
            damage: 40,           // 总伤害 = 40 × X，X = 1 + 场上分身数
            hits: 2,              // 分 2 段结算（各 40×X/2）
            r: 27,
            speed: 700,
            life: 3.0,
            homing: 7.0,          // 追踪转向强度
            dash: 620             // 本体与最近的分身一起冲出去
          }
        }
      ]
    }
  };
  /* 便捷索引：id → 角色数据 */
  SH.charById = function (id) { return SH.CHARACTERS[id]; };
})();