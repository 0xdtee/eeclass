// 示例/种子数据已清空 —— 新账号进来是干净的零状态。
// 真实课堂数据来自后端:/course 页走 useRecords / useLibrary。
// 标签默认带上「全国版课程大纲」里的课程(用户可在「管理标签」里增删,存本地 localStorage)。

export interface Tag {
  id: string;
  label: string;
  color: string;
}

export interface MockSession {
  id: string;
  title: string;
  date: string;
  time: string;
  duration: string;
  tags: string[];
  description: string;
  transcription?: string;
  summary?: string;
  keyPoints?: string[];
}

export const courseData = {
  id: '',
  title: '',
  teacher: '',
  semester: '',
  description: '',
};

// 默认标签 = 全国版课程大纲(教育部·教指委 全国基本要求)里的课程,三色轮换
export const tags: Tag[] = [
  { id: 'tag-nat-1', label: '大学物理', color: 'accent' },
  { id: 'tag-nat-2', label: '大学物理实验', color: 'primary' },
  { id: 'tag-nat-3', label: '大学计算机基础', color: 'secondary' },
  { id: 'tag-nat-4', label: '大学英语', color: 'accent' },
  { id: 'tag-nat-5', label: '马克思主义基本原理', color: 'primary' },
  { id: 'tag-nat-6', label: '毛泽东思想和中国特色社会主义理论体系概论', color: 'secondary' },
  { id: 'tag-nat-7', label: '习近平新时代中国特色社会主义思想概论', color: 'accent' },
  { id: 'tag-nat-8', label: '思想道德与法治', color: 'primary' },
  { id: 'tag-nat-9', label: '中国近现代史纲要', color: 'secondary' },
  { id: 'tag-nat-10', label: '军事理论', color: 'accent' },
  { id: 'tag-nat-11', label: '大学生心理健康教育', color: 'primary' },
];

export const sessions: MockSession[] = [];
