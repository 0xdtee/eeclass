export const dashboardStats = {
  totalCourses: 8,
  totalRecordingMinutes: 642,
  totalSummaries: 35,
  totalSharedStudents: 127,
  weeklyActivity: [
    { day: '周一', recordings: 3, summaries: 5 },
    { day: '周二', recordings: 5, summaries: 8 },
    { day: '周三', recordings: 4, summaries: 6 },
    { day: '周四', recordings: 6, summaries: 9 },
    { day: '周五', recordings: 4, summaries: 7 },
    { day: '周六', recordings: 1, summaries: 2 },
    { day: '周日', recordings: 0, summaries: 1 },
  ],
  tagDistribution: [
    { tag: '绪论', count: 3, color: 'accent' },
    { tag: '线性表', count: 8, color: 'accent' },
    { tag: '栈与队列', count: 7, color: 'accent' },
    { tag: '树与二叉树', count: 9, color: 'primary' },
    { tag: '图', count: 4, color: 'accent' },
    { tag: '查找', count: 3, color: 'secondary' },
    { tag: '排序', count: 5, color: 'secondary' },
  ],
  recentSessions: [
    { id: 'session-007', title: '第7讲：平衡二叉树与AVL树', date: '2026-10-27', duration: '1小时38分', summary: '深入讲解了平衡二叉树的核心原理...', tags: ['树与二叉树'] },
    { id: 'session-006', title: '第6讲：二叉树遍历', date: '2026-10-20', duration: '1小时45分', summary: '二叉树遍历方式及二叉搜索树...', tags: ['树与二叉树'] },
    { id: 'session-005', title: '第5讲：队列与广度优先', date: '2026-10-13', duration: '1小时30分', summary: '队列FIFO特性与BFS算法应用...', tags: ['栈与队列'] },
    { id: 'session-004', title: '第4讲：栈的定义与应用', date: '2026-10-06', duration: '1小时20分', summary: '栈的LIFO原理与括号匹配...', tags: ['栈与队列'] },
  ],
};

export const quickActions = [
  { id: 'record', label: '开始录音', icon: 'ri-mic-line', description: '录制新课', color: 'accent', link: '/course' },
  { id: 'history', label: '历史记录', icon: 'ri-history-line', description: '查看全部课时', color: 'primary', link: '/course' },
  { id: 'summary', label: 'AI摘要', icon: 'ri-magic-line', description: '智能生成摘要', color: 'accent', link: '/course' },
  { id: 'share', label: '共享管理', icon: 'ri-share-line', description: '权限设置', color: 'secondary', link: '/course' },
  { id: 'export', label: '批量导出', icon: 'ri-file-pdf-2-line', description: '导出PDF', color: 'secondary', link: '/course' },
  { id: 'tags', label: '管理标签', icon: 'ri-price-tag-3-line', description: '新增/编辑标签', color: 'primary', link: '/tags' },
];