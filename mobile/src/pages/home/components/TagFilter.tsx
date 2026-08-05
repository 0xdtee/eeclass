import { useState } from 'react';
import TagBadge from '@/components/base/TagBadge';
import { tags as allTags } from '@/mocks/courseData';

interface TagFilterProps {
  selectedTags: string[];
  onTagsChange: (tags: string[]) => void;
}

export default function TagFilter({ selectedTags, onTagsChange }: TagFilterProps) {
  const [showDropdown, setShowDropdown] = useState(false);

  const toggleTag = (tagId: string) => {
    if (selectedTags.includes(tagId)) {
      onTagsChange(selectedTags.filter((t) => t !== tagId));
    } else {
      onTagsChange([...selectedTags, tagId]);
    }
  };

  const clearAll = () => onTagsChange([]);

  return (
    <div className="relative">
      <button
        onClick={() => setShowDropdown(!showDropdown)}
        className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-all cursor-pointer whitespace-nowrap ${
          selectedTags.length > 0
            ? 'bg-accent-100 text-accent-800'
            : 'bg-background-100 text-foreground-600 hover:bg-background-200'
        }`}
      >
        <i className="ri-price-tag-3-line text-base"></i>
        <span>章节筛选</span>
        {selectedTags.length > 0 && (
          <span className="bg-accent-500 text-background-50 text-xs rounded-full w-5 h-5 flex items-center justify-center">
            {selectedTags.length}
          </span>
        )}
        <i className={`ri-arrow-down-s-line text-sm transition-transform ${showDropdown ? 'rotate-180' : ''}`}></i>
      </button>

      {showDropdown && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setShowDropdown(false)}></div>
          <div className="absolute right-0 top-full mt-2 z-20 bg-background-50 rounded-xl border border-background-200 p-4 min-w-[280px]">
            <div className="flex items-center justify-between mb-3">
              <span className="text-xs font-medium text-foreground-500">选择章节</span>
              {selectedTags.length > 0 && (
                <button
                  onClick={clearAll}
                  className="text-xs text-accent-600 hover:text-accent-700 cursor-pointer whitespace-nowrap"
                >
                  清除全部
                </button>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              {allTags.map((tag) => (
                <TagBadge
                  key={tag.id}
                  label={tag.label}
                  active={selectedTags.includes(tag.id)}
                  onClick={() => toggleTag(tag.id)}
                  color="accent"
                />
              ))}
            </div>
          </div>
        </>
      )}
    </div>
  );
}