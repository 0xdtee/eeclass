import { type ReactNode } from 'react';

interface Tab {
  id: string;
  label: string;
  icon?: string;
}

interface TabsProps {
  tabs: Tab[];
  activeTab: string;
  onTabChange: (tabId: string) => void;
}

export default function Tabs({ tabs, activeTab, onTabChange }: TabsProps) {
  return (
    <div className="flex items-center gap-1 bg-background-100 rounded-full p-1 w-fit max-w-full overflow-x-auto no-scrollbar">
      {tabs.map((tab) => (
        <button
          key={tab.id}
          data-guide={`tab-${tab.id}`}
          onClick={() => onTabChange(tab.id)}
          className={`whitespace-nowrap px-3 sm:px-5 py-1.5 sm:py-2 rounded-full text-xs sm:text-sm font-medium transition-all duration-200 cursor-pointer ${
            activeTab === tab.id
              ? 'bg-background-50 text-foreground-900'
              : 'text-foreground-500 hover:text-foreground-700'
          }`}
        >
          {tab.icon && (
            <i className={`${tab.icon} mr-1.5 text-xs`}></i>
          )}
          {tab.label}
        </button>
      ))}
    </div>
  );
}