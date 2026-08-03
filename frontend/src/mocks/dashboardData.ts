// 统计数据归零 —— 新账号是干净的零状态(真实数据在 /course 页)。
export const dashboardStats = {
  totalCourses: 0,
  totalRecordingMinutes: 0,
  totalSummaries: 0,
  totalSharedStudents: 0,
  weeklyActivity: [
    { day: '周一', recordings: 0, summaries: 0 },
    { day: '周二', recordings: 0, summaries: 0 },
    { day: '周三', recordings: 0, summaries: 0 },
    { day: '周四', recordings: 0, summaries: 0 },
    { day: '周五', recordings: 0, summaries: 0 },
    { day: '周六', recordings: 0, summaries: 0 },
    { day: '周日', recordings: 0, summaries: 0 },
  ],
  tagDistribution: [] as { tag: string; count: number; color: string }[],
  recentSessions: [] as { id: string; title: string; date: string; duration: string; summary: string; tags: string[] }[],
};

export const quickActions = [
  { id: 'record', label: '开始录音', icon: 'ri-mic-line', description: '录制新课', color: 'accent', link: '/course?new=1' },
  { id: 'history', label: '历史记录', icon: 'ri-history-line', description: '查看全部课时', color: 'primary', link: '/course?tab=history' },
  { id: 'summary', label: 'AI摘要', icon: 'ri-magic-line', description: '智能生成摘要', color: 'accent', link: '/course?tab=summary' },
  { id: 'share', label: '共享管理', icon: 'ri-share-line', description: '权限设置', color: 'secondary', link: '/course?tab=history&share=1' },
  { id: 'export', label: '批量导出', icon: 'ri-file-pdf-2-line', description: '导出PDF', color: 'secondary', link: '/course?tab=history' },
  { id: 'tags', label: '管理标签', icon: 'ri-price-tag-3-line', description: '新增/编辑标签', color: 'primary', link: '/tags' },
];
