// 示例/种子数据已清空 —— 新账号进来是干净的零状态。
// 真实课堂数据来自后端:/course 页走 useRecords / useLibrary。
// 标签由用户自己在「管理标签」里新增(存本地 localStorage)。

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

export const tags: Tag[] = [];

export const sessions: MockSession[] = [];
