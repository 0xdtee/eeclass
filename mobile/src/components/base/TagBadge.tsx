interface TagBadgeProps {
  label: string;
  active?: boolean;
  onClick?: () => void;
  size?: 'sm' | 'md';
  color?: 'accent' | 'primary' | 'secondary';
}

export default function TagBadge({ label, active = false, onClick, size = 'sm', color = 'accent' }: TagBadgeProps) {
  const baseClasses = 'whitespace-nowrap rounded-full font-medium transition-all duration-200';
  const sizeClasses = size === 'sm' ? 'px-3 py-1 text-xs' : 'px-4 py-1.5 text-sm';

  const colorMap = {
    accent: active
      ? 'bg-accent-500 text-background-50'
      : 'bg-accent-100 text-accent-800 hover:bg-accent-200',
    primary: active
      ? 'bg-primary-500 text-background-50'
      : 'bg-primary-100 text-primary-800 hover:bg-primary-200',
    secondary: active
      ? 'bg-secondary-500 text-background-50'
      : 'bg-secondary-100 text-secondary-800 hover:bg-secondary-200',
  };

  return (
    <button
      onClick={onClick}
      className={`${baseClasses} ${sizeClasses} ${colorMap[color]} ${onClick ? 'cursor-pointer' : ''}`}
    >
      {label}
    </button>
  );
}