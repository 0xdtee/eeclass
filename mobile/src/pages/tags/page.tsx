import { useState, useRef, useEffect, useCallback } from 'react';
import BackButton from '@/components/feature/BackButton';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  KeyboardSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  verticalListSortingStrategy,
  useSortable,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { useTagsStore } from '@/hooks/useTagsStore';
import type { Tag } from '@/hooks/useTagsStore';
import { sessions } from '@/mocks/courseData';

/* ───────── color config ───────── */
const COLOR_OPTIONS = [
  { value: 'accent',    label: '青绿', bgClass: 'bg-accent-500',    lightClass: 'bg-accent-100 text-accent-800 border-accent-200' },
  { value: 'primary',   label: '主色', bgClass: 'bg-primary-500',   lightClass: 'bg-primary-100 text-primary-800 border-primary-200' },
  { value: 'secondary', label: '辅色', bgClass: 'bg-secondary-500', lightClass: 'bg-secondary-100 text-secondary-800 border-secondary-200' },
];

function getColorConfig(color: string) {
  return COLOR_OPTIONS.find((c) => c.value === color) ?? COLOR_OPTIONS[0];
}

function getSessionCount(tagId: string): number {
  return sessions.filter((s) => s.tags.includes(tagId)).length;
}

/* ───────── types ───────── */
interface EditingState {
  id: string;
  label: string;
  color: string;
}

interface NewTagState {
  label: string;
  color: string;
}

/* ───────── ColorPicker ───────── */
function ColorPicker({
  value,
  onChange,
}: {
  value: string;
  onChange: (c: string) => void;
}) {
  return (
    <div className="flex items-center gap-1.5 p-1.5 bg-background-50 border border-background-200 rounded-lg flex-shrink-0">
      {COLOR_OPTIONS.map((c) => (
        <button
          key={c.value}
          type="button"
          onClick={() => onChange(c.value)}
          title={c.label}
          className={`w-6 h-6 rounded-full ${c.bgClass} cursor-pointer transition-transform hover:scale-110 ${
            value === c.value ? 'ring-2 ring-offset-1 ring-foreground-400 scale-110' : ''
          }`}
        />
      ))}
    </div>
  );
}

/* ───────── SortableTagRow ───────── */
interface RowProps {
  tag: Tag;
  isEditing: boolean;
  editingState: EditingState | null;
  isDeleteConfirm: boolean;
  sessionCount: number;
  editInputRef: React.RefObject<HTMLInputElement | null>;
  onStartEdit: (id: string, label: string, color: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onEditChange: (partial: Partial<EditingState>) => void;
  onAskDelete: (id: string) => void;
  onConfirmDelete: (id: string) => void;
  onCancelDelete: () => void;
  /** used for the ghost overlay — no drag handle needed */
  isOverlay?: boolean;
}

function SortableTagRow(props: RowProps & { upDownProps?: UpDownProps }) {
  const { tag, isOverlay = false, upDownProps } = props;
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: tag.id });

  const style: React.CSSProperties = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 10 : undefined,
    opacity: isDragging ? 0.35 : 1,
  };

  return (
    <div ref={setNodeRef} style={style}>
      <TagRowContent
        {...props}
        dragHandleProps={isOverlay ? undefined : { ...attributes, ...listeners }}
        upDownProps={isOverlay ? undefined : upDownProps}
      />
    </div>
  );
}

interface UpDownProps {
  onUp: () => void;
  onDown: () => void;
  isFirst: boolean;
  isLast: boolean;
}

