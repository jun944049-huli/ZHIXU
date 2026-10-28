const DB = {
  meta: {
    today: '2026-10-21',
    weekday: '周三',
    dateLabel: '2026 年 10 月 21 日',
    week: '第 43 周',
    now: '09:20'
  },

  user: {
    name: '李维',
    initials: '李',
    role: '项目负责人',
    workspace: '李维的工作台',
    color: '#2F5BE3'
  },

  settings: {
    assistantName: '知序'
  },

  capacity: {
    available: 7.2,
    committed: 6.5,
    meeting: 1.75,
    focus: 4.25,
    buffer: 1.2
  },

  workday: {
    start: '09:00',
    end: '18:00',
    lunch: '12:00–14:00',
    blocks: [
      { start: '09:00', end: '09:15', type: 'meeting', title: '星火每日站会' },
      { start: '09:15', end: '11:15', type: 'focus', title: '整理星火联调问题' },
      { start: '11:15', end: '12:00', type: 'buffer', title: '邮件与消息' },
      { start: '14:00', end: '15:30', type: 'meeting', title: '品牌升级提案评审' },
      { start: '15:30', end: '17:30', type: 'focus', title: '演示环境检查清单' },
      { start: '17:30', end: '18:00', type: 'buffer', title: '收尾与明日计划' }
    ]
  },

  projects: [
    {
      id: 'p1', name: '星火项目', code: 'XH',
      goal: 'Q4 客户演示与验收', color: '#2F5BE3', health: 'amber',
      progress: 62, planned: 70, next: '演示环境就绪', nextDate: '10/24',
      open: 12, risks: 3, owner: '李维',
      members: [
        { i: 'LW', c: '#2F5BE3' }, { i: 'ZC', c: '#1F8A70' }, { i: 'WY', c: '#C07A2B' }
      ],
      updated: '2 小时前'
    },
    {
      id: 'p2', name: '客户成功中台', code: 'CS',
      goal: '灰度上线与客户迁移', color: '#1F8A70', health: 'green',
      progress: 78, planned: 74, next: '灰度名单确认', nextDate: '10/30',
      open: 9, risks: 1, owner: '李维',
      members: [
        { i: 'LW', c: '#2F5BE3' }, { i: 'HY', c: '#6B5BD2' }
      ],
      updated: '昨天'
    },
    {
      id: 'p3', name: '品牌升级', code: 'BR',
      goal: '主视觉定稿与全渠道发布', color: '#C07A2B', health: 'red',
      progress: 41, planned: 58, next: '提案评审', nextDate: '10/23',
      open: 8, risks: 2, owner: '李维',
      members: [
        { i: 'LW', c: '#2F5BE3' }, { i: 'XC', c: '#B85C7A' }, { i: 'FY', c: '#4C7A3F' }
      ],
      updated: '3 小时前'
    },
    {
      id: 'p4', name: '内部工具链', code: 'IT',
      goal: 'SSO 接入与研发流程统一', color: '#6B5BD2', health: 'green',
      progress: 55, planned: 52, next: 'SSO 联调', nextDate: '10/25',
      open: 7, risks: 0, owner: '李维',
      members: [
        { i: 'LW', c: '#2F5BE3' }, { i: 'LQ', c: '#1F8A70' }
      ],
      updated: '昨天'
    },
    {
      id: 'p5', name: 'Q4 招聘', code: 'HR',
      goal: '补齐 3 个关键岗位', color: '#B85C7A', health: 'amber',
      progress: 30, planned: 40, next: '二面安排', nextDate: '10/26',
      open: 5, risks: 1, owner: '李维',
      members: [
        { i: 'LW', c: '#2F5BE3' }, { i: 'ZY', c: '#C07A2B' }
      ],
      updated: '2 天前'
    },
    {
      id: 'p6', name: '数据治理', code: 'DG',
      goal: '统一核心指标口径', color: '#4C7A3F', health: 'green',
      progress: 68, planned: 65, next: '口径评审', nextDate: '11/02',
      open: 6, risks: 0, owner: '李维',
      members: [
        { i: 'LW', c: '#2F5BE3' }, { i: 'SJ', c: '#6B5BD2' }
      ],
      updated: '今天'
    }
  ],

  tasks: {
    must: [
      {
        id: 't1', title: '整理星火联调问题并发给王总', project: 'p1',
        estimate: '2h', due: '今天 18:00', priority: 'P1',
        note: '下一步：汇总 8 条联调问题', progress: 35, subtasks: '2 / 4',
        ai: true, focus: true
      },
      {
        id: 't2', title: '品牌升级提案评审', project: 'p3',
        estimate: '1.5h', due: '14:00 会议', priority: 'P1'
      },
      {
        id: 't3', title: '修复演示环境登录问题', project: 'p1',
        estimate: '0.5h', due: '今天', priority: 'P0', blocked: true
      }
    ],
    should: [
      {
        id: 't4', title: '确认客户成功中台灰度名单', project: 'p2',
        estimate: '45m', due: '明天', priority: 'P2'
      },
      {
        id: 't5', title: '内部工具链 SSO 联调', project: 'p4',
        estimate: '1.25h', due: '周四', priority: 'P2'
      },
      {
        id: 't6', title: '整理本周周报初稿', project: null,
        estimate: '30m', due: '周五', priority: 'P3'
      }
    ],
    could: [
      {
        id: 't7', title: '数据治理：统一指标命名规范', project: 'p6',
        estimate: '2h', due: '下周', priority: 'P3'
      },
      {
        id: 't8', title: '归档上周项目会议纪要', project: null,
        estimate: '30m', due: '无截止', priority: 'P4'
      }
    ]
  },

  taskCalendar: {
    '2026-10-20': [
      { id: 'y1', title: '定位星火联调登录失败原因', project: 'p1', estimate: '1.5h', due: '17:30', priority: 'P1', done: true },
      { id: 'y2', title: '客户成功中台需求评审', project: 'p2', estimate: '1h', due: '14:00', priority: 'P2', done: true },
      { id: 'y3', title: '品牌升级竞品扫描', project: 'p3', estimate: '45m', due: '11:20', priority: 'P3', done: true },
      { id: 'y4', title: '更新 Q4 岗位 JD', project: 'p5', estimate: '30m', due: '昨天 18:00', priority: 'P2', overdue: true }
    ],
    '2026-10-22': [
      { id: 'tm1', title: '确认客户成功中台灰度名单', project: 'p2', estimate: '45m', due: '11:00', priority: 'P2' },
      { id: 'tm2', title: '准备星火演示环境检查清单', project: 'p1', estimate: '1h', due: '15:00', priority: 'P1' },
      { id: 'tm3', title: '和法务确认品牌商标风险', project: 'p3', estimate: '30m', due: '16:00', priority: 'P2' }
    ],
    '2026-10-23': [
      { id: 'f1', title: '内部工具链 SSO 联调', project: 'p4', estimate: '1.25h', due: '10:00', priority: 'P2' },
      { id: 'f2', title: '整理本周周报初稿', project: null, estimate: '30m', due: '17:00', priority: 'P3' }
    ],
    '2026-10-26': [
      { id: 'n1', title: '数据治理：统一指标命名规范', project: 'p6', estimate: '2h', due: '11:00', priority: 'P3' }
    ],
    '2026-10-27': [
      { id: 'n2', title: '星火客户演示', project: 'p1', estimate: '2h', due: '10:00', priority: 'P1' }
    ],
    '2026-10-28': [
      { id: 'n3', title: '客户成功中台灰度扩容方案评审', project: 'p2', estimate: '1.5h', due: '14:00', priority: 'P2' }
    ],
    '2026-10-29': [
      { id: 'n4', title: 'Q4 招聘面试复盘', project: 'p5', estimate: '1h', due: '16:00', priority: 'P2' }
    ],
    '2026-10-30': [
      { id: 'n5', title: '整理 10 月项目复盘', project: null, estimate: '1h', due: '17:00', priority: 'P3' }
    ]
  },

  overdue: [
    { id: 'o1', title: '补充星火验收清单', project: 'p1', days: 2 },
    { id: 'o2', title: '更新 Q4 岗位 JD', project: 'p5', days: 1 }
  ],

  waiting: [
    { id: 'w1', title: '运维开通测试库', person: '老周', project: 'p1', days: 5, impact: '阻塞联调' },
    { id: 'w2', title: '客户确认演示脚本', person: '张经理', project: 'p1', days: 2, impact: '影响演示' },
    { id: 'w3', title: '设计输出品牌主视觉', person: '小陈', project: 'p3', days: 1, impact: '影响评审' }
  ],

  meetings: [
    { time: '10:00', title: '星火每日站会', duration: '15m', people: '项目组', color: '#2F5BE3' },
    { time: '14:00', title: '品牌升级提案评审', duration: '60m', people: '品牌组 + 法务', color: '#C07A2B' },
    { time: '16:30', title: '客户成功中台周会', duration: '30m', people: '交付组', color: '#1F8A70' }
  ],

  inbox: [
    {
      id: 'i1', source: '飞书', sourceType: 'boss', person: '王总',
      time: '今天 10:42',
      raw: '星火下周要给客户演示，你把这周的联调问题整理一下，周三前发我，顺便把演示环境也准备下。',
      title: '整理星火联调问题并发给王总',
      project: 'p1', confidence: 93, alternatives: [],
      due: '10/23 18:00', p50: '2h', p90: '3h',
      basis: '过去 8 个同类问题整理任务中位数 1.8h，个人偏差系数 1.12',
      type: '分析整理', priority: 'P1',
      subtasks: ['汇总本周 8 条联调问题', '标注阻塞项与责任人', '准备演示环境检查清单', '发送给王总并抄送项目组'],
      note: '原文已保留，可随时回溯'
    },
    {
      id: 'i2', source: '邮件', sourceType: 'client', person: '张经理',
      time: '今天 09:15',
      raw: '客户希望把灰度名单从 10% 扩大到 30%，需要评估影响，本周内给个方案。',
      title: '评估灰度名单扩大至 30% 的影响',
      project: 'p2', confidence: 88, alternatives: ['星火项目'],
      due: '10/24 18:00', p50: '1.5h', p90: '2h',
      basis: '同类客户沟通任务中位数 1.2h，含方案整理',
      type: '沟通协调', priority: 'P2',
      subtasks: ['拉取当前灰度数据', '评估容量与客服压力', '输出一页方案'],
      note: '来自邮件转发，附件 1 个'
    },
    {
      id: 'i3', source: '会议', sourceType: 'meeting', person: '品牌评审会',
      time: '昨天 16:30',
      raw: '品牌升级评审：主视觉周五前定稿，法务需要同步看商标风险，另外官网首屏也要一起改。',
      title: '品牌主视觉定稿并同步法务商标风险',
      project: 'p3', confidence: 76, alternatives: ['官网改版', '品牌升级'],
      due: '10/23 12:00', p50: '3h', p90: '4h',
      basis: '置信度偏低：这句话同时涉及主视觉、法务和官网，建议拆分',
      type: '设计评审', priority: 'P1',
      subtasks: ['主视觉定稿', '法务商标风险确认', '官网首屏改版排期'],
      note: '会议纪要第 3 条，建议拆成 2 个任务'
    },
    {
      id: 'i4', source: '自己', sourceType: 'self', person: '快速记录',
      time: '今天 08:50',
      raw: '研究一下用本地模型处理敏感项目数据，看看能不能接到工作流里。',
      title: '调研本地模型处理敏感项目数据',
      project: null, confidence: 42, alternatives: ['内部工具链', '数据治理'],
      due: '未指定', p50: '1h', p90: '2h',
      basis: '未匹配到明确项目，建议先放入「个人成长」或新建项目',
      type: '研究探索', priority: 'P3',
      subtasks: ['对比 Ollama / LM Studio', '测试脱敏后的任务解析效果'],
      note: '缺少截止时间，已标记为待补充'
    }
  ],

  projectDetails: {
    p1: {
      client: '华北银行', period: '2026.09.01 – 11.15', team: '4 人',
      healthMetrics: [
        { label: '进度', value: '62%', sub: '计划 70%', trend: '-8%', tone: 'amber' },
        { label: '延期任务', value: '3', sub: '本周 +1', trend: '+1', tone: 'red' },
        { label: '阻塞', value: '2', sub: '平均 3.5 天', trend: '+0.5', tone: 'amber' },
        { label: '需求变更', value: '4', sub: '本月累计', trend: '+2', tone: 'ink' }
      ],
      milestones: [
        { name: '需求确认', date: '09/12', status: 'done' },
        { name: '联调完成', date: '10/18', status: 'done', note: '晚 2 天' },
        { name: '演示环境就绪', date: '10/24', status: 'risk', note: '依赖运维' },
        { name: '客户演示', date: '10/28', status: 'open' },
        { name: '验收', date: '11/05', status: 'open' }
      ],
      risks: [
        { title: '测试库开通延迟', p: 4, i: 4, score: 16, level: '高', owner: '老周', action: '已升级至王总，今日 12:00 前给结论' },
        { title: '演示脚本未确认', p: 3, i: 4, score: 12, level: '中', owner: '张经理', action: '周五前拿到客户反馈' },
        { title: '联调问题积压', p: 3, i: 3, score: 9, level: '中', owner: '李维', action: '每日站会跟踪，优先 P0/P1' }
      ],
      activity: [
        { time: '10:42', text: '王总在飞书新增任务「整理联调问题」', tone: 'accent' },
        { time: '09:20', text: '你完成了「联调环境自测」', tone: 'green' },
        { time: '昨天 17:10', text: '风险「测试库延迟」升级为高', tone: 'red' },
        { time: '昨天 16:30', text: '会议纪要已归档，提取 3 个行动项', tone: 'ink' }
      ],
      stakeholders: [
        { name: '王总', role: '发起人', i: 'WZ', c: '#2F5BE3' },
        { name: '张经理', role: '客户', i: 'ZJ', c: '#1F8A70' },
        { name: '老周', role: '运维', i: 'LZ', c: '#C07A2B' },
        { name: '小陈', role: '设计', i: 'XC', c: '#B85C7A' }
      ],
      time: { total: '18.5h', delta: '-2.5h', split: [
        { label: '联调', value: 8, color: '#2F5BE3' },
        { label: '会议', value: 4, color: '#6B5BD2' },
        { label: '文档', value: 3.5, color: '#1F8A70' },
        { label: '其他', value: 3, color: '#C07A2B' }
      ] },
      tasks: [
        { title: '整理联调问题并发给王总', status: '进行中', due: '今天', estimate: '2h', priority: 'P1' },
        { title: '修复演示环境登录问题', status: '阻塞', due: '今天', estimate: '0.5h', priority: 'P0' },
        { title: '补充验收清单', status: '逾期', due: '10/19', estimate: '1h', priority: 'P2' },
        { title: '联调环境自测', status: '已完成', due: '10/20', estimate: '1.5h', priority: 'P2' },
        { title: '客户演示脚本初稿', status: '待开始', due: '10/25', estimate: '2h', priority: 'P1' }
      ],
      docs: [
        { title: '星火项目周报 · W42', meta: '10/12 更新 · 李维', icon: 'file' },
        { title: '客户演示脚本 v0.3', meta: '10/20 更新 · 张经理', icon: 'file' },
        { title: '联调问题清单', meta: '今天 10:42 更新 · 自动汇总', icon: 'table' }
      ]
    }
  },

  projectNotes: {
    p1: [
      {
        id: 'n-p1-1',
        time: '今天 09:35',
        text: '与王总同步联调进度：核心接口已完成 80%，测试库仍未开通，已升级为高优先级风险。',
        raw: '今天跟王总同步了一下，联调差不多 80% 了，测试库还没开，风险挺高的。',
        source: '对话',
        author: ''
      },
      {
        id: 'n-p1-2',
        time: '昨天 16:30',
        text: '会议纪要已归档，提取 3 个行动项，分别归属王总、老周和张经理。',
        raw: '会开完了，纪要归档，提了 3 个行动项，王总、老周、张经理各一个。',
        source: '会议',
        author: ''
      }
    ],
    p2: [
      {
        id: 'n-p2-1',
        time: '昨天 14:10',
        text: '灰度名单已完成第一轮影响评估，等待数据团队补充近 30 天活跃口径。',
        raw: '灰度名单第一轮看完了，等数据那边补一下近 30 天活跃口径。',
        source: '对话',
        author: ''
      }
    ],
    p3: [
      {
        id: 'n-p3-1',
        time: '10/20',
        text: '主视觉方向已收敛到 B 方案，法务提示 2 条商标风险，需要在定稿前处理。',
        raw: '主视觉定 B 方案了，法务说有两个商标风险，定稿前要处理。',
        source: '评审',
        author: ''
      }
    ]
  },

  reports: {
    weekly: {
      label: '周报', title: '星火项目 · W43 周报',
      period: '2026.10.19 – 10.25', facts: 18,
      blocks: [
        { type: 'lead', text: '本周星火项目整体处于「关注」状态。联调进度符合预期，但测试库开通延迟已成为演示前的最大不确定性，需要在周三前拿到明确结论。' },
        { type: 'h', text: '本周完成' },
        { type: 'list', items: [
          '完成联调环境自测，覆盖 12 个核心接口，发现 8 个问题（#T1021）。',
          '输出客户演示脚本 v0.3，已发张经理确认（#T1018）。',
          '完成验收清单初稿，待补充 3 项边界场景（#T1015）。'
        ] },
        { type: 'h', text: '进行中' },
        { type: 'list', items: [
          '整理联调问题并发给王总，进度 35%，预计周三 18:00 前完成（#T1024）。',
          '演示环境登录问题修复，当前阻塞在运维开通测试库（#T1026）。'
        ] },
        { type: 'h', text: '风险与阻塞' },
        { type: 'list', items: [
          '测试库开通延迟 5 天，概率 4 × 影响 4，已升级至王总（#R01）。',
          '客户演示脚本尚未确认，若周五仍无反馈，演示内容存在返工风险（#R02）。'
        ] },
        { type: 'callout', text: '需要决策：若周三 12:00 前测试库仍不可用，建议启用备用环境，演示范围缩小到 3 个核心场景。' },
        { type: 'h', text: '下周计划' },
        { type: 'list', items: [
          '完成演示环境部署与全链路回归（10/27）。',
          '客户演示与现场答疑（10/28）。',
          '整理验收材料，启动验收流程（11/05）。'
        ] }
      ]
    },
    daily: {
      label: '日报', title: '今日工作日报 · 10 月 21 日',
      period: '2026.10.21', facts: 9,
      blocks: [
        { type: 'lead', text: '今天主要推进星火演示准备与品牌评审，完成 2 项，推进 3 项，新增 1 个阻塞。' },
        { type: 'h', text: '今日完成' },
        { type: 'list', items: [
          '完成联调环境自测，输出 8 条问题清单（#T1021）。',
          '品牌升级提案评审完成，法务提出 2 条商标风险（#T1028）。'
        ] },
        { type: 'h', text: '进行中' },
        { type: 'list', items: [
          '整理星火联调问题，已完成 35%（#T1024）。',
          '灰度名单影响评估，等待数据支持（#T1029）。'
        ] },
        { type: 'h', text: '阻塞 / 等待' },
        { type: 'list', items: [
          '测试库开通延迟 5 天，影响演示环境部署（#R01）。'
        ] },
        { type: 'h', text: '明日计划' },
        { type: 'list', items: [
          '完成联调问题整理并发送王总。',
          '跟进测试库开通，准备备用环境方案。',
          '输出灰度名单评估一页纸。'
        ] }
      ]
    },
    monthly: {
      label: '月报', title: '10 月项目月报',
      period: '2026.10.01 – 10.31', facts: 64,
      blocks: [
        { type: 'lead', text: '10 月共推进 6 个项目，完成 23 项任务，平均按时完成率 78%。星火项目与品牌升级需要重点关注。' },
        { type: 'h', text: '项目健康' },
        { type: 'list', items: [
          '星火项目：关注，进度落后计划 8%，主要受测试库延迟影响。',
          '品牌升级：风险，进度落后计划 17%，主视觉尚未定稿。',
          '客户成功中台：正常，灰度准备按计划推进。'
        ] },
        { type: 'h', text: '时间去向' },
        { type: 'list', items: [
          '项目交付 62%，会议 18%，文档与汇报 12%，其他 8%。',
          '会议占比高于上月 4 个百分点，建议压缩周会时长。'
        ] }
      ]
    }
  },

  reportHistory: {
    daily: {
      '2026-10-20': {
        label: '日报', title: '10 月 20 日工作日报', period: '2026.10.20',
        facts: 7,
        blocks: [
          { type: 'lead', text: '昨天完成 3 项任务，重点推进星火联调登录问题、客户成功中台需求评审与品牌竞品扫描；Q4 岗位 JD 仍未完成。' },
          { type: 'h', text: '昨日完成' },
          { type: 'list', items: [
            '定位星火联调登录失败原因，完成 1.5h 排查（#T1019）。',
            '客户成功中台需求评审完成，确认 3 个灰度前置条件（#T1022）。',
            '品牌升级竞品扫描完成，输出 5 个对标案例（#T1023）。'
          ] },
          { type: 'h', text: '遗留' },
          { type: 'list', items: [
            '更新 Q4 岗位 JD 未完成，已逾期 1 天（#T1027）。'
          ] },
          { type: 'h', text: '今日计划' },
          { type: 'list', items: [
            '整理星火联调问题并发给王总。',
            '准备品牌升级提案评审材料。'
          ] }
        ]
      }
    },
    weekly: {
      '2026-10-12': {
        label: '周报', title: '项目组合 · W42 周报', period: '2026.10.12 – 10.18',
        facts: 15,
        blocks: [
          { type: 'lead', text: '上周星火项目进入联调准备阶段，测试库申请已提交但尚未开通；品牌升级完成方向评审，Q4 招聘启动。' },
          { type: 'h', text: '上周完成' },
          { type: 'list', items: [
            '完成联调环境方案确认，提交测试库开通申请（#T1012）。',
            '品牌升级完成 3 个方向评审，收敛到 B 方案（#T1013）。',
            'Q4 招聘完成 4 个岗位 JD 初稿（#T1014）。'
          ] },
          { type: 'h', text: '进行中' },
          { type: 'list', items: [
            '客户成功中台灰度名单梳理，完成 60%（#T1016）。',
            '星火联调用例补充，完成 45%（#T1017）。'
          ] },
          { type: 'h', text: '风险与阻塞' },
          { type: 'list', items: [
            '测试库开通依赖运维排期，尚未给出明确时间（#R01）。'
          ] },
          { type: 'callout', text: '需要决策：若本周五前测试库仍未开通，下周联调计划需要顺延或启用备用环境。' }
        ]
      }
    },
    monthly: {
      '2026-09': {
        label: '月报', title: '9 月项目月报', period: '2026.09.01 – 09.30',
        facts: 58,
        blocks: [
          { type: 'lead', text: '9 月完成 Q3 复盘，推进 5 个项目，完成 19 项任务，平均按时完成率 81%。星火项目进入联调准备，品牌升级完成方向收敛。' },
          { type: 'h', text: '项目健康' },
          { type: 'list', items: [
            '星火项目：正常，联调准备按计划推进，测试库申请已提交。',
            '品牌升级：关注，方向评审完成，但主视觉尚未启动。',
            '客户成功中台：正常，灰度方案进入梳理阶段。'
          ] },
          { type: 'h', text: '时间去向' },
          { type: 'list', items: [
            '项目交付 58%，会议 20%，文档与汇报 14%，其他 8%。',
            '会议占比较 8 月下降 3 个百分点，深度工作时段保护初见效果。'
          ] },
          { type: 'h', text: '下月重点' },
          { type: 'list', items: [
            '星火项目完成联调并进入客户演示准备。',
            '品牌升级完成主视觉定稿与法务商标风险处理。',
            '客户成功中台完成灰度扩量方案。'
          ] }
        ]
      }
    }
  },

  profile: {
    period: '过去 8 周',
    sample: 312,
    radar: [
      { label: '执行力', value: 82 },
      { label: '估算力', value: 64 },
      { label: '节奏', value: 76 },
      { label: '结构', value: 58 },
      { label: '协作', value: 71 },
      { label: '成长', value: 69 }
    ],
    trend: [68, 72, 70, 75, 73, 78, 76, 82],
    heatmap: [
      [1, 1, 2, 3, 4, 4, 3, 2, 2, 1, 0, 0],
      [1, 2, 2, 3, 4, 3, 3, 2, 1, 1, 0, 0],
      [0, 1, 2, 4, 4, 4, 3, 3, 2, 1, 0, 0],
      [1, 2, 3, 3, 3, 2, 2, 2, 1, 1, 0, 0],
      [1, 1, 2, 4, 4, 3, 3, 2, 2, 1, 0, 0],
      [0, 0, 1, 2, 2, 1, 1, 1, 0, 0, 0, 0],
      [0, 0, 0, 1, 1, 1, 0, 0, 0, 0, 0, 0]
    ],
    insights: [
      { icon: 'clock', title: '周三上午是你的深度工作黄金时段', text: '9:00–11:30 的深度任务完成率比平均高 31%，建议把写方案、做分析放在这里。', tone: 'green' },
      { icon: 'target', title: '方案类任务平均超时 28%', text: '过去 12 次写方案，P50 预估平均 2.1h，实际 2.7h。系统已自动把这类任务的默认缓冲调到 1.3×。', tone: 'amber' },
      { icon: 'layers', title: '上下文切换在增加', text: '本周平均每天切换 14 次，比上月多 4 次，主要来自星火项目的临时插单。', tone: 'red' }
    ],
    experiments: [
      { title: '保护周三上午', text: '把 9:00–11:30 设为免打扰，只安排一个深度任务。' },
      { title: '方案类任务加 30% 缓冲', text: '让系统默认按 1.3× 估算，不再靠意志力硬扛。' },
      { title: '每天最多 2 次插单', text: '超出后进入「下周候选」，并生成跟老板的取舍说明。' }
    ]
  },

  chat: {
    model: 'DeepSeek',
    messages: [
      {
        role: 'assistant',
        time: '09:20',
        model: 'DeepSeek',
        text: '早上好，李维。你可以直接给我下指令，比如：\n「把星火项目的联调进度更新到 80%」\n「测试库风险升到高」\n「把今天的邮件拆成任务」。\n项目描述我会自动润色并记到项目表；结构性变更会先给你确认。',
        suggestions: [
          { label: '更新项目进展', text: '把星火项目的联调进度更新到 80%' },
          { label: '把消息拆成任务', text: '把王总在飞书说的竞品分析拆成任务，今天 17:00 前给结论' },
          { label: '检查今天能否接活', text: '今天还能接一个 2 小时的临时任务吗？' }
        ]
      },
      {
        role: 'user',
        time: '09:21',
        text: '星火项目联调已完成 80%，测试库还是没开通，帮我更新一下进展，并把风险等级提到高。'
      },
      {
        role: 'assistant',
        time: '09:21',
        model: 'DeepSeek',
        text: '我匹配到「星火项目」，准备更新 3 项。先确认，再写入。',
        actionCard: {
          type: 'progress',
          status: 'pending',
          title: '准备更新 · 星火项目',
          projectId: 'p1',
          progress: 80,
          items: [
            { label: '匹配项目', value: '星火项目 · 93%' },
            { label: '更新任务', value: '整理星火联调问题 · 35% → 80%' },
            { label: '更新风险', value: '测试库开通延迟 · 中 → 高' },
            { label: '新增等待', value: '运维开通测试库 · 已等 6 天' }
          ]
        }
      }
    ]
  },

  connectors: [
    // 内容与沟通
    { id: 'feishu', group: 'content', name: '飞书', mark: '飞', color: '#2F5BE3', status: 'on', meta: '10 分钟前同步' },
    { id: 'dingtalk', group: 'content', name: '钉钉', mark: '钉', color: '#1F8A70', status: 'off', meta: '未连接' },
    { id: 'wecom', group: 'content', name: '企业微信', mark: '企', color: '#4C7A3F', status: 'off', meta: '未连接' },
    { id: 'mail', group: 'content', name: '邮件 IMAP', mark: '邮', color: '#B85C7A', status: 'off', meta: '未连接' },
    { id: 'ics', group: 'content', name: '日历 ICS', mark: '日', color: '#6B5BD2', status: 'on', meta: '30 分钟前同步' },

    // 工作系统
    { id: 'excel', group: 'work', name: 'Excel / CSV', mark: 'X', color: '#1F8A70', status: 'on', meta: '2 个文件 · 今天 08:12' },
    { id: 'jira', group: 'work', name: 'Jira', mark: 'J', color: '#2F5BE3', status: 'off', meta: '未连接' },
    { id: 'zentao', group: 'work', name: '禅道', mark: '禅', color: '#C07A2B', status: 'off', meta: '未连接' },
    { id: 'webhook', group: 'work', name: 'Webhook', mark: '{}', color: '#6B5BD2', status: 'on', meta: '1 条自动化规则' },
    { id: 'github', group: 'work', name: 'GitHub', mark: 'G', color: '#4B5563', status: 'off', meta: 'Issue / PR' },

    // 插件与扩展
    { id: 'manual', group: 'plugin', name: '手动捕获', mark: '手', color: '#2F5BE3', status: 'on', meta: '全局快捷键 · 刚刚' },
    { id: 'browser', group: 'plugin', name: '浏览器插件', mark: '浏', color: '#6B5BD2', status: 'off', meta: '捕获网页选中内容' },
    { id: 'shortcut', group: 'plugin', name: '快捷指令', mark: '⌘', color: '#C07A2B', status: 'off', meta: 'iOS / macOS 快捷指令' },
    { id: 'n8n', group: 'plugin', name: 'n8n', mark: 'n', color: '#B85C7A', status: 'off', meta: '外部自动化 · Webhook' },
    { id: 'mcp', group: 'plugin', name: 'MCP Server', mark: 'M', color: '#1F8A70', status: 'off', meta: '让 AI 读写本地数据' }
  ],

  workflow: {
    version: 3,
    updated: '今天 09:12',
    text: '老板在飞书派活时，先判断是不是星火项目；截止时间按老板原话算。如果今天排不下，先给我看会挤掉什么，再决定接不接。每天 9:30 把今日必做和等待墙发给我。',
    rules: [
      { icon: 'message', title: '触发', text: '老板在飞书派活 → 进入收件箱，标记 P1' },
      { icon: 'folder', title: '归属', text: '命中「星火」别名 → 自动归入星火项目' },
      { icon: 'clock', title: '截止', text: '按老板原话解析，模糊时追问一次' },
      { icon: 'zap', title: '冲突', text: '今日排不下 → 先展示插单影响与取舍' },
      { icon: 'bell', title: '提醒', text: '每天 09:30 推送今日必做 + 等待墙' }
    ]
  },

  fields: {
    task: [
      { name: '客户', type: '文本', use: '关联客户名称', status: '启用' },
      { name: '合同号', type: '文本', use: '合同与结算', status: '启用' },
      { name: '验收人', type: '人员', use: '交付验收', status: '启用' },
      { name: '计费类型', type: '单选', use: '人力 / 固定价 / 内部', status: '启用' },
      { name: '优先级', type: '单选', use: 'P0–P4', status: '系统' }
    ],
    project: [
      { name: '项目代号', type: '文本', use: '分类与检索', status: '启用' },
      { name: '预算', type: '数字', use: '成本跟踪', status: '启用' },
      { name: '客户', type: '关联', use: '关联人员/组织', status: '启用' },
      { name: '阶段', type: '单选', use: '售前 / 交付 / 验收', status: '启用' }
    ],
    risk: [
      { name: '概率', type: '数字', use: '1–5 评分', status: '启用' },
      { name: '影响', type: '数字', use: '1–5 评分', status: '启用' },
      { name: '应对策略', type: '长文本', use: '缓解 / 转移 / 接受', status: '启用' }
    ],
    person: [
      { name: '角色', type: '文本', use: '发起人 / 客户 / 协作', status: '启用' },
      { name: '所属团队', type: '文本', use: '组织关系', status: '启用' }
    ]
  }
};
