import { Search } from 'lucide-react';

interface ChatSearchBarProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export default function ChatSearchBar({ value, onChange, placeholder = 'Search conversations...' }: ChatSearchBarProps) {
  return (
    <div className="relative">
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pl-9 pr-3 text-sm text-gray-900 placeholder-gray-400 transition-colors focus:border-primary-300 focus:bg-white focus:outline-none focus:ring-1 focus:ring-primary-300"
      />
    </div>
  );
}