/* ───────── TagRowContent (pure rendering) ───────── */
function TagRowContent({
  tag,
  isEditing,
  editingState,
  isDeleteConfirm,
  sessionCount,
  editInputRef,
  onStartEdit,
  onSaveEdit,
  onCancelEdit,
  onEditChange,
  onAskDelete,
  onConfirmDelete,
  onCancelDelete,
  dragHandleProps,
  upDownProps,
}: RowProps & { dragHandleProps?: Record<string, unknown>; upDownProps?: UpDownProps }) {
  const c = getColorConfig(tag.color);

  /* ── edit mode ── */
  if (isEditing && editingState) {
    return (
      <div className="px-5 py-4 bg-accent-50/60 border-b border-background-100">
        <div className="flex flex-col sm:flex-row gap-3">
          <input
            ref={editInputRef as React.RefObject<HTMLInputElement>}
            type="text"
            value={editingState.label}
            onChange={(e) => onEditChange({ label: e.target.value })}
            onKeyDown={(e) => {
              if (e.key === 'Enter') onSaveEdit();
              if (e.key === 'Escape') onCancelEdit();
            }}
            maxLength={30}
            className="flex-1 h-9 px-3 bg-background-50 border border-background-300 rounded-lg text-sm text-foreground-800 focus:outline-none focus:border-accent-400 focus:ring-2 focus:ring-accent-100 transition-all"
          />
          <ColorPicker value={editingState.color} onChange={(v) => onEditChange({ color: v })} />
        </div>
        <div className="flex items-center gap-2 mt-2.5">
          <span className="text-xs text-foreground-400">预览：</span>
          <span className={`px-2.5 py-1 rounded-full text-xs font-medium border ${getColorConfig(editingState.color).lightClass}`}>
            {editingState.label || '标签名称'}
          </span>
        </div>
        <div className="flex gap-2 mt-3">
          <button onClick={onSaveEdit} className="px-3 py-1.5 bg-accent-500 text-background-50 rounded-lg text-xs font-semibold hover:bg-accent-600 transition-colors cursor-pointer whitespace-nowrap">保存</button>
          <button onClick={onCancelEdit} className="px-3 py-1.5 bg-background-100 text-foreground-500 rounded-lg text-xs font-semibold hover:bg-background-200 transition-colors cursor-pointer whitespace-nowrap">取消</button>
        </div>
      </div>
    );
  }

  /* ── delete confirm ── */
  if (isDeleteConfirm) {
    return (
      <div className="px-5 py-4 bg-red-50/50 border-b border-background-100 flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 flex items-center justify-center">
            <i className="ri-error-warning-line text-red-400"></i>
          </div>
          <p className="text-sm text-foreground-700">
            确定删除「<span className="font-semibold">{tag.label}</span>」？
            {sessionCount > 0 && <span className="text-red-500 ml-1">（已有 {sessionCount} 节课时使用此标签）</span>}
          </p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => onConfirmDelete(tag.id)} className="px-3 py-1.5 bg-red-500 text-white rounded-lg text-xs font-semibold hover:bg-red-600 transition-colors cursor-pointer whitespace-nowrap">确认删除</button>
          <button onClick={onCancelDelete} className="px-3 py-1.5 bg-background-100 text-foreground-500 rounded-lg text-xs font-semibold hover:bg-background-200 transition-colors cursor-pointer whitespace-nowrap">取消</button>
        </div>
      </div>
    );
  }

  /* ── normal row ── */
  return (
    <div className="px-5 py-4 flex items-center gap-3 hover:bg-background-50 transition-colors border-b border-background-100 last:border-b-0 group">
      {/* Drag handle */}
      <button
        type="button"
        {...(dragHandleProps ?? {})}
        className="w-7 h-7 flex items-center justify-center text-foreground-300 hover:text-foreground-500 cursor-grab active:cursor-grabbing rounded-md hover:bg-background-200 transition-colors flex-shrink-0 touch-none"
        title="拖动调整顺序"
        aria-label="拖动调整顺序"
      >
        <i className="ri-drag-move-2-fill text-base"></i>
      </button>

      {/* Up / Down buttons — passed via extra props when not overlay */}
      {upDownProps && (
        <div className="flex flex-col gap-0.5 flex-shrink-0">
          <button
            onClick={upDownProps.onUp}
            disabled={upDownProps.isFirst}
            className="w-5 h-5 flex items-center justify-center text-foreground-300 hover:text-foreground-600 disabled:opacity-20 disabled:cursor-not-allowed cursor-pointer transition-colors"
          >
            <i className="ri-arrow-up-s-line text-sm"></i>
          </button>
          <button
            onClick={upDownProps.onDown}
            disabled={upDownProps.isLast}
            className="w-5 h-5 flex items-center justify-center text-foreground-300 hover:text-foreground-600 disabled:opacity-20 disabled:cursor-not-allowed cursor-pointer transition-colors"
          >
            <i className="ri-arrow-down-s-line text-sm"></i>
          </button>
        </div>
      )}

      {/* Color dot */}
      <div className={`w-2.5 h-2.5 rounded-full ${c.bgClass} flex-shrink-0`}></div>

      {/* Label badge */}
      <span className={`px-2.5 py-1 rounded-full text-xs font-medium border ${c.lightClass} whitespace-nowrap`}>
        {tag.label}
      </span>

      {/* Session count */}
      <span className="text-xs text-foreground-400">
        {sessionCount > 0 ? `${sessionCount} 节课时` : <span className="text-foreground-300">暂无课时</span>}
      </span>

      <div className="flex-1" />

      {/* Actions */}
      <div className="flex items-center gap-1 flex-shrink-0 opacity-0 group-hover:opacity-100 transition-opacity">
        <button onClick={() => onStartEdit(tag.id, tag.label, tag.color)} className="w-8 h-8 flex items-center justify-center rounded-lg text-foreground-400 hover:text-accent-600 hover:bg-accent-50 transition-colors cursor-pointer" title="编辑">
          <i className="ri-edit-2-line text-sm"></i>
        </button>
        <button onClick={() => onAskDelete(tag.id)} className="w-8 h-8 flex items-center justify-center rounded-lg text-foreground-400 hover:text-red-500 hover:bg-red-50 transition-colors cursor-pointer" title="删除">
          <i className="ri-delete-bin-2-line text-sm"></i>
        </button>
      </div>
    </div>
  );
}

/* ───────── Main Page ───────── */
export default function TagsPage() {
  const { tags, addTag, updateTag, deleteTag, reorderTag, reorderAll } = useTagsStore();

  const [editing, setEditing] = useState<EditingState | null>(null);
  const [showAddForm, setShowAddForm] = useState(false);
  const [newTag, setNewTag] = useState<NewTagState>({ label: '', color: 'accent' });
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const [toast, setToast] = useState('');
  const [activeId, setActiveId] = useState<string | null>(null);

  const editInputRef = useRef<HTMLInputElement | null>(null);
  const addInputRef = useRef<HTMLInputElement>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  useEffect(() => {
    if (editing && editInputRef.current) editInputRef.current.focus();
  }, [editing?.id]);

  useEffect(() => {
    if (showAddForm && addInputRef.current) addInputRef.current.focus();
  }, [showAddForm]);

  const showToast = (msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(''), 2500);
  };

  /* drag handlers */
  const handleDragStart = useCallback((event: DragStartEvent) => {
    setActiveId(String(event.active.id));
    setEditing(null);
    setDeleteConfirm(null);
  }, []);

  const handleDragEnd = useCallback((event: DragEndEvent) => {
    const { active, over } = event;
    setActiveId(null);
    if (!over || active.id === over.id) return;
    const oldIdx = tags.findIndex((t) => t.id === active.id);
    const newIdx = tags.findIndex((t) => t.id === over.id);
    if (oldIdx === -1 || newIdx === -1) return;
    reorderAll(arrayMove(tags, oldIdx, newIdx));
  }, [tags, reorderAll]);

  /* edit handlers */
  const handleStartEdit = (id: string, label: string, color: string) => {
    setEditing({ id, label, color });
    setDeleteConfirm(null);
  };
  const handleEditChange = (partial: Partial<EditingState>) => {
    setEditing((prev) => prev ? { ...prev, ...partial } : null);
  };
  const handleSaveEdit = () => {
    if (!editing) return;
    if (!editing.label.trim()) { showToast('标签名不能为空'); return; }
    updateTag(editing.id, editing.label, editing.color);
    setEditing(null);
    showToast('标签已保存');
  };
  const handleCancelEdit = () => setEditing(null);

  /* add handlers */
  const handleAddTag = () => {
    if (!newTag.label.trim()) { showToast('请输入标签名'); return; }
    addTag(newTag.label, newTag.color);
    setNewTag({ label: '', color: 'accent' });
    setShowAddForm(false);
    showToast('新标签已添加');
  };

  /* delete handlers */
  const handleAskDelete = (id: string) => { setDeleteConfirm(id); setEditing(null); };
  const handleConfirmDelete = (id: string) => { deleteTag(id); setDeleteConfirm(null); showToast('标签已删除'); };
  const handleCancelDelete = () => setDeleteConfirm(null);

  const activeTag = activeId ? tags.find((t) => t.id === activeId) : null;

  return (
    <div className="min-h-full bg-background-100">
      {/* Toast */}
      {toast && (
        <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 px-5 py-2.5 bg-foreground-900 text-background-50 rounded-xl text-sm font-medium shadow-lg whitespace-nowrap">
          {toast}
        </div>
      )}

      {/* Top Nav */}
      <div className="sticky top-0 z-40 bg-background-50 border-b border-background-200">
        <div className="max-w-3xl mx-auto px-6 h-14 flex items-center gap-4">
          <BackButton label="返回" className="flex items-center gap-1.5 text-foreground-500 hover:text-foreground-800 transition-colors cursor-pointer whitespace-nowrap select-none" />
          <div className="w-px h-4 bg-background-200"></div>
          <div className="flex items-center gap-2 flex-1">
            <div className="w-5 h-5 flex items-center justify-center"><i className="ri-price-tag-3-line text-accent-500 text-base"></i></div>
            <h1 className="text-sm font-semibold text-foreground-800">管理标签</h1>
            <span className="ml-1 px-2 py-0.5 bg-background-200 text-foreground-500 rounded-full text-xs font-medium">{tags.length} 个</span>
          </div>
          <button
            onClick={() => { setShowAddForm(true); setEditing(null); setDeleteConfirm(null); }}
            className="flex items-center gap-1.5 px-4 py-2 bg-accent-500 text-background-50 rounded-lg text-sm font-semibold hover:bg-accent-600 transition-colors cursor-pointer whitespace-nowrap"
          >
            <div className="w-4 h-4 flex items-center justify-center"><i className="ri-add-line text-base"></i></div>
            新建标签
          </button>
        </div>
      </div>

      <div className="max-w-3xl mx-auto px-6 py-8 space-y-4">
        {/* Info banner */}
        <div className="bg-background-50 rounded-2xl border border-background-200 p-5 flex items-start gap-4">
          <div className="w-10 h-10 flex items-center justify-center bg-accent-100 rounded-xl flex-shrink-0">
            <i className="ri-price-tag-3-line text-accent-600 text-lg"></i>
          </div>
          <div>
            <p className="text-sm font-semibold text-foreground-800 mb-1">标签用于分类课时记录</p>
            <p className="text-xs text-foreground-400 leading-relaxed">
              新增、重命名或删除标签，按住左侧
              <span className="inline-flex items-center mx-1 text-foreground-500">
                <i className="ri-drag-move-2-fill text-xs"></i>
              </span>
              图标可拖动调整排列顺序。
            </p>
          </div>
        </div>

        {/* Add form */}
        {showAddForm && (
          <div className="bg-accent-50 border border-accent-200 rounded-2xl p-5">
            <p className="text-sm font-semibold text-foreground-800 mb-4 flex items-center gap-2">
              <div className="w-4 h-4 flex items-center justify-center"><i className="ri-add-circle-line text-accent-500"></i></div>
              新建标签
            </p>
            <div className="flex flex-col sm:flex-row gap-3">
              <input
                ref={addInputRef}
                type="text"
                value={newTag.label}
                onChange={(e) => setNewTag((p) => ({ ...p, label: e.target.value }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') handleAddTag();
                  if (e.key === 'Escape') { setShowAddForm(false); setNewTag({ label: '', color: 'accent' }); }
                }}
                placeholder="输入标签名称，如「第八章：高级算法」"
                maxLength={30}
                className="flex-1 h-10 px-3.5 bg-background-50 border border-background-300 rounded-lg text-sm text-foreground-800 placeholder:text-foreground-300 focus:outline-none focus:border-accent-400 focus:ring-2 focus:ring-accent-100 transition-all"
              />
              <ColorPicker value={newTag.color} onChange={(v) => setNewTag((p) => ({ ...p, color: v }))} />
            </div>
            <div className="flex items-center gap-2 mt-3">
              <span className="text-xs text-foreground-400">预览：</span>
              <span className={`px-2.5 py-1 rounded-full text-xs font-medium border ${getColorConfig(newTag.color).lightClass}`}>
                {newTag.label || '标签名称'}
              </span>
            </div>
            <div className="flex gap-2 mt-4">
              <button onClick={handleAddTag} className="px-4 py-2 bg-accent-500 text-background-50 rounded-lg text-xs font-semibold hover:bg-accent-600 transition-colors cursor-pointer whitespace-nowrap">确认添加</button>
              <button onClick={() => { setShowAddForm(false); setNewTag({ label: '', color: 'accent' }); }} className="px-4 py-2 bg-background-100 text-foreground-500 rounded-lg text-xs font-semibold hover:bg-background-200 transition-colors cursor-pointer whitespace-nowrap">取消</button>
            </div>
          </div>
        )}

        {/* Tag list */}
        {tags.length === 0 ? (
          <div className="bg-background-50 rounded-2xl border border-background-200 py-16 text-center">
            <div className="w-14 h-14 mx-auto flex items-center justify-center bg-background-100 rounded-2xl mb-4">
              <i className="ri-price-tag-3-line text-foreground-300 text-2xl"></i>
            </div>
            <p className="text-sm font-medium text-foreground-500 mb-1">还没有标签</p>
            <p className="text-xs text-foreground-300">点击右上角「新建标签」开始创建</p>
          </div>
        ) : (
          <div className="bg-background-50 rounded-2xl border border-background-200 overflow-hidden">
            <div className="px-5 py-3.5 border-b border-background-100 flex items-center justify-between">
              <p className="text-xs font-medium text-foreground-400">标签列表</p>
              <div className="flex items-center gap-1 text-xs text-foreground-300">
                <i className="ri-drag-move-2-fill text-xs"></i>
                <span>按住拖动调整顺序</span>
              </div>
            </div>

            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragStart={handleDragStart}
              onDragEnd={handleDragEnd}
            >
              <SortableContext items={tags.map((t) => t.id)} strategy={verticalListSortingStrategy}>
                {tags.map((tag, idx) => (
                  <SortableTagRow
                    key={tag.id}
                    tag={tag}
                    isEditing={editing?.id === tag.id}
                    editingState={editing}
                    isDeleteConfirm={deleteConfirm === tag.id}
                    sessionCount={getSessionCount(tag.id)}
                    editInputRef={editInputRef}
                    onStartEdit={handleStartEdit}
                    onSaveEdit={handleSaveEdit}
                    onCancelEdit={handleCancelEdit}
                    onEditChange={handleEditChange}
                    onAskDelete={handleAskDelete}
                    onConfirmDelete={handleConfirmDelete}
                    onCancelDelete={handleCancelDelete}
                    upDownProps={{
                      onUp: () => reorderTag(tag.id, 'up'),
                      onDown: () => reorderTag(tag.id, 'down'),
                      isFirst: idx === 0,
                      isLast: idx === tags.length - 1,
                    }}
                  />
                ))}
              </SortableContext>

              {/* Ghost overlay while dragging */}
              <DragOverlay>
                {activeTag && (
                  <div className="bg-background-50 rounded-xl border border-accent-300 shadow-lg opacity-95">
                    <TagRowContent
                      tag={activeTag}
                      isEditing={false}
                      editingState={null}
                      isDeleteConfirm={false}
                      sessionCount={getSessionCount(activeTag.id)}
                      editInputRef={editInputRef}
                      onStartEdit={() => {}}
                      onSaveEdit={() => {}}
                      onCancelEdit={() => {}}
                      onEditChange={() => {}}
                      onAskDelete={() => {}}
                      onConfirmDelete={() => {}}
                      onCancelDelete={() => {}}
                      isOverlay
                    />
                  </div>
                )}
              </DragOverlay>
            </DndContext>
          </div>
        )}

        <p className="text-center text-xs text-foreground-300 pb-4">标签修改会即时保存，刷新页面后依然有效</p>
      </div>
    </div>
  );
}